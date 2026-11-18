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
import { childEnv, mapDecision, sanitizeFacts } from "../lib/jobs.mjs";
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
  const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "notes.jsonl"), env, signerPub: k.pub, buyerAddr: "BuyerPub", payTo: opts.payTo === undefined ? "PayToPub" : opts.payTo,
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

// ---- WEB_FIXES: QE-F-003, QE-W-001 ----
test("QE-F-003: 422 message shows dollars, not atomic units", async () => {
  const t = await start({ budget: "0.10" });
  try {
    const r = await submit(t, "x"); assert.equal(r.status, 422);
    assert.match(r.json.message, /\$0\.10 of \$0\.10 remains, below the \$0\.25 per-report cap/); assert.doesNotMatch(r.json.message, /atomic/);
  } finally { await stop(t); }
});

test("QE-W-001: triage notes capped by count and by bytes (413 JSON), inbox cache sees appended notes", async () => {
  const t = await start({ child: { FAKE_VERDICT: "reproduced" } });
  try {
    await runToEnd(t, "aaa");
    const h = sha("aaa"), nf = path.join(t.dir, "notes.jsonl");
    const note = text => req(t, "POST", "/api/notes", { body: JSON.stringify({ reportHash: h, decision: "valid", text }), headers: { "content-type": "application/json" } });
    assert.equal((await note("first")).status, 200);
    assert.equal((await req(t, "GET", "/api/inbox")).json.items[0].note.text, "first");
    assert.equal((await note("second")).status, 200);
    assert.equal((await req(t, "GET", "/api/inbox")).json.items[0].note.text, "second"); // cache invalidated by the append
    const line = JSON.stringify({ ts: "t", reportHash: h, decision: "valid", text: "x" }) + "\n";
    writeFileSync(nf, line.repeat(500));
    const r = await note("over count"); assert.equal(r.status, 413); assert.equal(r.json.error, "notes_full"); assert.match(r.headers["content-type"], /json/);
    writeFileSync(nf, (JSON.stringify({ ts: "t", reportHash: h, decision: "valid", text: "y".repeat(100000) }) + "\n").repeat(3));
    assert.equal((await note("over bytes")).status, 413);
  } finally { await stop(t); }
});

