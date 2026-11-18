// node --test web/test/web.test.mjs   (no network, no devnet, no real keys: fake agent + ephemeral log key)
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp, assertLoopback } from "../server.mjs";
import { childEnv } from "../lib/jobs.mjs";
import { parseDetail } from "../lib/records.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, "fake_agent.mjs");
const SECRET_KEY = "FAKEAGENTKEY" + "x".repeat(40), SECRET_RPC = "https://rpc.example.invalid/SECRETTOKEN123456";
const sha = b => createHash("sha256").update(b).digest("hex");
const TX = "49hbmUddNRyJ4RAfSrM66fEx1WYkHWeShiMH1kNpDYRVCG7jB9WvAvXywXBWTsV8SdScd6qWDLxtuTr75fZ8MJxT";

function logKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { kp: base58.encode(Buffer.concat([seed, pub])), pub: base58.encode(pub) };
}

async function start(opts = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "webtest-"));
  const k = logKey();
  const logFile = path.join(dir, "verdicts.jsonl");
  const env = { PATH: process.env.PATH, AGENT_SVM_PRIVATE_KEY: SECRET_KEY, SVM_RPC_URL: SECRET_RPC, AGENT_SESSION_BUDGET_USD: opts.budget ?? "2", ...(opts.env ?? {}) };
  const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "notes.jsonl"), env, signerPub: k.pub, buyerAddr: "BuyerPub", payTo: "PayToPub",
    agentCmd: [process.execPath, FAKE], agentCwd: dir, spacingMs: opts.spacingMs ?? 0, timing: { waitDoneMs: 1500, waitSignedMs: 1500, pollMs: 50, agentTimeoutMs: 20000, ...(opts.timing ?? {}) },
    extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: k.kp, ...(opts.child ?? {}) }, demoInputs: opts.demo ?? [] });
  const port = await app.listen(0);
  return { app, port, dir, logFile, k, env };
}
// raw http so Host/Origin can be spoofed
function req(t, method, p, { headers = {}, body, host, origin, csrf = true } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: host ?? `127.0.0.1:${t.port}`, ...headers };
    if (method === "POST") { if (origin !== null) h.origin = origin ?? `http://127.0.0.1:${t.port}`; if (csrf) h["x-csrf-token"] = typeof csrf === "string" ? csrf : t.app.token; }
    const r = http.request({ host: "127.0.0.1", port: t.port, method, path: p, headers: h }, res => {
      const c = []; res.on("data", d => c.push(d)); res.on("end", () => { const text = Buffer.concat(c).toString(); let json = null; try { json = JSON.parse(text); } catch { /* sse/static */ } resolve({ status: res.statusCode, headers: res.headers, text, json }); });
    });
    r.on("error", reject); if (body !== undefined) r.write(body); r.end();
  });
}
const submit = (t, body, headers = {}, o = {}) => req(t, "POST", "/api/submit", { body, headers: { "x-filename": "real_x.bin", ...headers }, ...o });
const sseOf = text => text.split("\n\n").filter(s => s.startsWith("id:")).map(b => ({ type: /event: (.*)/.exec(b)[1], data: JSON.parse(/data: (.*)/.exec(b)[1]) }));
async function runToEnd(t, body, headers) { const r = await submit(t, body, headers); assert.equal(r.status, 202, r.text); const s = await req(t, "GET", `/api/jobs/${r.json.jobId}/events`); return { ...r, events: sseOf(s.text), raw: s.text }; }
const stop = async t => t.app.close();

test("refuses non-loopback bind", async () => {
  for (const h of ["0.0.0.0", "::", "localhost", "192.168.1.5", ""]) assert.throws(() => assertLoopback(h), /127\.0\.0\.1/);
  assert.throws(() => createApp({ mode: "stub", runDir: mkdtempSync(path.join(os.tmpdir(), "w-")), host: "0.0.0.0", env: {} }), /local-only/);
  assertLoopback("127.0.0.1");
});

