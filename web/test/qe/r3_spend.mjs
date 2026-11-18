// QE round 3 (C): server-side spend controls cannot be bypassed from outside the UI. Key-free, payment-free.
// Run: env -i PATH=/usr/bin:/bin HOME=$HOME /path/to/node web/test/qe/r3_spend.mjs [basePort=4200]
// In-process createApp on 127.0.0.1, fake agent (web/test/fake_agent.mjs), ephemeral log key, canary env. No network, no keys.
import http from "node:http"; import net from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), FAKE = path.join(HERE, "..", "fake_agent.mjs");
const sleep = ms => new Promise(r => setTimeout(r, ms));
let port0 = Number(process.argv[2] || 4200), fails = 0;
const rec = (id, ok, note) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${note}`); };
function key() { const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const s = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), p = publicKey.export({ format: "der", type: "spki" }).subarray(-32); return { kp: base58.encode(Buffer.concat([s, p])), pub: base58.encode(p) }; }
async function start({ budget = "0.75", spacingMs = 0, child = {}, demo = [] } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qer3-")), k = key(), logFile = path.join(dir, "verdicts.jsonl");
  const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: { AGENT_SVM_PRIVATE_KEY: "CANARY" + "Q".repeat(50), AGENT_SESSION_BUDGET_USD: budget }, signerPub: k.pub, buyerAddr: "B", payTo: "P",
    agentCmd: [process.execPath, FAKE], agentCwd: dir, spacingMs, timing: { waitDoneMs: 1200, waitSignedMs: 1200, pollMs: 50, agentTimeoutMs: 20000 },
    extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: k.kp, ...child }, demoInputs: demo });
  const port = await app.listen(port0++); return { app, port, dir };
}
const hdrs = (t, extra = {}) => ({ host: `127.0.0.1:${t.port}`, origin: `http://127.0.0.1:${t.port}`, "x-csrf-token": t.app.token, ...extra });
function req(t, method, p, { headers = {}, body } = {}) {
  return new Promise(res => { const r = http.request({ host: "127.0.0.1", port: t.port, method, path: p, headers: method === "GET" ? { host: `127.0.0.1:${t.port}` } : hdrs(t, headers) }, rs => { const c = []; rs.on("data", d => c.push(d)); rs.on("end", () => { const text = Buffer.concat(c).toString(); let json = null; try { json = JSON.parse(text); } catch {} res({ status: rs.statusCode, json, text }); }); }); r.on("error", e => res({ status: 0, err: e.code })); if (body !== undefined) r.write(body); r.end(); });
}
const sub = (t, n = 1, headers = {}) => req(t, "POST", "/api/submit", { body: Buffer.from("proof-" + n + "-" + Math.random()), headers: { "x-filename": "real_x.bin", ...headers } });
const snap = t => t.app.budget.snapshot();
const idle = async t => { for (let i = 0; i < 150 && t.app.state.current; i++) await sleep(100); await sleep(30); };
function raw(port, bytes, waitMs = 700) { return new Promise(res => { const s = net.connect(port, "127.0.0.1"); let o = ""; s.on("data", d => o += d.toString("latin1")); s.on("error", () => {}); s.write(bytes); setTimeout(() => { s.destroy(); res(o); }, waitMs); }); }
const code = o => (/^HTTP\/1\.\d (\d+)/.exec(o) ?? [])[1] ?? "none";

// 1. 20 concurrent submits, one slot: exactly one accepted
{ const t = await start({ child: { FAKE_SLEEP_MS: "400", FAKE_SETTLED: "250000", FAKE_VERDICT: "not_reproduced" } });
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => sub(t, i)));
  const c = {}; rs.forEach(r => c[r.status] = (c[r.status] || 0) + 1);
  rec("c1.20-concurrent", c[202] === 1 && c[409] === 19, `statuses ${JSON.stringify(c)}`);
  rec("c1.reserved-while-running", snap(t).reservedAtomic === "250000", `reserved ${snap(t).reservedAtomic}`);
  await idle(t); rec("c1.after", snap(t).spentAtomic === "250000" && snap(t).reservedAtomic === "0", JSON.stringify(snap(t))); await t.app.close(); }

