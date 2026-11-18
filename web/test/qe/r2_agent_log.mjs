// QE round 2 surface (3): the REAL agent code (agent/src/cli.ts -> agent.ts -> log.ts) against a loopback fake 402 server with hostile terms.
// Key-free: a THROWAWAY generated keypair (never funded, not a project key), auto-approve 0 + no TTY => the agent stops at "approval_rejected" before signing; nothing leaves loopback.
// Then: makeLogger unit probes (forbidden names/values), and the logged lines are fed to web/lib/jobs.mjs mapDecision. Usage: env -i node web/test/qe/r2_agent_log.mjs [port=4090]
import http from "node:http"; import { spawn } from "node:child_process"; import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { mapDecision } from "../../lib/jobs.mjs"; import { makeLogger } from "../../../agent/src/log.ts";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../.."); const port = Number(process.argv[2] || 4090);
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const THROWAWAY = base58.encode(Buffer.concat([seed, pub])); const dir = mkdtempSync(path.join(os.tmpdir(), "r2agent-")); writeFileSync(path.join(dir, "proof.bin"), "agent log probe");
const b58 = n => Array.from({ length: n }, (_, i) => "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[(i * 7 + 3) % 58]).join("");
const variants = {
  hostile: { scheme: "upto", network: "solana:" + "A".repeat(3000) + "<img src=x onerror=1>", amount: "250000", payTo: "<script>1</script>" + b58(87), maxTimeoutSeconds: 300, asset: "x", extra: {} },
  "key-like-values": { scheme: "upto", network: "solana:" + b58(88), amount: "250000", payTo: b58(88), maxTimeoutSeconds: 300, asset: "x", extra: { privateKey: THROWAWAY } },
  "weird-timeout": { scheme: "upto", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", amount: "250000", payTo: b58(44), maxTimeoutSeconds: 1e300, asset: "x", extra: {} },
  "neg-amount": { scheme: "upto", network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", amount: "-5", payTo: b58(44), maxTimeoutSeconds: 300, asset: "x" },
};
let cur = variants.hostile; const srv = http.createServer((req, res) => { req.resume(); req.on("end", () => { const body = { x402Version: 2, error: "payment required", resource: { url: `http://localhost:${port}/report` }, accepts: [cur] }; res.writeHead(402, { "content-type": "application/json", "payment-required": Buffer.from(JSON.stringify(body)).toString("base64") }); res.end(JSON.stringify(body)); }); });
await new Promise(r => srv.listen(port, "127.0.0.1", r));
const stripped = JSON.stringify; const all = [];
for (const [name, v] of Object.entries(variants)) {
  cur = v; const logPath = path.join(dir, name + ".log");
  const r = await new Promise(res => { const c = spawn(process.execPath, ["src/cli.ts", path.join(dir, "proof.bin")], { cwd: path.join(ROOT, "agent"), stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "", AGENT_SVM_PRIVATE_KEY: THROWAWAY, AGENT_ALLOWED_URL: `http://localhost:${port}/report`, AGENT_LOG_PATH: logPath, AGENT_AUTO_APPROVE_USD: "0", AGENT_PER_REPORT_CAP_USD: "0.25", AGENT_SESSION_BUDGET_USD: "2", AGENT_RETRY_BUDGET: "0" } }); let o = "", e = ""; c.stdout.on("data", d => o += d); c.stderr.on("data", d => e += d); const t = setTimeout(() => c.kill("SIGKILL"), 60000); c.on("exit", code => { clearTimeout(t); res({ status: code, stdout: o, stderr: e }); }); });
  const text = existsSync(logPath) ? readFileSync(logPath, "utf8") : ""; const lines = text.split("\n").filter(Boolean).map(l => JSON.parse(l)); all.push(text);
  const reserve = lines.find(l => l.event === "reserve"); const events = lines.map(l => l.event).join(",");
  const leak = text.includes(THROWAWAY) || text.includes(base58.encode(seed)) || /privateKey/.test(text) || r.stdout.includes(THROWAWAY) || r.stderr.includes(THROWAWAY);
  console.log(`  ${name}: exit ${r.status}; events [${events}]; reserve fields ${reserve ? Object.keys(reserve).join("/") : "none"}; reserve line ${reserve ? JSON.stringify(reserve).length : 0} B; stdout: ${r.stdout.trim().slice(0, 120)}`);
  ok(!leak, `real agent log (${name}): throwaway key value/name absent from decisions log, stdout and stderr`);
  const mapped = lines.map(mapDecision).filter(Boolean); const facts = mapped.flatMap(m => m.facts ? [m.facts] : []);
  const maxFact = Math.max(0, ...facts.flatMap(f => Object.values(f).map(x => String(x).length)));
  ok(facts.every(f => Object.entries(f).every(([k, x]) => k === "route" || k === "maxTimeoutSeconds" || typeof x === "string")) && maxFact <= 50, `real agent log (${name}) -> mapDecision: ${mapped.length} events, ${facts.length} with facts ${stripped(facts).slice(0, 220)} (longest fact value ${maxFact})`);
  if (name === "hostile") ok(!!reserve && reserve.network.length > 1000, "INFO real agent writes the server-supplied 402 network string unbounded into decisions.log (" + (reserve?.network.length ?? 0) + " chars); the web layer drops it (see mapDecision line)");
}
srv.close();
// makeLogger unit probes
const lp = path.join(dir, "unit.log"); const log = makeLogger(lp);
log("probe", { privateKey: "S1", PRIVATE_KEY: "S2", secret: "S3", seedPhrase: "S4", Authorization: "S5", "payment-signature": "S6", "PAYMENT-SIGNATURE": "S7", signature: "S8", keypair: "S9", apiKey: "S10",
  mnemonic: "KEPT-mnemonic", pk: "KEPT-pk", token: "KEPT-token", password: "KEPT-password", rpcUrl: "https://rpc.example/KEPT-token-in-url", sig: "KEPT-sig", askAtomic: 25n, nested: { privateKey: "NESTED-KEY-NAME" }, memo: THROWAWAY });
const out = JSON.parse(readFileSync(lp, "utf8").trim()); const dropped = ["privateKey", "PRIVATE_KEY", "secret", "seedPhrase", "Authorization", "payment-signature", "PAYMENT-SIGNATURE", "signature", "keypair", "apiKey"].filter(k => !(k in out)).length;
ok(dropped === 10, `makeLogger drops the 10 denylisted NAMES (privateKey, PRIVATE_KEY, secret, seedPhrase, Authorization, payment-signature x2, signature, keypair, apiKey): dropped ${dropped}/10`);
console.log("  kept (denylist is name-based only): " + Object.keys(out).filter(k => !["ts", "event"].includes(k)).join(", "));
console.log(`INFO (P3, denylist limits; no current call site passes any of these): kept names ${["mnemonic", "pk", "token", "password"].filter(k => k in out).join(",")}; nested.privateKey kept: ${!!out.nested?.privateKey}; a key VALUE under a benign name kept: ${out.memo === THROWAWAY}`);
// every call-site field name in agent.ts/cli.ts, checked against FORBIDDEN-like names
const src = readFileSync(path.join(ROOT, "agent/src/agent.ts"), "utf8") + readFileSync(path.join(ROOT, "agent/src/cli.ts"), "utf8");
const names = new Set(); for (const m of src.matchAll(/\blog\("[a-z_0-9]+",\s*\{([^}]*)\}/g)) for (const f of m[1].matchAll(/(?:^|,)\s*(?:\.\.\.\([^)]*\)|(\w+)\s*(?::|(?=,|$)))/g)) if (f[1]) names.add(f[1]);
console.log("  field names passed to log() in agent.ts/cli.ts: " + [...names].sort().join(", "));
ok(![...names].some(n => /key|secret|seed|private|password|token|mnemonic/i.test(n)), "no call site passes a key-like field name");
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
