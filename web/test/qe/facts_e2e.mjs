// D-019/D-020 key-free end-to-end: in-process web app + fake agent replaying the real agent's decision-log field set (FAKE_REALISTIC).
// Prints the raw SSE transcript. Usage: env -i node web/test/qe/facts_e2e.mjs [port]   (use 4050-4059 only)
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 4053);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const dir = mkdtempSync(path.join(os.tmpdir(), "factse2e-")), logFile = path.join(dir, "verdicts.jsonl");
const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: { PATH: process.env.PATH ?? "" }, signerPub: base58.encode(pub), spacingMs: 0,
  agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, timing: { waitDoneMs: 5000, waitSignedMs: 5000, pollMs: 100, agentTimeoutMs: 20000 },
  extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), FAKE_REALISTIC: "1", FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000", FAKE_DETAIL: "case 42482847, 5 B input: vul 3/3 clean" } });
await app.listen(port);
const base = `http://127.0.0.1:${port}`, H = { host: `127.0.0.1:${port}`, origin: base, "x-csrf-token": app.token, "content-type": "application/octet-stream", "x-filename": "real_x.bin" };
const j = await (await fetch(base + "/api/submit", { method: "POST", headers: H, body: "e2e proof bytes" })).json();
console.log((await (await fetch(`${base}/api/jobs/${j.jobId}/events`, { headers: { host: H.host } })).text()).trim());
process.exit(0);