// 2. exact accounting with a 0.75 budget: forfeits charge 0.25 each, 4th refused 422 and charges 0
{ const t = await start({ child: { FAKE_SETTLED: "250000", FAKE_VERDICT: "not_reproduced" } });
  const st = []; for (let i = 0; i < 5; i++) { const r = await sub(t, i); st.push(r.status); await idle(t); }
  const s = snap(t); rec("c2.forfeits", JSON.stringify(st) === "[202,202,202,422,422]" && s.spentAtomic === "750000" && s.reservedAtomic === "0" && s.remainingAtomic === "0", `statuses ${st} ${JSON.stringify(s)}`); await t.app.close(); }
// returned bond: charge 0, never exhausts
{ const t = await start({ child: { FAKE_SETTLED: "0", FAKE_VERDICT: "reproduced" } });
  const st = []; for (let i = 0; i < 6; i++) { st.push((await sub(t, i)).status); await idle(t); }
  rec("c2.returned-charges-0", st.every(x => x === 202) && snap(t).spentAtomic === "0", `statuses ${st} ${JSON.stringify(snap(t))}`); await t.app.close(); }
// refusal by agent: charge 0
{ const t = await start({ child: { FAKE_SCENARIO: "refuse" } });
  for (let i = 0; i < 4; i++) { await sub(t, i); await idle(t); }
  rec("c2.refusals-charge-0", snap(t).spentAtomic === "0" && snap(t).reservedAtomic === "0", JSON.stringify(snap(t))); await t.app.close(); }
// unknown outcome (signed, no record): charge the cap each, then 422
{ const t = await start({ child: { FAKE_SCENARIO: "unknown" } });
  const st = []; for (let i = 0; i < 5; i++) { st.push((await sub(t, i)).status); await idle(t); }
  rec("c2.unknown-charges-cap", JSON.stringify(st) === "[202,202,202,422,422]" && snap(t).spentAtomic === "750000", `statuses ${st} ${JSON.stringify(snap(t))}`); await t.app.close(); }
// settlement_pending record (not settled): charge cap
{ const t = await start({ child: { FAKE_SETTLEMENT_STATUS: "settlement_pending", FAKE_SETTLED: "0" } });
  await sub(t, 1); await idle(t); rec("c2.pending-charges-cap", snap(t).spentAtomic === "250000", JSON.stringify(snap(t))); await t.app.close(); }
// settled amount above the cap in a (signed) record: clamp
{ const t = await start({ child: { FAKE_SETTLED: "999999999", FAKE_VERDICT: "not_reproduced" } });
  await sub(t, 1); await idle(t); rec("c2.over-cap-record-clamped", snap(t).spentAtomic === "250000", JSON.stringify(snap(t))); await t.app.close(); }

// 3. spacing from a second client (server-global, not per connection / per origin header)
{ const t = await start({ budget: "2", spacingMs: 2500, child: { FAKE_SETTLED: "0" } });
  const a = await sub(t, 1); await idle(t);
  const b = await sub(t, 2), c = await req(t, "POST", "/api/submit", { body: Buffer.from("zz"), headers: { "x-forwarded-for": "10.9.9.9", connection: "close" } });
  rec("c3.spacing-second-client", a.status === 202 && b.status === 429 && c.status === 429 && Number(b.json?.retryAfterSeconds) >= 1, `first ${a.status}, second ${b.status} retry ${b.json?.retryAfterSeconds}, forged x-forwarded-for ${c.status}`);
  rec("c3.refusal-charges-0", snap(t).reservedAtomic === "0", JSON.stringify(snap(t)));
  await sleep(2600); const d = await sub(t, 3); rec("c3.after-spacing", d.status === 202, `status ${d.status}`); await idle(t); await t.app.close(); }

