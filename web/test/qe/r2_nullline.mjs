// QE round 2: a non-object JSON line ("null") in the agent decision log. (a) agent exits fast (final tail() path), (b) agent still running (setInterval tail() path).
// Own process per case so a crash is observable. Usage: env -i node web/test/qe/r2_nullline.mjs [port=4072]
import { spawn } from "node:child_process"; import path from "node:path"; import { fileURLToPath } from "node:url";
if (process.argv[2] === "child") {
  const [, , , port, sleepMs, line] = process.argv;
  const { generateKeyPairSync } = await import("node:crypto"); const { mkdtempSync, writeFileSync } = await import("node:fs"); const os = await import("node:os");
  const { base58 } = await import("../../../server/node_modules/@scure/base/lib/esm/index.js"); const { createApp } = await import("../../server.mjs");
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const dir = mkdtempSync(path.join(os.tmpdir(), "r2null-")), logFile = path.join(dir, "v.jsonl"), lf = path.join(dir, "l.txt"); writeFileSync(lf, line + "\n");
  const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n"), env: { AGENT_SESSION_BUDGET_USD: "2" }, signerPub: base58.encode(pub), spacingMs: 0, demoInputs: [],
    agentCmd: [process.execPath, path.join(HERE, "r2_hostile_agent.mjs")], agentCwd: dir, timing: { waitDoneMs: 3000, waitSignedMs: 3000, pollMs: 50, agentTimeoutMs: 20000 },
    extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), FAKE_LINES: lf, FAKE_SLEEP_MS: sleepMs, FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000", FAKE_DETAIL: "case 1, 5 B input: vul 3/3 clean" } });
  const p = await app.listen(Number(port)); const base = `http://127.0.0.1:${p}`, H = { host: `127.0.0.1:${p}` };
  const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...H, origin: base, "x-csrf-token": app.token, "x-filename": "real_x.bin" }, body: "nullline " + sleepMs + line });
  const j = await r.json(); const t = await (await fetch(`${base}/api/jobs/${j.jobId}/events`, { headers: H })).text();
  const { readFileSync } = await import("node:fs");
  console.log("RESULT events=" + [...t.matchAll(/event: (\w+)/g)].map(m => m[1]).join(",") + " budget=" + JSON.stringify(app.budget.snapshot()) + " log_records=" + readFileSync(logFile, "utf8").split("\n").filter(Boolean).length);
  process.exit(0);
}
const HERE = path.dirname(fileURLToPath(import.meta.url)); let port = Number(process.argv[2] || 4072);
for (const [name, sleepMs, line] of [["null, agent exits fast", "0", "null"], ["null, agent still running 1500 ms", "1500", "null"], ["array, agent still running", "1500", "[1]"], ["number, agent still running", "1500", "123"]]) {
  await new Promise(res => { const c = spawn(process.execPath, [path.join(HERE, "r2_nullline.mjs"), "child", String(port++), sleepMs, line], { env: {}, stdio: ["ignore", "pipe", "pipe"] }); let o = ""; c.stdout.on("data", d => o += d); c.stderr.on("data", d => o += d);
    c.on("exit", (code, sig) => { console.log(`${name}: exit ${code}${sig ? " " + sig : ""}; ${(/RESULT.*/.exec(o) ?? [o.trim().split("\n").slice(0, 3).join(" / ").slice(0, 300)])[0]}`); res(); }); });
}
