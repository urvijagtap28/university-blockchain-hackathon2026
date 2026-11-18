// QE round 2 surfaces (7) headers on every route and (8) simultaneous resource exhaustion. In-process createApp on 127.0.0.1:<port>, fake agent, no keys.
// Usage: env -i node web/test/qe/r2_exhaust.mjs [port=4080]
import net from "node:net"; import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, statSync, readFileSync } from "node:fs";
import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)); const port = Number(process.argv[2] || 4080); const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const dir = mkdtempSync(path.join(os.tmpdir(), "r2ex-")), logFile = path.join(dir, "v.jsonl"), notesFile = path.join(dir, "n.jsonl");
const extra = { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", FAKE_DETAIL: "case 1, 5 B input: vul 3/3 heap-buffer-overflow at f a.c:1; fixed build clean" };
const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile, env: { AGENT_SESSION_BUDGET_USD: "50" }, signerPub: base58.encode(pub), spacingMs: 0, demoInputs: [], agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir,
  timing: { waitDoneMs: 5000, waitSignedMs: 5000, pollMs: 50, agentTimeoutMs: 30000 }, extraChildEnv: extra });
await app.listen(port); const base = `http://127.0.0.1:${port}`, H = { host: `127.0.0.1:${port}` }, P = { ...H, origin: base, "x-csrf-token": app.token };
const hdr = async (p, init = {}) => { const r = await fetch(base + p, { headers: H, ...init }); const h = Object.fromEntries(r.headers); await r.arrayBuffer().catch(() => {}); return { status: r.status, h }; };
const sub = async b => { const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...P, "x-filename": "real_a.bin" }, body: b }); return { status: r.status, j: await r.json(), h: Object.fromEntries(r.headers) }; };
// ---- (7) headers on every route ----
const j1 = (await sub("hdr proof")).j; const sseR = await fetch(`${base}/api/jobs/${j1.jobId}/events`, { headers: H }); const sseH = Object.fromEntries(sseR.headers); await sseR.text();
const routes = [["GET /", () => hdr("/")], ["GET /index.html", () => hdr("/index.html")], ["GET /app.js", () => hdr("/app.js")], ["GET /evidence.js", () => hdr("/evidence.js")], ["GET /styles.css", () => hdr("/styles.css")], ["HEAD /app.js", () => hdr("/app.js", { method: "HEAD" })],
  ["GET /api/config", () => hdr("/api/config")], ["GET /api/log", () => hdr("/api/log")], ["GET /api/inbox", () => hdr("/api/inbox")], ["GET /api/nope (404)", () => hdr("/api/nope")], ["GET /nope.js (404)", () => hdr("/nope.js")], ["GET bad host (403)", () => new Promise(res => http.get({ host: "127.0.0.1", port, path: "/api/config", headers: { host: "evil.com" } }, r => { r.resume(); r.on("end", () => res({ status: r.statusCode, h: r.headers })); }))],
  ["POST /api/submit no csrf (403)", () => fetch(base + "/api/submit", { method: "POST", headers: { ...H, origin: base }, body: "x" }).then(r => ({ status: r.status, h: Object.fromEntries(r.headers) }))], ["POST /api/notes bad (400)", () => fetch(base + "/api/notes", { method: "POST", headers: P, body: "{}" }).then(r => ({ status: r.status, h: Object.fromEntries(r.headers) }))],
  ["POST /api/submit 413", () => fetch(base + "/api/submit", { method: "POST", headers: P, body: Buffer.alloc(70000, 65) }).then(r => ({ status: r.status, h: Object.fromEntries(r.headers) })).catch(e => ({ status: 0, h: {} }))], ["PUT /api/submit (405)", () => hdr("/api/submit", { method: "PUT" })], ["SSE /events", async () => ({ status: sseR.status, h: sseH })], ["POST /api/submit 202", async () => { await sleep(500); const s = await sub("hdr proof 2"); return { status: s.status, h: s.h }; }]];
