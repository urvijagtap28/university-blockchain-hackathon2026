// QE round 2, QE-W-002: REAL web/server.mjs main block (node --import preload swaps the agent for a long-running fake child).
// For SIGTERM, SIGINT, SIGHUP: submit, wait for child, signal the server, assert the child is gone. SIGKILL: document the orphan.
// Usage: env -i node web/test/qe/r2_signals.mjs [basePort=4062]. Loopback only, no keys.
import { spawn, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../..");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port = Number(process.argv[2] || 4062), fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const kids = ppid => { try { return execSync(`/usr/bin/pgrep -P ${ppid}`, { encoding: "utf8" }).split("\n").filter(Boolean).map(Number); } catch { return []; } };
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP", "SIGKILL"]) {
  const p = port++, dir = mkdtempSync(path.join(os.tmpdir(), "r2sig-"));
  const srv = spawn(process.execPath, ["--import", path.join(HERE, "r2_preload_hang.mjs"), path.join(ROOT, "web/server.mjs")], { env: { WEB_MODE: "stub", WEB_PORT: String(p), WEB_RUN_DIR: dir, PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
  let so = ""; srv.stdout.on("data", d => so += d); srv.stderr.on("data", d => so += d);
  for (let i = 0; i < 50 && !so.includes("listening"); i++) await sleep(100);
  const base = `http://127.0.0.1:${p}`, h = { host: `127.0.0.1:${p}` };
  const cfg = await (await fetch(base + "/api/config", { headers: h })).json();
  const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...h, origin: base, "x-csrf-token": cfg.csrfToken, "x-filename": "real_a.bin" }, body: "sig-test-" + sig });
  await sleep(1500);
  const kid = kids(srv.pid)[0];
  ok(r.status === 202 && kid > 0 && alive(kid), `${sig}: submit ${r.status}, real child pid ${kid} running under server pid ${srv.pid}`);
  srv.kill(sig); await sleep(1500);
  if (sig === "SIGKILL") {
    ok(true, `${sig} (documented LIMITATION): server alive=${alive(srv.pid)}, child alive=${alive(kid)} (orphan expected)`);
    if (alive(kid)) process.kill(kid, "SIGKILL"); // clean up our own orphan
  } else ok(!alive(srv.pid) && !alive(kid), `${sig}: server gone (${!alive(srv.pid)}), child gone (${!alive(kid)})`);
  if (alive(srv.pid)) srv.kill("SIGKILL");
}
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