test("refuses to start holding payment or log-signing keys; error does not echo values", () => {
  for (const name of ["SVM_PRIVATE_KEY", "SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY", "LOG_SIGNING_KEY"]) {
    assert.throws(() => createApp({ mode: "stub", runDir: mkdtempSync(path.join(os.tmpdir(), "w-")), env: { [name]: "VALUE-SHOULD-NOT-APPEAR" } }), e => e.message.includes(name) && !e.message.includes("VALUE-SHOULD-NOT-APPEAR"));
  }
});

test("child env: only AGENT_*, SVM_RPC_URL and basics; secrets never pass; auto-approve set for child", () => {
  const src = { PATH: "/bin", HOME: "/h", SVM_PRIVATE_KEY: "a", SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY: "b", LOG_SIGNING_KEY: "c", SVM_RPC_URL: "r", AGENT_SVM_PRIVATE_KEY: "k", AGENT_TARGET_URL: "http://evil", AGENT_PROMPT_FROM_STDIN: "1", AGENT_AUTO_APPROVE_USD: "9", SOME_OTHER: "x", FAKE_X: "y" };
  const e = childEnv(src, { allowedUrl: "http://localhost:4021/report", logPath: "/l", testFilename: null });
  assert.deepEqual(Object.keys(e).sort(), ["AGENT_ALLOWED_URL", "AGENT_AUTO_APPROVE_USD", "AGENT_LOG_PATH", "AGENT_SVM_PRIVATE_KEY", "HOME", "PATH", "SVM_RPC_URL"]);
  assert.equal(e.AGENT_AUTO_APPROVE_USD, "0.25");
});

test("Host header: spoofed hosts rejected (DNS rebinding), loopback names accepted, on every route", async () => {
  const t = await start();
  try {
    for (const host of ["evil.example:" + t.port, "attacker.com", `127.0.0.1:${t.port + 1}`, "127.0.0.1", `127.0.0.1.evil.com:${t.port}`, `localhost.evil.com:${t.port}`]) {
      for (const p of ["/api/config", "/api/log", "/api/inbox", "/", "/api/jobs/00000000-0000-0000-0000-000000000000/events"]) {
        const r = await req(t, "GET", p, { host }); assert.equal(r.status, 403, `${host} ${p}`); assert.equal(r.json.error, "bad_host");
      }
    }
    assert.equal((await req(t, "GET", "/api/config")).status, 200);
    assert.equal((await req(t, "GET", "/api/config", { host: `localhost:${t.port}` })).status, 200);
    assert.equal((await submit(t, "x", {}, { host: "evil.example" })).status, 403);
  } finally { await stop(t); }
});

test("Origin and CSRF required on POST; no CORS headers anywhere; OPTIONS refused", async () => {
  const t = await start();
  try {
    const cases = [["wrong origin", { origin: "http://evil.example" }, "bad_origin"], ["null origin", { origin: "null" }, "bad_origin"], ["other port", { origin: `http://127.0.0.1:${t.port + 1}` }, "bad_origin"], ["missing origin", { origin: null }, "bad_origin"],
      ["https origin", { origin: `https://127.0.0.1:${t.port}` }, "bad_origin"], ["missing csrf", { csrf: false }, "bad_csrf"], ["wrong csrf", { csrf: "nope" }, "bad_csrf"]];
    for (const [name, o, code] of cases) { const r = await submit(t, "abc", {}, o); assert.equal(r.status, 403, name); assert.equal(r.json.error, code, name); }
    assert.equal((await req(t, "POST", "/api/notes", { body: "{}", csrf: false })).status, 403);
    assert.equal(t.app.state.current, null);
    for (const r of [await req(t, "GET", "/api/config"), await submit(t, "abc", {}, { csrf: false }), await req(t, "OPTIONS", "/api/submit", { headers: { origin: "http://evil.example", "access-control-request-method": "POST" } })]) {
      assert.ok(!Object.keys(r.headers).some(k => k.startsWith("access-control-")), "no CORS headers");
    }
    assert.equal((await req(t, "OPTIONS", "/api/submit")).status, 405);
    // origin may be localhost:PORT when the Host is localhost:PORT
    const ok = await submit(t, "abc", {}, { host: `localhost:${t.port}`, origin: `http://localhost:${t.port}` }); assert.equal(ok.status, 202);
    await req(t, "GET", `/api/jobs/${ok.json.jobId}/events`);
  } finally { await stop(t); }
});

