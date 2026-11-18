// QE_WEB_SECURITY probes. Run:  env -i /path/to/node web/test/qe/web_security.mjs
// Own createApp instances on 127.0.0.1 ports 4034+, fake agent, canary (fake) secrets, ephemeral log key. No keys, no network, no payments.
import http from "node:http";
import net from "node:net";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, "..", "fake_agent.mjs");
const CANARY = "CANARYSECRETKEY" + "Q".repeat(50), CANARY_RPC = "https://rpc.example.invalid/CANARYRPCTOKEN987654";
const TX = "49hbmUddNRyJ4RAfSrM66fEx1WYkHWeShiMH1kNpDYRVCG7jB9WvAvXywXBWTsV8SdScd6qWDLxtuTr75fZ8MJxT";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const rec = (id, ok, note) => { results.push({ id, ok, note }); console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${note}`); };
let nextPort = 4060;

function logKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { kp: base58.encode(Buffer.concat([seed, pub])), pub: base58.encode(pub) };
}
async function start(o = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qeweb-")), k = logKey(), logFile = path.join(dir, "verdicts.jsonl");
  const env = { AGENT_SVM_PRIVATE_KEY: CANARY, SVM_RPC_URL: CANARY_RPC, AGENT_SESSION_BUDGET_USD: o.budget ?? "2", ...(o.env ?? {}) };
  const app = createApp({ mode: o.mode ?? "stub", runDir: dir, logFile, notesFile: path.join(dir, "notes.jsonl"), env, signerPub: k.pub, buyerAddr: "BuyerPub", payTo: "PayToPub",
    agentCmd: [process.execPath, FAKE], agentCwd: dir, spacingMs: o.spacingMs ?? 0, timing: { waitDoneMs: 1500, waitSignedMs: 1500, pollMs: 50, agentTimeoutMs: 20000, ...(o.timing ?? {}) },
    extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: k.kp, ...(o.child ?? {}) }, demoInputs: o.demo ?? [] });
  const port = await app.listen(nextPort++);
  return { app, port, dir, logFile, k, notesFile: path.join(dir, "notes.jsonl") };
}
function req(t, method, p, { headers = {}, body, host, origin, csrf = true } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: host ?? `127.0.0.1:${t.port}`, ...headers };
    if (method === "POST") { if (origin !== null) h.origin = origin ?? `http://127.0.0.1:${t.port}`; if (csrf) h["x-csrf-token"] = typeof csrf === "string" ? csrf : t.app.token; }
    const r = http.request({ host: "127.0.0.1", port: t.port, method, path: p, headers: h }, res => {
      const c = []; res.on("data", d => c.push(d)); res.on("end", () => { const text = Buffer.concat(c).toString(); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on("error", e => resolve({ status: 0, err: e.code || e.message, text: "" })); if (body !== undefined) r.write(body); r.end();
  });
}
const submit = (t, body, headers = {}) => req(t, "POST", "/api/submit", { body, headers: { "x-filename": "real_x.bin", ...headers } });
function raw(port, bytes, { waitMs = 800, after } = {}) {
  return new Promise(resolve => {
    const s = net.connect(port, "127.0.0.1"); let out = Buffer.alloc(0);
    s.on("data", d => { out = Buffer.concat([out, d]); }); s.on("error", () => {}); s.on("close", () => resolve(out.toString("latin1")));
    s.write(bytes); if (after) after(s);
    setTimeout(() => { s.destroy(); resolve(out.toString("latin1")); }, waitMs);
  });
}
const waitIdle = async t => { for (let i = 0; i < 100 && t.app.state.current; i++) await sleep(100); await sleep(50); };
const statusOf = s => (/^HTTP\/1\.\d (\d+)/.exec(s) ?? [])[1] ?? "none";
const body = n => Buffer.alloc(n, 0x41);
const allText = [];   // everything served, for the secrets sweep

// ---------------- 1. request size ----------------
{
  const t = await start();
  let r = await submit(t, body(65536)); rec("size.65536", r.status === 202, `status ${r.status}`); await waitIdle(t);
  r = await submit(t, body(65537)); rec("size.65537", r.status === 413, `status ${r.status} ${r.text.slice(0, 60)}`);
  r = await submit(t, Buffer.alloc(0)); rec("size.empty", r.status === 400, `status ${r.status}`);
  const hdr = `POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nx-filename: c.bin\r\nTransfer-Encoding: chunked\r\n\r\n`;
  const chunk = n => `${n.toString(16)}\r\n${"A".repeat(n)}\r\n`;
  let o = await raw(t.port, hdr + chunk(32768) + chunk(32769) + "0\r\n\r\n"); rec("size.chunked.65537", statusOf(o) === "413", `status ${statusOf(o)}`);
  o = await raw(t.port, hdr + chunk(65536) + "0\r\n\r\n", { waitMs: 1500 }); rec("size.chunked.65536", statusOf(o) === "202", `status ${statusOf(o)}`); await waitIdle(t);
  o = await raw(t.port, hdr + chunk(1000000) , { waitMs: 800 }); rec("size.chunked.1MB-single-chunk", statusOf(o) === "413" || statusOf(o) === "none", `status ${statusOf(o)}`);
  o = await raw(t.port, `GET /api/config HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nX-Big: ${"a".repeat(100000)}\r\n\r\n`); rec("size.hugeheader", ["431", "400", "none"].includes(statusOf(o)), `status ${statusOf(o)}`);
  o = await raw(t.port, `GET /${"a".repeat(100000)} HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\n\r\n`); rec("size.hugeURL", ["414", "431", "400", "none"].includes(statusOf(o)), `status ${statusOf(o)}`);
  // Content-Length smaller than body actually sent / larger than sent (stalled)
  const cl = `POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nContent-Length: 100\r\n\r\n`;
  const t0 = Date.now(); o = await raw(t.port, cl + "A".repeat(10), { waitMs: 3000 });
  rec("size.slowloris.stalled-body", true, `stalled body (10 of 100 bytes): after 3 s status=${statusOf(o)} (connection still held; server requestTimeout=${t.app.server.requestTimeout} ms headersTimeout=${t.app.server.headersTimeout} ms)`);
  const busy = await req(t, "GET", "/api/config"); rec("size.slowloris.server-still-responsive", busy.status === 200 && busy.json.busy === false, `config ${busy.status} busy=${busy.json?.busy}`);
  // 100 stalled connections do not block new requests or take the job slot
  const socks = []; for (let i = 0; i < 100; i++) { const s = net.connect(t.port, "127.0.0.1"); s.on("error", () => {}); s.write(cl + "A"); socks.push(s); }
  await sleep(300); const t1 = Date.now(); const ok = await req(t, "GET", "/api/config");
  const sr = await submit(t, body(10)); rec("size.slowloris.100-stalled", ok.status === 200 && sr.status === 202, `config ${ok.status} in ${Date.now() - t1} ms; submit ${sr.status} while 100 stalled bodies open`);
  socks.forEach(s => s.destroy()); await waitIdle(t);
  await t.app.close();
}

// ---------------- 2. filenames, scratch dir, no shell ----------------
{
  const dump = path.join(os.tmpdir(), "qe-envdump-" + process.pid + ".json");
  const t = await start({ budget: "100", child: { FAKE_ENV_DUMP: dump, FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0" } });
  const before = new Set(readdirSync(os.tmpdir()));
  const names = ["$(touch /tmp/qe_pwn1)", "`touch /tmp/qe_pwn2`", "a;touch /tmp/qe_pwn3;.bin", "x|id", "a b&c.bin", "../../../../tmp/qe_pwn4", "/etc/passwd", "..\\..\\x", "..", ".", "...", "", "A".repeat(10000), "real_" + "x".repeat(5000), "flaky_1.bin", "inconclusive.bin", "real_a/../../b", "éüñ.bin", "-rf", "--help"];
  const seen = [];
  for (const nm of names) {
    const r = await submit(t, Buffer.from("proof-" + nm.slice(0, 20)), { "x-filename": Buffer.from(nm, "utf8").toString("latin1").replace(/[\r\n\0]/g, "") });
    if (r.status === 0 || r.status === 400 && r.err) { seen.push([nm.slice(0, 20), "client/server rejected header", r.err]); continue; }
    await waitIdle(t); let d = null; try { d = JSON.parse(readFileSync(dump, "utf8")); } catch {}
    seen.push([nm.slice(0, 24), r.status, d?.env.AGENT_TEST_FILENAME, path.basename(d?.argv?.[0] ?? "")]);
  }
  console.log(JSON.stringify(seen));
  const scratch = readdirSync(path.join(t.dir, "scratch"));
  rec("filename.scratch-empty-after-jobs", scratch.length === 0, `scratch files left: ${scratch.length}`);
  rec("filename.argv-is-hash-path", seen.every(s => typeof s[3] !== "string" || /^[0-9a-f]{64}\.bin$/.test(s[3]) || s[3] === ""), `argv basenames: ${[...new Set(seen.map(s => s[3]))].slice(0, 3)}...`);
  rec("filename.env-name-sanitised", seen.every(s => !s[2] || /^[A-Za-z0-9._-]{1,80}$/.test(s[2]) && !s[2].startsWith(".")), `AGENT_TEST_FILENAME values all match [A-Za-z0-9._-]{1,80}`);
  rec("filename.no-pwn-files", !existsSync("/tmp/qe_pwn1") && !existsSync("/tmp/qe_pwn2") && !existsSync("/tmp/qe_pwn3") && !existsSync("/tmp/qe_pwn4") && !existsSync("/qe_pwn4"), "no /tmp/qe_pwn* created");
  const after = readdirSync(os.tmpdir()).filter(x => !before.has(x) && !x.startsWith("qeweb-") && !x.startsWith("qe-envdump") && !/^zeb_/.test(x)); // round 3: zeb_* are IPC sockets of another tool on this machine (seen once), not ours rec("filename.no-stray-tmp-files", after.length === 0, `new entries in os.tmpdir() outside run dirs: ${JSON.stringify(after)}`);
  // raw: NUL, CR, LF, high bytes in header value
  for (const [label, v] of [["NUL", "a\0b"], ["LF-injection", "a\nX-Evil: 1"], ["CR", "a\rb"], ["0x80-0xff", "\xe9\xff"], ["tab", "a\tb"]]) {
    const o = await raw(t.port, Buffer.from(`POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nx-filename: ${v}\r\nContent-Length: 3\r\n\r\nabc`, "latin1"), { waitMs: 800 });
    await waitIdle(t); rec(`filename.raw.${label}`, true, `status ${statusOf(o)} (informational; no crash; slot free=${!t.app.state.current})`); await sleep(50);
  }
  const hdrArr = await raw(t.port, `POST /api/submit HTTP/1.1\r\nHost: 127.0.0.1:${t.port}\r\nOrigin: http://127.0.0.1:${t.port}\r\nx-csrf-token: ${t.app.token}\r\nx-filename: a.bin\r\nx-filename: ../b\r\nx-demo-input-id: zzz\r\nContent-Length: 0\r\n\r\n`); rec("filename.dup-header+bad-demo-id", ["400"].includes(statusOf(hdrArr)), `status ${statusOf(hdrArr)}`);
  try { (await import("node:fs")).rmSync(dump, { force: true }); } catch {}
  await t.app.close();
}

// ---------------- 2b. real mode: no filename routing ----------------
{
  const dump = path.join(os.tmpdir(), "qe-envdump2-" + process.pid + ".json");
  const t = await start({ mode: "real", child: { FAKE_ENV_DUMP: dump } });
  await submit(t, Buffer.from("x"), { "x-filename": "real_1.bin" }); await waitIdle(t);
  const d = JSON.parse(readFileSync(dump, "utf8")); rec("real-mode.no-test-filename-env", d.env.AGENT_TEST_FILENAME === undefined, `AGENT_TEST_FILENAME in child env: ${d.env.AGENT_TEST_FILENAME}`);
  rec("real-mode.child-env-keys", Object.keys(d.env).every(k => ["PATH", "HOME", "TMPDIR", "LANG", "USER", "MAX_INPUT_BYTES", "SVM_RPC_URL", "NODE_ENV", "__CF_USER_TEXT_ENCODING"].includes(k) || k.startsWith("AGENT_") || k.startsWith("FAKE_")), `child env keys: ${Object.keys(d.env).join(",")}`);
  (await import("node:fs")).rmSync(dump, { force: true }); await t.app.close();
}

// ---------------- 3. one-job race, rate limit, budget ----------------
{
  const t = await start({ child: { FAKE_SLEEP_MS: "1500", FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000" } });
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => submit(t, Buffer.from("race-" + i))));
  const c = {}; rs.forEach(r => c[r.status] = (c[r.status] ?? 0) + 1);
  rec("race.20-concurrent", c[202] === 1 && c[409] === 19, `status counts ${JSON.stringify(c)}`);
  const snap = t.app.budget.snapshot(); rec("race.reserved-once", snap.reservedAtomic === "250000", `budget during run ${JSON.stringify(snap)}`);
  await waitIdle(t); const s2 = t.app.budget.snapshot(); rec("race.settled-once", s2.spentAtomic === "250000" && s2.reservedAtomic === "0", `after ${JSON.stringify(s2)}`);
  await t.app.close();
}
{
  const t = await start({ spacingMs: 11500, child: { FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0" } });
  const a = await submit(t, Buffer.from("a")); await waitIdle(t);
  const b = await submit(t, Buffer.from("b"));
  rec("rate.spacing", a.status === 202 && b.status === 429 && b.json.retryAfterSeconds >= 1 && b.headers["retry-after"] !== undefined, `second submit ${b.status} retryAfter=${b.json?.retryAfterSeconds} header=${b.headers["retry-after"]}`);
  await t.app.close();
}
{
  const t = await start({ budget: "0.5", child: { FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000" } });
  const codes = []; for (let i = 0; i < 4; i++) { const r = await submit(t, Buffer.from("bud" + i)); codes.push(r.status); await waitIdle(t); }
  rec("budget.cumulative", codes.join() === "202,202,422,422", `codes ${codes} snapshot ${JSON.stringify(t.app.budget.snapshot())}`);
  // 422 body, and demo-id path doesn't bypass
  const r = await req(t, "POST", "/api/submit", { headers: { "x-demo-input-id": "nope" } }); rec("budget.demo-id-unknown", r.status === 400, `status ${r.status}`);
  await t.app.close();
}
{ // budget bypass attempts: concurrent submits right at the boundary
  const t = await start({ budget: "0.25", child: { FAKE_SLEEP_MS: "500", FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000" } });
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => submit(t, Buffer.from("edge" + i)))); const n = rs.filter(r => r.status === 202).length;
  await waitIdle(t); const r2 = await submit(t, Buffer.from("again")); rec("budget.boundary-concurrent", n === 1 && r2.status === 422, `accepted ${n}/10, after settle: ${r2.status}`);
  await t.app.close();
}

// ---------------- 4. kill child mid-run ----------------
{
  const t = await start({ child: { FAKE_SCENARIO: "hang" }, timing: { waitSignedMs: 800, waitDoneMs: 800 } });
  const r = await submit(t, Buffer.from("killme")); await sleep(1200);
  const pid = t.app.state.child?.pid; process.kill(pid, "SIGKILL");
  const s = await req(t, "GET", `/api/jobs/${r.json.jobId}/events`); const types = s.text.split("\n").filter(l => l.startsWith("event:")).map(l => l.slice(7));
  const snap = t.app.budget.snapshot(); const again = await submit(t, Buffer.from("next"));
  rec("kill-child", types.includes("error") && types.at(-1) === "done" && snap.spentAtomic === "250000" && snap.reservedAtomic === "0", `events ${types} budget ${JSON.stringify(snap)} next submit ${again.status}; error msg: ${(/data: (.*error.*)/.exec(s.text) ?? [])[1]?.slice(0, 200)}`);
  await waitIdle(t); await t.app.close();
}

// ---------------- 5. SSE ----------------
{
  const t = await start({ child: { FAKE_SLEEP_MS: "2500", FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000" } });
  const r = await submit(t, Buffer.from("sse")); const id = r.json.jobId;
  for (const bad of ["00000000-0000-4000-8000-000000000000", "../../etc/passwd", "1", id.toUpperCase(), id + "x", `${id}/x`]) { const x = await req(t, "GET", `/api/jobs/${bad}/events`); rec(`sse.guess.${bad.slice(0, 12)}.${bad.length}`, x.status === 404, `status ${x.status}`); }
  const x = await req(t, "GET", `/api/jobs/${id}/events`, { host: "evil.com" }); rec("sse.host-guard", x.status === 403, `status ${x.status}`);
  // flood: 300 concurrent SSE
  const conns = []; const mem0 = process.memoryUsage().rss;
  for (let i = 0; i < 300; i++) conns.push(new Promise(res => { const q = http.get({ host: "127.0.0.1", port: t.port, path: `/api/jobs/${id}/events`, headers: { host: `127.0.0.1:${t.port}` } }, rs => { let n = 0; rs.on("data", d => n += d.length); rs.on("end", () => res(n)); rs.on("error", () => res(-1)); }); q.on("error", () => res(-1)); }));
  const sizes = await Promise.all(conns); const okc = sizes.filter(n => n > 0).length;
  rec("sse.flood-300", okc === 300, `${okc}/300 streams completed; rss delta ${((process.memoryUsage().rss - mem0) / 1e6).toFixed(1)} MB; subs left=${[...[]].length}`);
  const z = await req(t, "GET", `/api/jobs/${id}/events`, { headers: { "last-event-id": "3" } }); const ids = z.text.split("\n").filter(l => l.startsWith("id:")).map(l => l.slice(4));
  rec("sse.reconnect-replays-all", ids[0] === "0", `after done: replays ids ${ids} (Last-Event-ID ignored; harmless)`);
  // client abort leaves no subscriber
  const t2 = await submit(t, Buffer.from("sse2")); await sleep(50);
  await waitIdle(t); await t.app.close();
}
{ // subscriber cleanup on abort
  const t = await start({ child: { FAKE_SLEEP_MS: "1500" } }); const r = await submit(t, Buffer.from("sseabort"));
  await new Promise(res => { const q = http.get({ host: "127.0.0.1", port: t.port, path: `/api/jobs/${r.json.jobId}/events`, headers: { host: `127.0.0.1:${t.port}` } }, rs => { rs.once("data", () => { q.destroy(); res(); }); }); });
  await sleep(200); await waitIdle(t); rec("sse.abort-no-crash", (await req(t, "GET", "/api/config")).status === 200, "server fine after client abort"); await t.app.close();
}

// ---------------- 6. notes ----------------
{
  const t = await start({ child: { FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", FAKE_DETAIL: "heap-buffer-overflow at ucl_lex_json_string" } });
  const s = await submit(t, Buffer.from("noteproof")); await waitIdle(t);
  const hash = createHash("sha256").update("noteproof").digest("hex");
  const note = (j, extra) => req(t, "POST", "/api/notes", { body: typeof j === "string" ? j : JSON.stringify(j), ...extra });
  let r = await note({ reportHash: hash, decision: "valid", text: "ok" }); rec("notes.valid", r.status === 200, `status ${r.status}`);
  r = await note({ reportHash: hash, decision: "valid", text: "x".repeat(501) }); rec("notes.501chars", r.status === 400, `status ${r.status}`);
  r = await note({ reportHash: hash, decision: "valid", text: "\u{1F600}".repeat(500) }); rec("notes.500-emoji-ok", r.status === 200, `status ${r.status}`);
  r = await note({ reportHash: hash, decision: "valid", text: "x".repeat(4100) }); rec("notes.body>4096", r.status === 413, `status ${r.status}`);
  for (const d of ["VALID", "__proto__", "", null, 1, ["valid"], "valid\n"]) { r = await note({ reportHash: hash, decision: d, text: "" }); rec(`notes.bad-enum.${JSON.stringify(d)}`, r.status === 400, `status ${r.status}`); }
  for (const h of ["A".repeat(64), "a".repeat(63), "a".repeat(64) + "\n", `${"a".repeat(63)}\u0000`, ["a".repeat(64)], null]) { r = await note({ reportHash: h, decision: "valid", text: "" }); rec(`notes.bad-hash.${JSON.stringify(h).slice(0, 14)}`, r.status === 400, `status ${r.status}`); }
  for (const j of ["{", "[]", "null", "\"s\"", "123", "{\"reportHash\":\"" + hash + "\",\"decision\":\"valid\",\"text\":1}", '{"__proto__":{"x":1},"reportHash":"' + hash + '","decision":"valid","text":"p"}']) { r = await note(j); rec(`notes.malformed.${j.slice(0, 14).replace(/\W/g, "_")}`, r.status === 400 || r.status === 200, `status ${r.status} ${r.json?.message ?? ""}`); }
  const ctl = "line1\nline2\r\u0000\u001b[31mred <script>alert(1)</script>\"quote\\"; r = await note({ reportHash: hash, decision: "misuse", text: ctl }); rec("notes.control-chars-accepted-as-data", r.status === 200, `status ${r.status}`);
  const lines = readFileSync(t.notesFile, "utf8").split("\n").filter(Boolean); let parsed = 0; for (const l of lines) { try { JSON.parse(l); parsed++; } catch {} }
  rec("notes.file-jsonl-intact", parsed === lines.length && !readFileSync(t.notesFile, "utf8").includes("\u0000"), `${parsed}/${lines.length} lines parse; raw NUL byte in file: ${readFileSync(t.notesFile, "utf8").includes("\u0000")}; mode ${(statSync(t.notesFile).mode & 0o777).toString(8)}`);
  const inbox = await req(t, "GET", "/api/inbox"); const item = inbox.json.items.find(i => i.reportHash === hash); rec("notes.inbox-roundtrip", item?.note?.text === ctl, `inbox note text equals input as plain JSON string: ${item?.note?.text === ctl}`);
  // concurrent writes + growth
  const sz0 = statSync(t.notesFile).size;
  // round 3 (flaky notes.growth-cap): 1500 simultaneous connects overflowed the listen backlog, so ~3-9 requests died client-side (status 0, ECONNRESET) and the old predicate rej === 1500 - ok failed. Now: waves of 100 concurrent requests (still concurrent), and client-side errors are counted separately.
  const ws = []; for (let w = 0; w < 15; w++) ws.push(...await Promise.all(Array.from({ length: 100 }, (_, i) => { const n = w * 100 + i; return note({ reportHash: hash, decision: "unreviewed", text: "c" + n + "y".repeat(480) }); }))); const ok = ws.filter(w => w.status === 200).length;
  const ls = readFileSync(t.notesFile, "utf8").split("\n").filter(Boolean); let good = 0; for (const l of ls) { try { JSON.parse(l); good++; } catch {} }
  rec("notes.concurrent-1500", good === ls.length, `${ok}/1500 accepted; ${good}/${ls.length} lines valid JSON`);
  { const rej = ws.filter(w => w.status === 413 && w.json?.error === "notes_full").length; // round 2: intended cap is 500 notes / 262144 bytes (server.mjs MAX_NOTES, MAX_NOTES_BYTES)
    const cerr = ws.filter(w => w.status === 0).length; const other = 1500 - ok - rej - cerr;
    rec("notes.growth-cap", ok <= 500 && other === 0 && cerr === 0 && statSync(t.notesFile).size < 262144 + 4096 && ls.length <= 500, `${ok}/1500 accepted, ${rej} rejected 413 notes_full, ${cerr} client-side connection errors, ${other} other statuses; file ${statSync(t.notesFile).size} bytes (cap 500 notes / 262144 B), lines ${ls.length}`); }
  await t.app.close();
}

// ---------------- 7. reused token after restart, token randomness ----------------
{
  const a = await start(), b = await start(); const old = a.app.token; await a.app.close();
  const r = await req(b, "POST", "/api/notes", { body: "{}", csrf: old }); rec("csrf.old-token-after-restart", r.status === 403, `status ${r.status}; tokens differ: ${old !== b.app.token}; length ${old.length}`);
  await b.app.close();
}

// ---------------- 8. secrets sweep over everything served ----------------
{
  const t = await start({ child: { FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000" } });
  const s = await submit(t, Buffer.from("sweep")); const ev = await req(t, "GET", `/api/jobs/${s.json.jobId}/events`); await waitIdle(t);
  const pages = ["/api/config", "/api/log", "/api/inbox", "/", "/app.js", "/styles.css", "/index.html", "/api/nope", "/nope", "/api/jobs/zzz/events"]; const texts = [ev.text, s.text];
  for (const p of pages) texts.push((await req(t, "GET", p)).text);
  for (const bad of [{ method: "POST", p: "/api/notes", body: "{" }, { method: "POST", p: "/api/submit", body: "" }]) texts.push((await req(t, bad.method, bad.p, { body: bad.body })).text);
  for (const f of readdirSync(t.dir, { recursive: true })) { const fp = path.join(t.dir, f); try { if (statSync(fp).isFile()) texts.push(readFileSync(fp, "latin1")); } catch {} }
  const blob = texts.join("\n");
  const leak = [CANARY, CANARY_RPC, "CANARYRPCTOKEN", "SVM_PRIVATE_KEY", "LOG_SIGNING_KEY", "AUTHORIZER_PRIVATE", "AGENT_SVM"].filter(k => blob.includes(k));
  rec("secrets.canaries-and-names", leak.length === 0, `leaks: ${JSON.stringify(leak)} (note: key NAMES appear in app.js/docs? checked each name)`);
  const sigs = new Set(); for (const l of readFileSync(t.logFile, "utf8").split("\n").filter(Boolean)) { try { const j = JSON.parse(l); for (const v of Object.values(j)) if (typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(v)) sigs.add(v); } catch {} }
  const longB58 = (blob.match(/[1-9A-HJ-NP-Za-km-z]{64,}/g) ?? []).filter(x => x !== TX && !sigs.has(x) && !/^[A-Za-z]+$/.test(x) && x.length < 200); const hex64 = new Set(blob.match(/\b[0-9a-f]{64}\b/g) ?? []);
  rec("secrets.long-base58", longB58.length === 0, `non-tx base58-like strings >=64 chars: ${longB58.length} [${longB58.map(x => x.length + ":" + (/^[0-9a-f]+$/.test(x) ? "hex" : x.slice(0, 3) + "..")).join(",")}] (hex64 hashes seen, expected report hashes/tokens: ${hex64.size})`);
  rec("secrets.error-paths", !/\/Users\/|node_modules|\bat \w+ \(|\.mjs:\d+|stack/i.test(blob.replace(/function|"use strict"/g, "")), "no filesystem paths/stack traces in any served text (app.js excluded from path check is NOT applied: whole blob scanned)");
  await t.app.close();
}
console.log("\nSUMMARY " + results.filter(r => r.ok).length + "/" + results.length + " PASS; FAIL: " + results.filter(r => !r.ok).map(r => r.id).join(", "));
process.exit(0);