// ---- D-019/D-020: optional `facts` on decision events
const NETID = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", PAYTO = "8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib";
test("facts: present for reserve/approval/sign lines, only whitelisted fields, atomic amounts as strings", () => {
  const r = mapDecision({ event: "reserve", reportHash: "abcd", askAtomic: "250000", remainingAtomic: "1750000", capAtomic: "250000", scheme: "upto", network: NETID, maxTimeoutSeconds: 300, junk: "x" });
  assert.deepEqual(r, { action: "allow", detail: "budget reserved for the 402 ask", facts: { askAtomic: "250000", capAtomic: "250000", remainingAtomic: "1750000", scheme: "upto", network: NETID, maxTimeoutSeconds: 300 } });
  assert.deepEqual(mapDecision({ event: "approval_auto", askAtomic: "250000", thresholdAtomic: "100000", autoApproveAtomic: "250000" }).facts, { askAtomic: "250000", thresholdAtomic: "100000", autoApproveAtomic: "250000", route: "auto" });
  assert.equal(mapDecision({ event: "approval_granted", askAtomic: "250000", by: "human" }).facts.route, "human");
  assert.deepEqual(mapDecision({ event: "payment_signed", askAtomic: "250000", payTo: PAYTO, network: NETID }, { payTo: PAYTO }).facts, { askAtomic: "250000", network: NETID, payTo: PAYTO });
  // QE-W2-006: payTo is only shown when it equals the demo's known payTo (else omitted); unknown or non-CAIP-2 networks are omitted
  assert.deepEqual(mapDecision({ event: "payment_signed", askAtomic: "250000", payTo: PAYTO, network: NETID }).facts, { askAtomic: "250000", network: NETID });
  assert.deepEqual(mapDecision({ event: "payment_signed", askAtomic: "250000", payTo: PAYTO, network: NETID }, { payTo: "7138577AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }).facts, { askAtomic: "250000", network: NETID });
  assert.deepEqual(mapDecision({ event: "payment_signed", askAtomic: "250000", network: "solana:" + "B".repeat(32) }).facts, { askAtomic: "250000" });
  assert.equal(sanitizeFacts("payment_signed", { network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }).network, "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  assert.deepEqual(mapDecision({ event: "refuse_cap", reason: "402 asks 0.300000 USDC, above per-report cap 0.250000", askAtomic: "300000", capAtomic: "250000" }).facts, { askAtomic: "300000", capAtomic: "250000" });
  assert.deepEqual(mapDecision({ event: "refuse_budget", reason: "r", askAtomic: "250000", remainingAtomic: "0" }).facts, { askAtomic: "250000", remainingAtomic: "0" });
  assert.equal(sanitizeFacts("reserve", { askAtomic: 250000 }).askAtomic, "250000"); // a safe integer is accepted and stringified
  assert.equal(sanitizeFacts("reserve", { askAtomic: -1 }), null);
});
test("facts: absent when the log line carries none (old agent logs): the event has no facts key", () => {
  for (const o of [{ event: "approval_auto" }, { event: "payment_signed" }, { event: "reserve" }, { event: "allow_url", url: "http://localhost:4021/report" }, { event: "settle_result", settledAtomic: "0" }, { event: "refuse_url", reason: "x" }]) {
    const m = mapDecision(o); if (o.event === "approval_auto") assert.deepEqual(m.facts, { route: "auto" }); else assert.ok(!("facts" in m), JSON.stringify(m));
  }
  assert.deepEqual(mapDecision({ event: "allow_url", url: "http://localhost:4021/report" }), { action: "allow", detail: "allowlist: http://localhost:4021/report" });
});
test("facts: hostile values are dropped (HTML, very long, key-like, wrong types, unknown fields)", () => {
  const x = "<img src=x onerror=alert(1)>";
  const f = sanitizeFacts("reserve", { askAtomic: "250000", capAtomic: "<b>1</b>", remainingAtomic: "9".repeat(40), scheme: x, network: "solana:" + "A".repeat(5000), maxTimeoutSeconds: "300", privateKey: "SECRETKEYTEXT", SVM_PRIVATE_KEY: "SECRETKEYTEXT", extra: x });
  assert.deepEqual(f, { askAtomic: "250000" });
  assert.equal(sanitizeFacts("payment_signed", { payTo: "5".repeat(88), network: "solana:" + x }), null); // an 88-char base58 string (secret-key shaped) is not a public address
  assert.equal(sanitizeFacts("payment_signed", { payTo: "has space and <tags>" }), null);
  assert.equal(sanitizeFacts("reserve", { maxTimeoutSeconds: 1e9 }), null);
  assert.equal(sanitizeFacts("reserve", { askAtomic: 1.5, capAtomic: [1], remainingAtomic: { a: 1 } }), null);
  assert.equal(sanitizeFacts("settle_result", { askAtomic: "1" }), null); // events not in the table never carry facts
  assert.equal(sanitizeFacts("reserve", null), null);
});
test("facts over SSE: a realistic agent log replay carries facts; hostile log values never reach the stream; no secret text", async () => {
  const t = await start({ child: { FAKE_REALISTIC: "1" }, payTo: PAYTO });
  try {
    const j = await runToEnd(t, "hello");
    const d = j.events.filter(e => e.type === "decision").map(e => e.data);
    assert.deepEqual(d.map(x => x.action), ["allow", "allow", "approve", "sign", "settle"]);
    assert.equal(d[1].facts.scheme, "upto"); assert.equal(d[1].facts.maxTimeoutSeconds, 300); assert.equal(d[1].facts.remainingAtomic, "1750000");
    assert.equal(d[2].facts.route, "auto"); assert.equal(d[3].facts.payTo, PAYTO); assert.ok(!("facts" in d[0]) && !("facts" in d[4]));
    assert.ok(!j.raw.includes(SECRET_KEY) && !j.raw.includes(SECRET_RPC));
  } finally { await stop(t); }
  const h = await start({ child: { FAKE_HOSTILE: "1" } });
  try {
    const j = await runToEnd(h, "hello");
    const d = j.events.filter(e => e.type === "decision").map(e => e.data);
    assert.deepEqual(d[1].facts, { askAtomic: "250000", capAtomic: "250000" });
    assert.deepEqual(d[2].facts, { askAtomic: "250000", route: "auto" }); assert.deepEqual(d[3].facts, { askAtomic: "250000" });
    for (const bad of ["<img", "onerror", "SECRETKEYTEXT", "AAAAAAAAAA", "5555555555"]) assert.ok(!j.raw.includes(bad), bad);
  } finally { await stop(h); }
});

// ---- QE-W2-001: non-object lines in the job decision log, and exceptions inside the tail callback
import { runJob, Job, validTs } from "../lib/jobs.mjs";
import { buildInbox, HASH64 } from "../lib/records.mjs";
import { sweepRunDir } from "../server.mjs";
const NONOBJ = { null: "null", number: "42", string: '"x"', array: "[1,2]", bool: "true" };
for (const [kind, line] of Object.entries(NONOBJ)) {
  test(`non-object decision log line (${kind}) is ignored: the process lives, the settled record decides the money`, async () => {
    const t = await start({ child: { FAKE_LINES: line, FAKE_SLEEP_MS: "400" } });
    try {
      const j = await runToEnd(t, "hello-" + kind, { "x-filename": "real_a.bin" });
      assert.ok(j.events.some(e => e.type === "settled"), kind);
      assert.ok(!j.events.some(e => e.type === "error"), kind);
      assert.equal(t.app.budget.snapshot().spentAtomic, "0", kind); // returned bond: nothing charged
    } finally { await stop(t); }
  });
}
test("an exception inside the tail callback keeps the process alive and charges the full cap", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "webtest-tail-")), logFile = path.join(dir, "v.jsonl"), jl = path.join(dir, "j.log");
  const scratch = path.join(dir, "p.bin"); writeFileSync(scratch, "x"); writeFileSync(jl, JSON.stringify({ ts: new Date().toISOString(), event: "payment_signed" }) + "\n");
  const job = new Job("id", "a".repeat(64)); const orig = job.emit.bind(job); job.emit = (ty, d) => { if (ty === "decision") throw new Error("boom"); return orig(ty, d); };
  const r = await runJob(job, { scratchFile: scratch, logFile, jobLogPath: jl, env: { PATH: process.env.PATH }, agentCmd: [process.execPath, "-e", "setTimeout(()=>{},400)"], agentCwd: dir, cap: 250000n,
    waitDoneMs: 100, waitSignedMs: 100, pollMs: 20, agentTimeoutMs: 5000, baseline: 0 });
  assert.equal(r.charge, 250000n); // unknown outcome: the whole reservation counts as spent
  assert.ok(true, "process alive");
});
test("decision ts: ISO-8601 up to 40 chars only; anything else is dropped", () => {
  assert.ok(validTs("2026-11-17T18:43:52.980Z") && validTs("2026-11-17T18:43:52+05:30"));
  for (const bad of ["x".repeat(100000), "2026-11-17", "<img src=x>", "2026-11-17T18:43:52.980Z" + "0".repeat(30), 5, null, undefined, {}]) assert.ok(!validTs(bad), String(bad).slice(0, 20));
});
test("QE-W2-005 over SSE: a 100 KB ts becomes server time", async () => {
  const t = await start({ child: { FAKE_LINES: JSON.stringify({ ts: "Z".repeat(100000), event: "allow_url", url: "http://localhost:1/report" }) } });
  try { const j = await runToEnd(t, "ts-hostile"); assert.ok(j.raw.length < 20000); for (const e of j.events.filter(e => e.type === "decision")) assert.ok(validTs(e.data.ts)); } finally { await stop(t); }
});
// ---- QE-W2-002: server returns baselineSeq (additive)
test("202 carries baselineSeq equal to the verdict-log length at submit time", async () => {
  const t = await start({});
  try {
    const a = await runToEnd(t, "bl-1"); assert.equal(a.json.baselineSeq, 0);
    const b = await runToEnd(t, "bl-2"); assert.equal(b.json.baselineSeq, 1);
  } finally { await stop(t); }
});
// ---- QE-W2-003/004: inbox items carry sigOk/hashOk; content-hash cache
test("inbox: sigOk per item, hashOk validation, and no stale cache after a same-size same-mtime tamper", async () => {
  const t = await start({});
  try {
    await runToEnd(t, "inbox-a", { "x-filename": "real_a.bin" });
    let inbox = (await req(t, "GET", "/api/inbox")).json; assert.equal(inbox.items.length, 1); assert.equal(inbox.items[0].sigOk, true); assert.equal(inbox.items[0].hashOk, true);
    const { statSync, utimesSync } = await import("node:fs");
    const st = statSync(t.logFile), txt = readFileSync(t.logFile, "utf8");
    writeFileSync(t.logFile, txt.replace("stub: test", "stub: TEST")); utimesSync(t.logFile, st.atime, st.mtime); // same size, same mtime
    inbox = (await req(t, "GET", "/api/inbox")).json; assert.equal(inbox.items[0].sigOk, false); assert.match(inbox.items[0].detail, /TEST/);
    const rec = JSON.parse(txt.split("\n")[0]); rec.reportHash = "$(touch /tmp/x)";
    writeFileSync(t.logFile, JSON.stringify(rec) + "\n");
    inbox = (await req(t, "GET", "/api/inbox")).json; assert.equal(inbox.items[0].hashOk, false); assert.equal(inbox.items[0].sigOk, false); assert.ok(!HASH64.test(inbox.items[0].reportHash));
  } finally { await stop(t); }
});
// ---- QE2-F-004: sweep leftovers of a killed run
test("sweepRunDir removes only old jobs/*.decisions.log and scratch/* files", async () => {
  const { utimesSync, mkdirSync: mk } = await import("node:fs");
  const d = mkdtempSync(path.join(os.tmpdir(), "sweep-")); mk(path.join(d, "jobs")); mk(path.join(d, "scratch")); mk(path.join(d, "other"));
  const old = new Date(Date.now() - 3600e3), put = (f, t) => { writeFileSync(f, "x"); if (t) utimesSync(f, t, t); };
  put(path.join(d, "jobs", "a.decisions.log"), old); put(path.join(d, "jobs", "b.txt"), old); put(path.join(d, "scratch", "h.bin"), old); put(path.join(d, "scratch", "new.bin"), null);
  put(path.join(d, "verdicts.jsonl"), old); put(path.join(d, "other", "x"), old); put(path.join(d, "notes.jsonl"), old);
  const n = sweepRunDir(d, Date.now() - 1000);
  assert.equal(n, 2);
  assert.ok(!existsSync(path.join(d, "jobs", "a.decisions.log")) && !existsSync(path.join(d, "scratch", "h.bin")));
  for (const f of ["jobs/b.txt", "scratch/new.bin", "verdicts.jsonl", "other/x", "notes.jsonl"]) assert.ok(existsSync(path.join(d, f)), f);
  assert.equal(sweepRunDir(path.join(d, "missing"), Date.now()), 0);
});
