// QE_WEB_SECURITY: server with a hanging fake agent, to test what happens to the child when the server dies. Usage: env -i node orphan_server.mjs <port> <dir>
import path from "node:path"; import { fileURLToPath } from "node:url"; import { mkdirSync } from "node:fs";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)); const [port, dir] = [Number(process.argv[2]), process.argv[3]]; mkdirSync(dir, { recursive: true });
const app = createApp({ mode: "stub", runDir: dir, env: {}, notesFile: path.join(dir, "n.jsonl"), agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, spacingMs: 0, demoInputs: [], signerPub: "x", extraChildEnv: { FAKE_SCENARIO: "hang", FAKE_LOG_FILE: path.join(dir, "v.jsonl") } });
await app.listen(port);
const base = `http://127.0.0.1:${port}`; const r = await fetch(base + "/api/submit", { method: "POST", headers: { host: `127.0.0.1:${port}`, origin: base, "x-csrf-token": app.token }, body: "orphan-test" });
console.log("CHILDPID", app.state.child?.pid, r.status);