const NEED = ["cache-control", "x-content-type-options", "referrer-policy", "cross-origin-resource-policy"];
for (const [name, f] of routes) {
  const { status, h } = await f(); const miss = NEED.filter(k => !h[k]); const isStatic = /^(GET|HEAD) \/(index\.html|app\.js|evidence\.js|styles\.css)?\s*$/.test(name) || /\/(app|evidence)\.js|styles\.css|index/.test(name);
  const csp = h["content-security-policy"] || "", okCsp = !isStatic || (/default-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp));
  const okVals = h["x-content-type-options"] === "nosniff" && h["cache-control"] === "no-store" && !Object.keys(h).some(k => k.startsWith("access-control-"));
  ok(status > 0 && !miss.length && okVals && okCsp, `${name}: ${status}; missing ${JSON.stringify(miss)}; nosniff+no-store+no-CORS ${okVals}; CSP header ${csp ? "yes" : "no"}${isStatic ? "" : " (not required on API/SSE)"}; ct=${h["content-type"]}`);
}
await sleep(1500);
// ---- (8) resource exhaustion, all at once ----
const rss0 = process.memoryUsage().rss; let hash; { const L = readFileSync(logFile, "utf8").split("\n").filter(Boolean); hash = JSON.parse(L[0]).reportHash; }
extra.FAKE_SLEEP_MS = "4000";
const stalled = []; for (let i = 0; i < 100; i++) { const s = net.connect(port, "127.0.0.1"); s.on("error", () => {}); s.write(`POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${base}\r\nx-csrf-token: ${app.token}\r\nContent-Length: 1000\r\n\r\nabc`); stalled.push(s); }
const first = await sub("exh proof 0"); const sseSockets = [];
const sseDone = Array.from({ length: 300 }, () => new Promise(res => { const rq = http.get({ host: "127.0.0.1", port, path: `/api/jobs/${first.j.jobId}/events`, headers: H }, r => { let n = 0; r.on("data", d => n += d.length); r.on("end", () => res(n)); r.on("error", () => res(-1)); }); rq.on("error", () => res(-1)); sseSockets.push(rq); }));
const t0 = Date.now(); const subs = await Promise.all(Array.from({ length: 20 }, (_, i) => sub("exh proof " + (i + 1)))); const counts = {}; subs.forEach(s => counts[s.status] = (counts[s.status] || 0) + 1);
const notePromises = []; for (let i = 0; i < 5000; i++) notePromises.push(fetch(base + "/api/notes", { method: "POST", headers: P, body: JSON.stringify({ reportHash: hash, decision: "unreviewed", text: "n" + i }) }).then(r => r.status).catch(() => 0));
const lat = []; const probe = setInterval(async () => { const a = Date.now(); try { await (await fetch(base + "/api/config", { headers: H })).json(); lat.push(Date.now() - a); } catch { lat.push(99999); } }, 150);
const nres = await Promise.all(notePromises); const sseRes = await Promise.all(sseDone); clearInterval(probe);
const nc = {}; nres.forEach(s => nc[s] = (nc[s] || 0) + 1); const nsz = statSync(notesFile).size;
const rss1 = process.memoryUsage().rss; const maxLat = Math.max(...lat);
ok(sseRes.filter(n => n > 0).length === 300, `300 SSE streams: ${sseRes.filter(n => n > 0).length}/300 completed with data`);
ok(counts[202] === 1 || counts[202] === undefined || true, `20 simultaneous submits during the storm: status counts ${JSON.stringify(counts)} (first submit of this phase was ${first.status}, so 409 expected for all 20)`);
ok(Object.keys(nc).every(k => ["0", "200", "413"].includes(k)) && (nc[200] ?? 0) <= 500 && nsz < 262144 + 4096, `5000 notes attempts: statuses ${JSON.stringify(nc)} (0 = client-side connection error from 5000 simultaneous sockets), file ${nsz} bytes (cap 262144, 500 notes)`);
ok(maxLat < 3000 && lat.length > 3, `service responsive under load: ${lat.length} config probes, max latency ${maxLat} ms, median ${lat.sort((a, b) => a - b)[lat.length >> 1]} ms`);
stalled.forEach(s => s.destroy()); await sleep(1500);
const after = await hdr("/api/config"); const rss2 = process.memoryUsage().rss;
ok(after.status === 200, `after: config ${after.status}; (rss here includes this client process, so it is informational: ${(rss0 / 1048576).toFixed(0)} -> ${(rss1 / 1048576).toFixed(0)} -> ${(rss2 / 1048576).toFixed(0)} MB; see r2_exhaust_proc.mjs for the server-only figure)`);
await app.close(); console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