test("size cap enforced before spawning (body and Content-Length)", async () => {
  const dump = path.join(os.tmpdir(), "dump-oversize-" + process.pid + ".json");
  const t = await start({ child: { FAKE_ENV_DUMP: dump } });
  try {
    const big = Buffer.alloc(65537, 65);
    const r = await submit(t, big); assert.equal(r.status, 413); assert.equal(r.json.error, "too_large");
    const r2 = await new Promise(res => { const q = http.request({ host: "127.0.0.1", port: t.port, method: "POST", path: "/api/submit", headers: { host: `127.0.0.1:${t.port}`, origin: `http://127.0.0.1:${t.port}`, "x-csrf-token": t.app.token, "content-length": "99999999" } }, x => { x.resume(); res(x.statusCode); }); q.on("error", () => res("err")); q.end(Buffer.alloc(10)); });
    assert.equal(r2, 413);
    assert.equal(t.app.state.current, null); assert.ok(!existsSync(dump), "agent never spawned");
    assert.deepEqual(readdirSync(path.join(t.dir, "scratch")), []);
    const exact = await submit(t, Buffer.alloc(65536, 65)); assert.equal(exact.status, 202);
    await req(t, "GET", `/api/jobs/${exact.json.jobId}/events`);
    assert.equal((await submit(t, "")).status, 400);
  } finally { await stop(t); }
});

test("one job at a time: concurrent submit gets 409; then allowed", async () => {
  const t = await start({ child: { FAKE_SLEEP_MS: "700" } });
  try {
    const a = await submit(t, "first"); assert.equal(a.status, 202);
    assert.equal((await req(t, "GET", "/api/config")).json.busy, true);
    const b = await submit(t, "second"); assert.equal(b.status, 409); assert.equal(b.json.error, "busy");
    await req(t, "GET", `/api/jobs/${a.json.jobId}/events`);
    assert.equal((await req(t, "GET", "/api/config")).json.busy, false);
    const c = await submit(t, "third"); assert.equal(c.status, 202); await req(t, "GET", `/api/jobs/${c.json.jobId}/events`);
  } finally { await stop(t); }
});

test("simultaneous submits fired together: exactly one 202", async () => {
  const t = await start({ child: { FAKE_SLEEP_MS: "300" } });
  try {
    const rs = await Promise.all([1, 2, 3, 4].map(i => submit(t, "p" + i)));
    assert.equal(rs.filter(r => r.status === 202).length, 1); assert.equal(rs.filter(r => r.status === 409).length, 3);
    await req(t, "GET", `/api/jobs/${rs.find(r => r.status === 202).json.jobId}/events`);
  } finally { await stop(t); }
});

