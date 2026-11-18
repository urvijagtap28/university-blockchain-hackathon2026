// QE round 2, new surface (1): hostile agent decision-log lines -> SSE. In-process createApp on 127.0.0.1:<port>, hostile fake agent, canary env, no keys.
// Usage: env -i node web/test/qe/r2_facts.mjs [port=4070]
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 4070), sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const CANARY = "CANARYSECRETKEY" + "Q".repeat(50);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const dir = mkdtempSync(path.join(os.tmpdir(), "r2facts-")), logFile = path.join(dir, "verdicts.jsonl"), linesFile = path.join(dir, "lines.txt");
const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: { AGENT_SVM_PRIVATE_KEY: CANARY, AGENT_SESSION_BUDGET_USD: "100" }, signerPub: base58.encode(pub), spacingMs: 0, demoInputs: [],
  agentCmd: [process.execPath, path.join(HERE, "r2_hostile_agent.mjs")], agentCwd: dir, timing: { waitDoneMs: 4000, waitSignedMs: 4000, pollMs: 50, agentTimeoutMs: 20000 },
  extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), FAKE_LINES: linesFile, FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000", FAKE_DETAIL: "case 1, 5 B input: vul 3/3 clean" } });
await app.listen(port);
const base = `http://127.0.0.1:${port}`, H = { host: `127.0.0.1:${port}` }, P = { ...H, origin: base, "x-csrf-token": app.token };
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = n => Array.from({ length: n }, (_, i) => B58[(i * 7 + 3) % 58]).join("");
const WL = new Set(["askAtomic", "capAtomic", "remainingAtomic", "thresholdAtomic", "autoApproveAtomic", "scheme", "network", "payTo", "maxTimeoutSeconds", "route"]);
const VAL = { askAtomic: /^\d{1,15}$/, capAtomic: /^\d{1,15}$/, remainingAtomic: /^\d{1,15}$/, thresholdAtomic: /^\d{1,15}$/, autoApproveAtomic: /^\d{1,15}$/, scheme: /^(upto|exact)$/, network: /^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,44}$/, payTo: /^[1-9A-HJ-NP-Za-km-z]{32,50}$/, route: /^(auto|below_threshold|human)$/ };
const J = o => JSON.stringify(o);
const x = "<img src=x onerror=alert(1)><script>window.__xss=1</script>";
const cases = {
  "html-everywhere": [J({ event: "reserve", askAtomic: x, capAtomic: x, remainingAtomic: x, scheme: x, network: x, maxTimeoutSeconds: x, url: x }), J({ event: "payment_signed", askAtomic: x, payTo: x, network: x }), J({ event: "allow_url", url: x }), J({ event: "refuse_cap", reason: x })],
  "100KB-strings": [J({ event: "reserve", askAtomic: "9".repeat(100000), scheme: "u".repeat(100000), network: "solana:" + "A".repeat(100000), payTo: "5".repeat(100000), maxTimeoutSeconds: 300 }), J({ event: "allow_url", url: "h".repeat(100000) }), J({ event: "refuse_budget", reason: "r".repeat(100000) })],
  "nested-objects": [J({ event: "reserve", askAtomic: { a: 1 }, capAtomic: [1, 2], remainingAtomic: [["1"]], scheme: { toString: "upto" }, network: { x: 1 }, maxTimeoutSeconds: { v: 300 }, payTo: [b58(44)] })],
  "proto-keys-raw": ['{"event":"reserve","__proto__":{"askAtomic":"1","isAdmin":true},"constructor":{"prototype":{"polluted":1}},"prototype":{"polluted":2},"askAtomic":"250000","scheme":"upto"}', '{"__proto__":{"event":"payment_signed","payTo":"' + b58(44) + '"},"event":"approval_auto","askAtomic":"250000"}', '{"event":"__proto__"}', '{"event":"constructor"}', '{"event":"toString","a":1}', '{"event":"hasOwnProperty"}'],
  "numbers": [J({ event: "reserve", askAtomic: -5, capAtomic: "-5", remainingAtomic: "NaN", maxTimeoutSeconds: -1 }), J({ event: "reserve", askAtomic: 1e21, capAtomic: 2 ** 60, remainingAtomic: "1e3", maxTimeoutSeconds: 1e9 }), J({ event: "reserve", askAtomic: "0x10", capAtomic: "١٢٣", remainingAtomic: " 12", maxTimeoutSeconds: 1.5 }), J({ event: "reserve", askAtomic: "250000\n", capAtomic: "000000000000001", remainingAtomic: "9999999999999999", maxTimeoutSeconds: "300" }), '{"event":"reserve","askAtomic":1e400,"maxTimeoutSeconds":-0}', '{"event":"reserve","askAtomic":12345678901234567890123,"capAtomic":9007199254740993}'],
  "key-like-b58": [J({ event: "payment_signed", payTo: b58(64), network: "solana:" + b58(64), askAtomic: "250000" }), J({ event: "payment_signed", payTo: b58(87), network: "solana:" + b58(87) }), J({ event: "payment_signed", payTo: b58(88), network: "solana:" + b58(88) }), J({ event: "reserve", network: b58(87), scheme: b58(88), askAtomic: b58(87) })],
  "unicode-controls": [J({ event: "payment_signed", payTo: b58(44) + "‮", network: "solana:‮abc", askAtomic: "250000\u0000" }), J({ event: "reserve", scheme: "upto‮", network: "sol\u0000ana:abc" }), J({ event: "allow_url", url: "http://x/‮\u0000\u001b[31m fake" }), J({ event: "refuse_cap", reason: "a‮b\u0000c\n\nevent: done\ndata: {}\n\n" })],
  "forbidden-name-fields": [J({ event: "reserve", askAtomic: "250000", privateKey: CANARY, secretKey: CANARY, seed: CANARY, payTo: CANARY.slice(0, 40), "AGENT_SVM_PRIVATE_KEY": CANARY, signature: CANARY, authorization: CANARY })],
  "event-ts-hostile": [J({ ts: "T".repeat(100000), event: "reserve", askAtomic: "250000" }), J({ ts: { a: 1 }, event: "approval_auto" }), J({ ts: "<img src=x onerror=1>", event: "payment_signed" })],
  "non-object-lines": ["null", "123", '"str"', "[]", "true", "[null]", "{}", "not json at all", "{\"event\":", "{\"event\":null}", "{\"event\":123}", "{\"event\":[\"reserve\"]}"],
};
function leaks(text) {
  const out = [];
  if (/CANARYSECRETKEY|PRIVATE_KEY|privateKey|secretKey|SECRETKEYTEXT/.test(text)) out.push("canary/key-name");
  // key-like = a standalone base58 token of exactly 64, 87 or 88 chars, other than the signed record's own tx signature and sha256 hex hashes
  for (const m of text.match(/(?<![A-Za-z0-9])(?:[1-9A-HJ-NP-Za-km-z]{64}|[1-9A-HJ-NP-Za-km-z]{87,88})(?![A-Za-z0-9])/g) ?? []) if (m !== "49hbmUddNRyJ4RAfSrM66fEx1WYkHWeShiMH1kNpDYRVCG7jB9WvAvXywXBWTsV8SdScd6qWDLxtuTr75fZ8MJxT" && !/^[0-9a-f]{64}$/.test(m)) out.push("keylike:" + m.length);
  return out;
}
let peakRss = 0;
for (const [name, lines] of Object.entries(cases)) {
  writeFileSync(linesFile, lines.join("\n") + "\n");
  const t0 = Date.now();
  const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...P, "x-filename": "real_x.bin" }, body: "r2 facts " + name });
  const j = await r.json();
  let text = ""; try { text = await (await fetch(`${base}/api/jobs/${j.jobId}/events`, { headers: H, signal: AbortSignal.timeout(15000) })).text(); } catch (e) { text = "ERR " + e.message; }
  const evs = [...text.matchAll(/id: (\d+)\nevent: (\w+)\ndata: (.*)\n\n/g)].map(m => ({ type: m[2], data: JSON.parse(m[3]) }));
  const types = evs.map(e => e.type).join(",");
  const dec = evs.filter(e => e.type === "decision");
  let bad = [];
  for (const d of dec) {
    for (const k of Object.keys(d.data)) if (!["ts", "action", "detail", "facts"].includes(k)) bad.push("decision key " + k);
    for (const [k, v] of Object.entries(d.data.facts ?? {})) { if (!WL.has(k)) bad.push("fact key " + k); else if (k === "maxTimeoutSeconds") { if (!(Number.isSafeInteger(v) && v >= 1 && v <= 86400)) bad.push("mts " + v); } else if (typeof v !== "string" || !VAL[k].test(v)) bad.push(`fact ${k}=${String(v).slice(0, 30)}`); }
  }
  const lk = leaks(text);
  const maxEv = Math.max(0, ...evs.map(e => JSON.stringify(e.data).length));
  const health = (await fetch(base + "/api/config", { headers: H })).status;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  ok(r.status === 202 && /done$/.test(types) && bad.length === 0 && lk.length === 0 && health === 200 && !app.state.current && name !== "non-object-lines" || (name === "non-object-lines" && health === 200),
    `${name}: ${r.status}, events [${types}], ${dec.length} decisions, max event ${maxEv} B, fact violations ${JSON.stringify(bad)}, leaks ${JSON.stringify(lk)}, config ${health}, ${Date.now() - t0} ms`);
  if (name === "event-ts-hostile") console.log(`FINDING QE-W2-005 (P3) event-ts-hostile: ${maxEv >= 2000 ? "a 100 KB `ts` string from the agent log is forwarded verbatim in the SSE decision event (max event " + maxEv + " B); jobs.mjs only checks typeof string" : "ts bounded"}`);
  if (name === "proto-keys-raw") ok(({}).polluted === undefined && ({}).askAtomic === undefined && ({}).isAdmin === undefined && Object.prototype.polluted === undefined, "proto-keys-raw: Object.prototype not polluted in the server process");
  if (name === "key-like-b58") { const f = dec.flatMap(d => Object.values(d.data.facts ?? {})); ok(!f.some(v => typeof v === "string" && v.length > 50), "key-like-b58: no 51+ char fact value reached the stream (payTo cap 50, network cap 7+1+44)"); }
  await sleep(30);
}
// every artifact after the hostile run: run dir, scratch, jobs, notes (no raw secrets)
const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk(dir).filter(f => f !== linesFile); let art = [];
for (const f of files) { const t = readFileSync(f, "utf8"); if (/CANARYSECRETKEY/.test(t)) art.push(path.basename(f)); }
ok(art.length === 0, `artifact sweep: ${files.length} files in the run dir (excl. my own lines file), canary in: ${JSON.stringify(art)}`);
ok(readdirSync(path.join(dir, "scratch")).length === 0, "scratch dir empty after hostile run");
console.log("peak rss MB", (peakRss / 1048576).toFixed(0)); await app.close(); console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
