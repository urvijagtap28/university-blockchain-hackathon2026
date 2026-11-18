// QE round 3 (QE-W3-001): a non-object JSON line (`null`) in the VERDICT log (verdicts.jsonl, not the per-job decision log fixed in round 2).
// Run: env -i PATH=/usr/bin:/bin HOME=$HOME node web/test/qe/r3_nullverdict.mjs [port=4300]. In-process, fake agent, no keys.
import http from "node:http"; import { generateKeyPairSync } from "node:crypto"; import { mkdtempSync, writeFileSync } from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js"; import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), sleep = ms => new Promise(r => setTimeout(r, ms)); let port = Number(process.argv[2] || 4300);
const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const s = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), p = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const kp = base58.encode(Buffer.concat([s, p])); let fails = 0;
for (const bad of ["null", "12", "[]", '"x"', "{}"]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qer3n-")), logFile = path.join(dir, "verdicts.jsonl"); writeFileSync(logFile, bad + "\n");
  const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: { AGENT_SVM_PRIVATE_KEY: "CANARY" + "Q".repeat(50) }, signerPub: base58.encode(p), agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, spacingMs: 0, timing: { waitDoneMs: 800, waitSignedMs: 800, pollMs: 50, agentTimeoutMs: 20000 }, demoInputs: [], extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: kp, FAKE_SETTLED: "0" } });
  const pt = await app.listen(port++), H = { host: `127.0.0.1:${pt}`, origin: `http://127.0.0.1:${pt}`, "x-csrf-token": app.token };
  const get = async u => (await fetch(`http://127.0.0.1:${pt}${u}`, { headers: { host: H.host } })).status;
  const r = await fetch(`http://127.0.0.1:${pt}/api/submit`, { method: "POST", headers: { ...H, "x-filename": "real_x.bin" }, body: "proof" }); const j = await r.json();
  const ev = await (await fetch(`http://127.0.0.1:${pt}/api/jobs/${j.jobId}/events`, { headers: { host: H.host } })).text();
  const types = [...ev.matchAll(/^event: (\w+)/gm)].map(m => m[1]);
  const bad500 = await get("/api/log"), inbox = await get("/api/inbox");
  const ok = bad500 === 200 && types.includes("verdict");
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} verdict-log first line ${bad}: /api/log ${bad500}, /api/inbox ${inbox}, job events [${types}], budget ${JSON.stringify(app.budget.snapshot())}`);
  await app.close();
}
process.exit(fails ? 1 : 0);