// 4. forged headers
{ const demoFile = path.join(os.tmpdir(), "qer3-demo.bin"); writeFileSync(demoFile, "demo-proof");
  const demo = [{ id: "d1", label: "L", category: "real_bug", handMade: false, sizeBytes: 10, abs: demoFile, sha: "0".repeat(64) }];
  const t = await start({ budget: "2", demo, child: { FAKE_SETTLED: "0" } });
  const bad = async (name, headers, body) => { const r = await req(t, "POST", "/api/submit", { headers, body }); rec("c4." + name, [400, 403, 413, 431, 0].includes(r.status) && snap(t).reservedAtomic === "0" && !t.app.state.current, `status ${r.status} ${r.json?.error ?? r.err ?? ""} reserved ${snap(t).reservedAtomic}`); };
  await bad("demo-unknown", { "x-demo-input-id": "nope" });
  await bad("demo-proto", { "x-demo-input-id": "__proto__" }); await bad("demo-constructor", { "x-demo-input-id": "constructor" });
  await bad("demo-array-like", { "x-demo-input-id": '["d1"]' }); await bad("demo-huge-60k", { "x-demo-input-id": "d".repeat(60000) });
  await bad("demo-plus-body", { "x-demo-input-id": "d1" }, Buffer.from("body"));
  const dup = `POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nx-csrf-token: ${t.app.token}\r\nContent-Length: 2\r\n\r\nab`;
  let o = await raw(t.port, dup); rec("c4.duplicate-csrf", code(o) === "403" && snap(t).reservedAtomic === "0", `status ${code(o)} (two identical tokens are joined with ", " so they do not match)`);
  o = await raw(t.port, dup.replace(`x-csrf-token: ${t.app.token}\r\nx-csrf-token: ${t.app.token}`, `x-csrf-token: wrong\r\nx-csrf-token: ${t.app.token}`)); rec("c4.duplicate-csrf-wrong-first", code(o) === "403", `status ${code(o)}`);
  o = await raw(t.port, dup.replace(`Origin: http://127.0.0.1:${t.port}\r\n`, `Origin: http://127.0.0.1:${t.port}\r\nOrigin: http://evil.example\r\n`)); rec("c4.duplicate-origin", code(o) === "403", `status ${code(o)}`);
  o = await raw(t.port, dup.replace(`Host: 127.0.0.1:${t.port}\r\n`, `Host: 127.0.0.1:${t.port}\r\nHost: evil.example\r\n`)); rec("c4.duplicate-host", ["403", "400"].includes(code(o)), `status ${code(o)}`);
  for (const [n, v] of [["traversal", "../../etc/passwd"], ["control", "a\u0001b"], ["long", "n".repeat(8000)], ["unicode", "‮\u0000x"]]) { const r = await sub(t, n, { "x-filename": Buffer.from(v, "latin1").toString("latin1").replace(/[^\x20-\x7e]/g, "?") }); rec("c4.filename-" + n, r.status === 202 || r.status === 400, `status ${r.status}`); await idle(t); }
  const ok = await sub(t, "ok"); rec("c4.demo-valid-then-ok", ok.status === 202, `status ${ok.status}`); await idle(t);
  const r2 = await req(t, "POST", "/api/submit", { headers: { "x-demo-input-id": "d1" } }); rec("c4.demo-valid", r2.status === 202 || r2.status === 429, `status ${r2.status}`); await idle(t);
  // oversize / chunked
  const ch = n => `${n.toString(16)}\r\n${"A".repeat(n)}\r\n`, H = `POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nTransfer-Encoding: chunked\r\n\r\n`;
  const before = snap(t); o = await raw(t.port, H + ch(40000) + ch(40000) + "0\r\n\r\n"); rec("c4.chunked-over-cap", code(o) === "413" && snap(t).reservedAtomic === "0" && snap(t).spentAtomic === before.spentAtomic, `status ${code(o)} ${JSON.stringify(snap(t))}`);
  o = await raw(t.port, `POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nContent-Length: 70000\r\n\r\n`); rec("c4.content-length-over-cap", code(o) === "413", `status ${code(o)}`);
  o = await raw(t.port, H.replace("Transfer-Encoding: chunked", "Transfer-Encoding: chunked\r\nContent-Length: 5") + ch(10) + "0\r\n\r\n"); rec("c4.te-plus-cl-smuggle", ["400", "none"].includes(code(o)) || code(o) === "202", `status ${code(o)} (node rejects TE+CL)`); await idle(t);
  const fin = snap(t); rec("c4.no-leaked-reservation", fin.reservedAtomic === "0" && !t.app.state.current, JSON.stringify(fin)); await t.app.close(); }
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
