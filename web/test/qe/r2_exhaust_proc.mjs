// QE round 2 (8): server-only memory under load. Spawns the REAL web/server.mjs (preload swaps the agent for a hanging fake child), measures its RSS with `ps`.
// 100 stalled bodies + 300 SSE streams on the live job + 20 simultaneous submits + 5000 notes attempts (400s: no log record) + 2000 junk GETs. Usage: env -i node r2_exhaust_proc.mjs [port=4082]
import { spawn, execFileSync } from "node:child_process"; import net from "node:net"; import http from "node:http";
import { mkdtempSync } from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../.."); const sleep = ms => new Promise(r => setTimeout(r, ms));
const port = Number(process.argv[2] || 4082), dir = mkdtempSync(path.join(os.tmpdir(), "r2proc-")); let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const srv = spawn(process.execPath, ["--import", path.join(HERE, "r2_preload_hang.mjs"), path.join(ROOT, "web/server.mjs")], { env: { WEB_MODE: "stub", WEB_PORT: String(port), WEB_RUN_DIR: dir, PATH: process.env.PATH ?? "" }, stdio: "ignore" });
await sleep(1500); const rss = () => Number(execFileSync("/bin/ps", ["-o", "rss=", "-p", String(srv.pid)], { encoding: "utf8" }).trim()) / 1024;
const base = `http://127.0.0.1:${port}`, H = { host: `127.0.0.1:${port}` }; const tok = (await (await fetch(base + "/api/config", { headers: H })).json()).csrfToken, P = { ...H, origin: base, "x-csrf-token": tok };
const r0 = rss(); const hist = [];
for (let round = 1; round <= 3; round++) {
  const stalled = []; for (let i = 0; i < 100; i++) { const s = net.connect(port, "127.0.0.1"); s.on("error", () => {}); s.write(`POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nx-csrf-token: ${tok}\r\nContent-Length: 1000\r\n\r\nabc`); stalled.push(s); }
  let jid; for (let t = 0; t < 40 && !jid; t++) { const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...P, "x-filename": "real_a.bin" }, body: "proc exhaust " + round }); if (r.status === 202) jid = (await r.json()).jobId; else { await r.arrayBuffer(); await sleep(500); } }
  const socks = []; for (let i = 0; i < 300; i++) { const rq = http.get({ host: "127.0.0.1", port, path: `/api/jobs/${jid}/events`, headers: H }, r => { r.on("data", () => {}); r.on("error", () => {}); }); rq.on("error", () => {}); socks.push(rq); }
  await sleep(1000);
  const subs = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(base + "/api/submit", { method: "POST", headers: P, body: "x" + i }).then(r => r.status).catch(() => 0)));
  const notes = await Promise.all(Array.from({ length: 5000 }, () => fetch(base + "/api/notes", { method: "POST", headers: P, body: JSON.stringify({ reportHash: "a".repeat(64), decision: "valid", text: "t".repeat(400) }) }).then(r => r.status).catch(() => 0)));
  await Promise.all(Array.from({ length: 2000 }, () => fetch(base + "/api/inbox", { headers: H }).then(r => r.arrayBuffer()).catch(() => 0)));
  const peak = rss(); socks.forEach(r => r.destroy()); stalled.forEach(s => s.destroy()); await sleep(2000);
  const cnt = a => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {}); hist.push(rss());
  console.log(`round ${round}: submits ${JSON.stringify(cnt(subs))}; notes ${JSON.stringify(cnt(notes))}; server RSS peak ${peak.toFixed(0)} MB, 2 s after ${hist[round - 1].toFixed(0)} MB`);
}
const lat = []; for (let i = 0; i < 5; i++) { const a = Date.now(); try { await (await fetch(base + "/api/config", { headers: H })).json(); lat.push(Date.now() - a); } catch { lat.push(99999); } }
ok(Math.max(...lat) < 1000, `server responsive after 3 rounds: config latencies ${JSON.stringify(lat)} ms`);
ok(hist[2] - hist[1] < 30, `no unbounded growth: RSS after round 1/2/3 = ${hist.map(x => x.toFixed(0)).join("/")} MB (start ${r0.toFixed(0)}); round 3 - round 2 = ${(hist[2] - hist[1]).toFixed(0)} MB (< 30 MB: plateau, not a per-request leak)`);
srv.kill("SIGTERM"); await sleep(500); console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
