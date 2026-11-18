// QE_WEB_SECURITY: serves the real web/public UI with XSS payloads in demo labels, verdict detail and notes. 127.0.0.1 only, fake agent, canary env.
// Usage: env -i node web/test/qe/xss_server.mjs <port> <run-dir>   (prints READY when seeded)
import { generateKeyPairSync, createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]), dir = process.argv[3]; mkdirSync(dir, { recursive: true });
const P = ['<img src=x onerror="window.__xss=1">', '<script>window.__xss=1</script>', '"><svg onload="window.__xss=1">', "'-alert(1)-'", '<a href="javascript:window.__xss=1">x</a>', "</textarea></div><b id=injected>BOLD</b>", "{{7*7}} ${7*7} %s"];
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const kp = base58.encode(Buffer.concat([seed, pub])), logFile = path.join(dir, "verdicts.jsonl");
const f = path.join(dir, "demo1.bin"); writeFileSync(f, "xss-demo-proof");
const sha = createHash("sha256").update("xss-demo-proof").digest("hex");
const demo = [{ id: "real_bug_1", label: P[0] + P[1], category: "real_bug", handMade: false, sizeBytes: 14, abs: f, sha }];
const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "notes.jsonl"), env: { AGENT_SVM_PRIVATE_KEY: "CANARY" + "Z".repeat(50) }, signerPub: base58.encode(pub), buyerAddr: P[2], payTo: P[3],
  agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, spacingMs: 0, demoInputs: demo,
  extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: kp, FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", FAKE_DETAIL: P.join(" | ") + " heap-buffer-overflow at ucl_lex <img src=x onerror=window.__xss=1> ucl_parser.c:1036" } });
await app.listen(port);
const base = `http://127.0.0.1:${port}`, H = { host: `127.0.0.1:${port}`, origin: base, "x-csrf-token": app.token };
const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...H, "x-demo-input-id": "real_bug_1" } }); const j = await r.json();
await (await fetch(`${base}/api/jobs/${j.jobId}/events`, { headers: { host: H.host } })).text();
await fetch(base + "/api/notes", { method: "POST", headers: H, body: JSON.stringify({ reportHash: sha, decision: "valid", text: P.join(" ") }) });
console.log("READY", base);