test("cumulative budget across jobs: forfeits are charged, returns are not, then 422", async () => {
  const t = await start({ budget: "0.5", child: { FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000" } });
  try {
    const j1 = await runToEnd(t, "one"); assert.equal(j1.events.find(e => e.type === "settled").data.bondOutcome, "forfeited");
    let c = (await req(t, "GET", "/api/config")).json.session; assert.deepEqual(c, { budgetAtomic: "500000", spentAtomic: "250000", reservedAtomic: "0", remainingAtomic: "250000" });
    const j2 = await runToEnd(t, "two"); assert.equal(j2.status, 202);
    c = (await req(t, "GET", "/api/config")).json.session; assert.equal(c.remainingAtomic, "0");
    const j3 = await submit(t, "three"); assert.equal(j3.status, 422); assert.equal(j3.json.error, "session_budget_exhausted");
    assert.equal(t.app.state.current, null);
  } finally { await stop(t); }
  const t2 = await start({ budget: "0.3", child: { FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0" } });
  try { for (const p of ["a", "b", "c"]) { const j = await runToEnd(t2, p); assert.equal(j.events.find(e => e.type === "settled").data.bondOutcome, "returned"); } assert.equal(t2.app.budget.snapshot().spentAtomic, "0"); }
  finally { await stop(t2); }
});

test("reservation is held while a job runs (budget for two cannot be double spent)", async () => {
  const t = await start({ budget: "0.3", child: { FAKE_SLEEP_MS: "500" } });
  try {
    const a = await submit(t, "a"); assert.equal(a.status, 202);
    assert.equal((await req(t, "GET", "/api/config")).json.session.reservedAtomic, "250000");
    assert.equal((await submit(t, "b")).status, 409);
    await req(t, "GET", `/api/jobs/${a.json.jobId}/events`);
  } finally { await stop(t); }
});

test("submits spaced: second within spacing gets 429 with retryAfterSeconds, nothing spawned", async () => {
  const t = await start({ spacingMs: 11500 });
  try {
    const a = await runToEnd(t, "a"); assert.equal(a.status, 202);
    const b = await submit(t, "b"); assert.equal(b.status, 429); assert.ok(b.json.retryAfterSeconds >= 1 && b.json.retryAfterSeconds <= 12); assert.equal(b.headers["retry-after"], String(b.json.retryAfterSeconds));
    assert.equal(t.app.budget.snapshot().reservedAtomic, "0");
  } finally { await stop(t); }
});

test("filenames with shell metacharacters and path separators never reach a shell or a path", async () => {
  const dump = path.join(os.tmpdir(), "dump-fn-" + process.pid + ".json"), pwn = path.join(os.tmpdir(), "pwn-" + process.pid);
  const t = await start({ child: { FAKE_ENV_DUMP: dump } });
  try {
    const evil = `a; touch ${pwn} $(touch ${pwn}) \`touch ${pwn}\` ../../../../etc/passwd | x & y > z`;
    const bytes = Buffer.from("proof-bytes");
    const j = await runToEnd(t, bytes, { "x-filename": evil });
    assert.ok(!existsSync(pwn));
    const d = JSON.parse(readFileSync(dump, "utf8"));
    assert.equal(d.argv.length, 1);
    assert.equal(path.basename(d.argv[0]), sha(bytes) + ".bin"); assert.equal(path.dirname(d.argv[0]), path.join(t.dir, "scratch"));
    assert.match(d.env.AGENT_TEST_FILENAME, /^[A-Za-z0-9._-]+$/);
    assert.equal(j.events[0].data.reportHash, sha(bytes));
    for (const f of ["..\\..\\windows\\system32", "/etc/passwd", "../x", "", "...", ".hidden"]) {
      const r = await runToEnd(t, bytes, { "x-filename": f }); assert.equal(r.status, 202);
      assert.match(JSON.parse(readFileSync(dump, "utf8")).env.AGENT_TEST_FILENAME, /^[A-Za-z0-9_][A-Za-z0-9._-]*$/);
    }
    assert.deepEqual(readdirSync(path.join(t.dir, "scratch")), [], "scratch cleaned up");
  } finally { await stop(t); }
});

test("child gets only AGENT_*, SVM_RPC_URL and basics through the real spawn", async () => {
  const dump = path.join(os.tmpdir(), "dump-env-" + process.pid + ".json");
  const t = await start({ env: { AGENT_TEST_FILENAME: "evil", AGENT_TARGET_URL: "http://evil", UNRELATED: "z" }, child: { FAKE_ENV_DUMP: dump } });
  try {
    await runToEnd(t, "x");
    const e = JSON.parse(readFileSync(dump, "utf8")).env;
    for (const k of Object.keys(e)) assert.ok(/^(AGENT_|FAKE_|PATH$|SVM_RPC_URL$|__CF_USER_TEXT_ENCODING$)/.test(k), "unexpected env var in child: " + k);
    for (const k of ["SVM_PRIVATE_KEY", "SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY", "LOG_SIGNING_KEY", "AGENT_TARGET_URL", "UNRELATED"]) assert.ok(!(k in e), k);
    assert.equal(e.AGENT_AUTO_APPROVE_USD, "0.25"); assert.equal(e.AGENT_TEST_FILENAME, "real_x.bin");
  } finally { await stop(t); }
});

test("SSE: amounts and tx come from the signed record, not the agent console; event order", async () => {
  const t = await start({ child: { FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000", FAKE_DETAIL: "case, 5 B input: vul 3/3 clean" } });
  try {
    const j = await runToEnd(t, "hello");
    const types = j.events.map(e => e.type);
    assert.deepEqual(types.filter(x => x !== "decision"), ["started", "verdict", "settled", "done"]);
    assert.ok(types.indexOf("verdict") > types.lastIndexOf("decision") - 1);
    const s = j.events.find(e => e.type === "settled").data;
    assert.deepEqual(s, { settledAtomic: "250000", txSignature: TX, bondOutcome: "forfeited" });
    assert.equal(j.events.find(e => e.type === "verdict").data.verdict, "not_reproduced");
    assert.ok(!j.raw.includes("999999") && !j.raw.includes("AGENT CONSOLE CLAIM"));
    assert.deepEqual(j.events.at(-1).data, { recordSeq: 0 });
    const actions = j.events.filter(e => e.type === "decision").map(e => e.data.action); assert.deepEqual(actions, ["allow", "approve", "sign", "settle"]);
    assert.ok(!j.raw.includes("html"));
  } finally { await stop(t); }
});

test("refused job: refusal text, settledAtomic null, nothing charged, no record", async () => {
  const t = await start({ child: { FAKE_SCENARIO: "refuse" } });
  try {
    const j = await runToEnd(t, "x");
    assert.deepEqual(j.events.map(e => e.type), ["started", "decision", "error", "done"]);
    assert.equal(j.events[2].data.settledAtomic, null); assert.match(j.events[2].data.message, /Refused by agent policy: session budget exhausted/);
    assert.equal(t.app.budget.snapshot().spentAtomic, "0"); assert.equal(t.app.budget.snapshot().reservedAtomic, "0");
    assert.deepEqual(j.events.at(-1).data, { recordSeq: null });
  } finally { await stop(t); }
});

test("no record within the bounded wait: error with settledAtomic null, cap counted as spent; never invents a result", async () => {
  const t = await start({ child: { FAKE_SCENARIO: "unknown" }, timing: { waitDoneMs: 300, waitSignedMs: 300 } });
  try {
    const j = await runToEnd(t, "x");
    const types = j.events.map(e => e.type);
    assert.ok(types.includes("checking")); assert.ok(!types.includes("settled")); assert.ok(!types.includes("verdict"));
    const e = j.events.find(x => x.type === "error").data; assert.equal(e.settledAtomic, null); assert.match(e.message, /outcome is unknown/);
    assert.equal(t.app.budget.snapshot().spentAtomic, "250000");
  } finally { await stop(t); }
});

test("killed child after signing: error, settledAtomic null, still busy until resolved, budget kept", async () => {
  const t = await start({ child: { FAKE_SCENARIO: "hang" }, timing: { waitSignedMs: 400 } });
  try {
    const a = await submit(t, "x"); assert.equal(a.status, 202);
    for (let i = 0; i < 60 && !t.app.state.child; i++) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 400));
    t.app.state.child.kill("SIGKILL");
    const s = await req(t, "GET", `/api/jobs/${a.json.jobId}/events`); const ev = sseOf(s.text);
    assert.ok(ev.some(e => e.type === "checking")); const er = ev.find(e => e.type === "error").data; assert.equal(er.settledAtomic, null); assert.match(er.message, /abnormally/);
    assert.equal(t.app.budget.snapshot().spentAtomic, "250000");
  } finally { await stop(t); }
});

test("SSE and config never contain env secret values (even if the agent log echoes one)", async () => {
  const t = await start({ child: { FAKE_SCENARIO: "refuse", FAKE_REFUSE_REASON: `leak ${SECRET_RPC} and ${SECRET_KEY}` } });
  try {
    const j = await runToEnd(t, "x");
    const all = [j.raw, (await req(t, "GET", "/api/config")).text, (await req(t, "GET", "/api/log")).text, (await req(t, "GET", "/api/inbox")).text].join("\n");
    for (const s of [SECRET_KEY, SECRET_RPC, "SECRETTOKEN123456"]) assert.ok(!all.includes(s), "leaked " + s.slice(0, 8));
    assert.ok(j.raw.includes("[redacted]"));
    const cfg = (await req(t, "GET", "/api/config")).json;
    assert.equal(cfg.mode, "stub"); assert.equal(cfg.limits.maxInputBytes, 65536); assert.equal(cfg.wallet.buyerAddress, "BuyerPub");
  } finally { await stop(t); }
});

test("/api/log: pinned signer, per-record sigOk from per-line problems, manifest labels, tx only when base58", async () => {
  const body = Buffer.from("labelled-proof");
  const demo = [{ id: "d1", label: "HAND-MADE fake test", category: "hand_made_fake", handMade: true, sizeBytes: body.length, abs: "/nonexistent", sha: sha(body) }];
  const t = await start({ demo });
  try {
    await runToEnd(t, body); await new Promise(r => setTimeout(r, 1700)); await runToEnd(t, "second");
    let l = (await req(t, "GET", "/api/log")).json;
    assert.equal(l.verify.ok, true); assert.equal(l.verify.records, 2); assert.equal(l.verify.verified, 2); assert.equal(l.signer, t.k.pub);
    assert.equal(l.records[0].label, "HAND-MADE fake test"); assert.equal(l.records[0].category, "hand_made_fake"); assert.equal(l.records[1].label, null);
    assert.ok(l.records.every(r => r.sigOk)); assert.equal(l.head.seq, 1); assert.match(l.head.hash, /^[0-9a-f]{64}$/);
    // tamper line 1
    const lines = readFileSync(t.logFile, "utf8").split("\n").filter(Boolean); const r0 = JSON.parse(lines[0]); r0.settledAtomic = "0"; r0.verdict = "reproduced"; r0.detail = "edited";
    writeFileSync(t.logFile, [JSON.stringify(r0), lines[1]].join("\n") + "\n");
    l = (await req(t, "GET", "/api/log")).json;
    assert.equal(l.verify.ok, false); assert.equal(l.records[0].sigOk, false); assert.equal(l.records[1].sigOk, false, "chain break names the next line too");
    assert.ok(l.verify.problems.some(p => p.line === 1)); assert.equal(l.verify.verified, 0);
  } finally { await stop(t); }
});

test("/api/log is empty-safe and wrong pinned signer fails verification", async () => {
  const t = await start();
  try {
    const e = (await req(t, "GET", "/api/log")).json; assert.equal(e.verify.records, 0); assert.equal(e.head, null); assert.deepEqual(e.records, []);
    await runToEnd(t, "x");
    const t2 = createApp({ mode: "stub", runDir: t.dir, logFile: t.logFile, env: { PATH: "/bin" }, signerPub: logKey().pub, demoInputs: [] }); const p2 = await t2.listen(0);
    const l = (await req({ port: p2, app: t2 }, "GET", "/api/log")).json; assert.equal(l.verify.ok, false); assert.match(l.verify.problems[0].message, /not the pinned key/); assert.equal(l.records[0].sigOk, false);
    await t2.close();
  } finally { await stop(t); }
});

test("parseDetail: only from the detail text, null when absent", () => {
  assert.deepEqual(parseDetail("case 42482847, 2 B input: vul 3/3 heap-buffer-overflow at ucl_lex_json_string src/ucl_parser.c:1036:8; fixed build clean"), { errorType: "heap-buffer-overflow", topFrame: "ucl_lex_json_string src/ucl_parser.c:1036:8" });
  assert.deepEqual(parseDetail("heap-buffer-overflow: vulnerable 3/3 runs, frame ucl_parser_add_chunk src/ucl_parser.c; fixed build clean"), { errorType: "heap-buffer-overflow", topFrame: "ucl_parser_add_chunk src/ucl_parser.c" });
  assert.deepEqual(parseDetail("stub: filename contains 'real'"), { errorType: null, topFrame: null });
  assert.deepEqual(parseDetail(""), { errorType: null, topFrame: null });
  assert.deepEqual(parseDetail("vul run1: exit 137 without sanitizer report"), { errorType: null, topFrame: null });
  assert.deepEqual(parseDetail(undefined), { errorType: null, topFrame: null });
});

test("inbox: reproduced+inconclusive only, newest first, parsed detail, notes joined; notes validation", async () => {
  const t = await start({ child: { FAKE_VERDICT: "reproduced", FAKE_DETAIL: "case 1, 2 B input: vul 3/3 heap-buffer-overflow at f src/a.c:1:2; fixed build clean" } });
  try {
    const a = await runToEnd(t, "aaa");
    t.app.state.lastEndAt = 0;
    const b = await runToEnd(t, "bbb", {});
    const inbox = (await req(t, "GET", "/api/inbox")).json.items;
    assert.equal(inbox.length, 2); assert.equal(inbox[0].seq, 1); assert.equal(inbox[1].seq, 0);
    assert.equal(inbox[0].errorType, "heap-buffer-overflow"); assert.equal(inbox[0].topFrame, "f src/a.c:1:2"); assert.equal(inbox[0].note, null);
    const h = sha("aaa");
    const note = body => req(t, "POST", "/api/notes", { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    for (const bad of [{ reportHash: "zz", decision: "valid", text: "" }, { reportHash: h, decision: "pay_me", text: "" }, { reportHash: h, decision: "valid", text: "x".repeat(501) }, { reportHash: h, decision: "valid", text: 5 }, { reportHash: sha("nope"), decision: "valid", text: "" }])
      assert.equal((await note(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal((await req(t, "POST", "/api/notes", { body: "not json" })).status, 400);
    assert.equal((await note({ reportHash: h, decision: "valid", text: "x".repeat(500) })).json.ok, true);
    assert.equal((await note({ reportHash: h, decision: "misuse", text: "<img src=x onerror=alert(1)>" })).status, 200);
    const after = (await req(t, "GET", "/api/inbox")).json.items.find(i => i.reportHash === h);
    assert.equal(after.note.decision, "misuse"); assert.equal(after.note.text, "<img src=x onerror=alert(1)>");
    const lines = readFileSync(path.join(t.dir, "notes.jsonl"), "utf8").split("\n").filter(Boolean); assert.equal(lines.length, 2); assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ["decision", "reportHash", "text", "ts"]);
    assert.match((await req(t, "GET", "/api/inbox")).headers["content-type"], /^application\/json/);
  } finally { await stop(t); }
});

test("static: allowlist, no traversal, no dotfiles, no directory listing, no .env/keys", async () => {
  const t = await start();
  const pub = mkdtempSync(path.join(os.tmpdir(), "pub-")); writeFileSync(path.join(pub, "index.html"), "<h1>hi</h1>"); writeFileSync(path.join(pub, "app.js"), "1"); writeFileSync(path.join(pub, "secret.pem"), "k"); writeFileSync(path.join(pub, ".env"), "SECRET=1"); mkdirSync(path.join(pub, "sub")); writeFileSync(path.join(pub, "sub", "x.css"), "a{}");
  writeFileSync(path.join(pub, "..", "outside-" + path.basename(pub) + ".js"), "leak");
  await stop(t);
  const dir = mkdtempSync(path.join(os.tmpdir(), "webtest-"));
  const app = createApp({ mode: "stub", runDir: dir, env: { PATH: "/bin" }, publicDir: pub, demoInputs: [] }); const port = await app.listen(0); const tt = { port, app };
  try {
    assert.equal((await req(tt, "GET", "/")).status, 200); assert.equal((await req(tt, "GET", "/")).text, "<h1>hi</h1>");
    assert.equal((await req(tt, "GET", "/app.js")).headers["content-type"].startsWith("text/javascript"), true);
    assert.equal((await req(tt, "GET", "/sub/x.css")).status, 200);
    for (const p of ["/secret.pem", "/.env", "/sub/", "/sub", "/..%2f..%2fetc%2fpasswd", "/%2e%2e/%2e%2e/etc/passwd", "/../" + "outside-" + path.basename(pub) + ".js", "/sub/../index.html", "//etc/passwd", "/..\\x.js", "/nope.html", "/index.html%00.png", "/web/server.mjs", "/keys/x", "/%2e%2e%2fserver.mjs"]) {
      const r = await req(tt, "GET", p); assert.equal(r.status, 404, p); assert.equal(r.json.error, "not_found");
    }
    assert.match((await req(tt, "GET", "/")).headers["content-security-policy"], /default-src 'self'/);
  } finally { await app.close(); }
});

test("only POST /api/submit and /api/notes mutate; unknown routes 404; PUT/DELETE 405", async () => {
  const t = await start();
  try {
    assert.equal((await req(t, "GET", "/api/nope")).status, 404);
    assert.equal((await req(t, "PUT", "/api/submit")).status, 405); assert.equal((await req(t, "DELETE", "/api/log")).status, 405);
    assert.equal((await req(t, "POST", "/api/log", {})).status, 404);
    assert.equal((await req(t, "GET", "/api/jobs/not-a-uuid/events")).status, 404);
    assert.equal((await req(t, "GET", "/api/jobs/00000000-0000-0000-0000-000000000000/events")).status, 404);
  } finally { await stop(t); }
});

test("demo input submit: id only, no body; unknown id and body+id rejected", async () => {
  const f = path.join(os.tmpdir(), "demo-" + process.pid + ".bin"); writeFileSync(f, "demo-bytes");
  const demo = [{ id: "arvo_x", label: "ARVO x", category: "real_bug", handMade: false, sizeBytes: 10, abs: f, sha: sha("demo-bytes") }];
  const dump = path.join(os.tmpdir(), "dump-demo-" + process.pid + ".json");
  const t = await start({ demo, child: { FAKE_ENV_DUMP: dump } });
  try {
    const c = (await req(t, "GET", "/api/config")).json; assert.deepEqual(c.demoInputs, [{ id: "arvo_x", label: "ARVO x", category: "real_bug", handMade: false, sizeBytes: 10 }]);
    assert.equal((await submit(t, "", { "x-demo-input-id": "nope" })).status, 400);
    assert.equal((await submit(t, "body", { "x-demo-input-id": "arvo_x" })).status, 400);
    const j = await runToEnd(t, "", { "x-demo-input-id": "arvo_x" }); assert.equal(j.events[0].data.reportHash, sha("demo-bytes"));
    assert.equal(JSON.parse(readFileSync(dump, "utf8")).env.AGENT_TEST_FILENAME, "real_bug_1.bin");
  } finally { await stop(t); }
});
