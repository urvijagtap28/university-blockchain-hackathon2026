#!/usr/bin/env node
// Local-only web backend for the Prove-It Bond demo (D-016, contract: AGENTS/INTERFACES.md "Web app contract").
// Node built-ins only. Binds 127.0.0.1. Holds no payment or log-signing keys; the child agent gets only AGENT_* and SVM_RPC_URL.
// Start it with scripts/web.sh (which also starts the facilitator and the x402 server). Not meant to be run bare.
import http from "node:http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, rmSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionBudget } from "./lib/budget.mjs";
import { Job, SECRET_ENV_NAMES, childEnv, runJob } from "./lib/jobs.mjs";
import { NOTE_DECISIONS, appendNote, noteFileStats, buildInbox, buildLogView, countLines, parseLines, readLogText, sha256 } from "./lib/records.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BYTES = 65536;
const SANDBOX = ["no network", "1 CPU, 1 GB memory", "60 s wall-clock cap", "read-only filesystem except scratch", "non-root user", "no secrets in the container"];
const CAVEAT = "The fixed image is a later libucl version, not the per-bug fix commit. So reproduced means the input triggers the expected ASan error on the pinned vulnerable build and the crash is gone in a later libucl.";
const MIME = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", txt: "text/plain; charset=utf-8", woff2: "font/woff2" };
const dollars = a => "$" + (Number(a) / 1e6).toFixed(2);
const MAX_NOTES = 500, MAX_NOTES_BYTES = 262144; // QE-W-001: triage notes file cap
const usdAtomic = s => BigInt(Math.round(Number(s) * 1e6));

/** QE2-F-004: at start, remove leftovers of a killed run: <runDir>/jobs/*.decisions.log and <runDir>/scratch/* (plain files) last modified before this process started. Touches nothing else. Returns the removed count. */
export function sweepRunDir(runDir, startMs) {
  let n = 0;
  for (const [sub, ok] of [["jobs", f => f.endsWith(".decisions.log")], ["scratch", () => true]]) {
    const dir = path.join(path.resolve(runDir), sub);
    let names = []; try { names = readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!ok(f)) continue;
      try { const fp = path.join(dir, f), st = lstatSync(fp); if (st.isFile() && st.mtimeMs < startMs) { rmSync(fp, { force: true }); n++; } } catch { /* leave it */ }
    }
  }
  return n;
}

export function assertLoopback(host) {
  if (host !== "127.0.0.1") throw new Error(`refusing to bind to "${host}": this app is local-only and binds 127.0.0.1 only`);
}
export function assertNoSecrets(env) {
  const bad = SECRET_ENV_NAMES.filter(k => env[k]);
  if (bad.length) throw new Error(`refusing to start: the web process must not hold ${bad.join(", ")} (start it via scripts/web.sh, which filters the environment)`);
}
const safeName = s => { const b = String(s ?? "").split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80); return b || "upload.bin"; };

export function loadDemoInputs(manifestPath) {
  const out = [];
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    const seen = new Set();
    for (const e of m.entries ?? []) {
      const abs = path.resolve(ROOT, e.input);
      if (!existsSync(abs) || !abs.startsWith(ROOT + path.sep)) continue;
      const bytes = readFileSync(abs);
      let id = safeName(path.basename(abs, path.extname(abs))); while (seen.has(id)) id += "_"; seen.add(id);
      out.push({ id, label: String(e.label), category: e.category, handMade: e.category === "hand_made_fake", sizeBytes: bytes.length, abs, sha: sha256(bytes) });
    }
  } catch { /* no manifest: no demo inputs */ }
  return out;
}

export function createApp(o) {
  const host = o.host ?? "127.0.0.1"; assertLoopback(host);
  const env = o.env ?? process.env;
  assertNoSecrets(env);
  const mode = o.mode === "real" ? "real" : "stub";
  const runDir = path.resolve(o.runDir);
  const logFile = o.logFile ?? path.join(runDir, "verdicts.jsonl");
  const notesFile = o.notesFile ?? path.join(ROOT, "web", "data", "notes.jsonl");
  const publicDir = o.publicDir ?? path.join(ROOT, "web", "public");
  const scratchDir = path.join(runDir, "scratch"), jobsDir = path.join(runDir, "jobs");
  mkdirSync(scratchDir, { recursive: true }); mkdirSync(jobsDir, { recursive: true });
  const cap = (() => { const c = usdAtomic(env.AGENT_PER_REPORT_CAP_USD || "0.25"); return c > 250000n ? 250000n : c; })();
  const budget = new SessionBudget(usdAtomic(env.AGENT_SESSION_BUDGET_USD || "2"), cap);
  const token = o.csrfToken ?? randomBytes(24).toString("hex");
  const demo = o.demoInputs ?? loadDemoInputs(path.join(ROOT, "demo", "manifest.json"));
  const labelByHash = new Map(demo.map(d => [d.sha, { label: d.label, category: d.category }]));
  const spacingMs = o.spacingMs ?? 11500;
  const serverPort = o.serverPort ?? 4021;
  const allowedUrl = `http://localhost:${serverPort}/report`;
  const secrets = [...SECRET_ENV_NAMES, "AGENT_SVM_PRIVATE_KEY", "SVM_RPC_URL"].map(k => env[k]).filter(v => v && v.length >= 8);
  const redact = s => { let t = s; for (const v of secrets) t = t.split(v).join("[redacted]"); return t; };
  const agentCmd = o.agentCmd ?? [process.execPath, "src/cli.ts"];
  const agentCwd = o.agentCwd ?? path.join(ROOT, "agent");
  const wait = { waitDoneMs: 20000, waitSignedMs: 75000, pollMs: 500, agentTimeoutMs: 180000, ...(o.timing ?? {}) };
  const jobs = new Map();
  const st = { current: null, lastEndAt: 0, child: null };

  let target = { caseId: null, targetCommit: null, fixCommit: null, vulImage: null, fixImage: null, caveat: "STUB verifier: no library is run and no bug is tested; verdicts come from the filename." };
  if (mode === "real") {
    try {
      const cases = JSON.parse(readFileSync(path.join(ROOT, "verifier", "cases.json"), "utf8"));
      const id = String(o.caseId ?? env.WEB_CASE_ID ?? cases.default_case); const c = cases.cases?.[id];
      target = { caseId: id, targetCommit: c?.vul?.libucl_commit ?? null, fixCommit: c?.fix?.libucl_commit ?? null, vulImage: c?.vul?.image ?? null, fixImage: c?.fix?.image ?? null, caveat: CAVEAT };
    } catch { /* leave nulls */ }
  }
  const signerPub = o.signerPub ?? env.WEB_SIGNER_PUB ?? null;
  const wallet = { buyerAddress: o.buyerAddr ?? env.WEB_BUYER_ADDR ?? null, payTo: o.payTo ?? env.WEB_PAY_TO ?? null };

  const config = () => ({
    mode, busy: !!st.current, csrfToken: token,
    policy: { perReportCapUsd: Number(cap) / 1e6, sessionBudgetUsd: Number(budget.budget) / 1e6, approvalThresholdUsd: Number(env.AGENT_APPROVAL_THRESHOLD_USD || "0.10"), retryBudget: Number(env.AGENT_RETRY_BUDGET || "3"), allowedUrl },
    session: budget.snapshot(), target,
    limits: { maxInputBytes: MAX_BYTES, verifierTimeoutSeconds: 60, maxConcurrent: 2, rateLimitSeconds: 10, sandbox: SANDBOX },
    wallet, demoInputs: demo.map(({ id, label, category, handMade, sizeBytes }) => ({ id, label, category, handMade, sizeBytes })),
  });

  // ---- response helpers (every API body is JSON text; secrets scrubbed as a last line of defence) ----
  const baseHeaders = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin" };
  const send = (res, status, obj, extra = {}) => { const b = redact(JSON.stringify(obj)); res.writeHead(status, { ...baseHeaders, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(b), ...extra }); res.end(b); };
  const err = (res, status, error, message, extra = {}) => send(res, status, { error, message, ...extra }, status === 429 ? { "retry-after": String(extra.retryAfterSeconds ?? 1) } : {});

  const tokOk = h => { const a = Buffer.from(String(h ?? "")), b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b); };
  function guard(req, res, port) {
    const h = String(req.headers.host ?? "").toLowerCase();
    if (!(h === `127.0.0.1:${port}` || h === `localhost:${port}`)) { err(res, 403, "bad_host", "Host header not allowed"); return false; }
    if (req.method === "POST") {
      if (req.headers.origin !== `http://${h}`) { err(res, 403, "bad_origin", "Origin header missing or not matching"); return false; }
      if (!tokOk(req.headers["x-csrf-token"])) { err(res, 403, "bad_csrf", "missing or wrong x-csrf-token"); return false; }
    }
    return true;
  }
  function readBody(req, res, limit) {
    return new Promise(resolve => {
      const cl = req.headers["content-length"];
      const tooBig = () => { res.writeHead(413, { ...baseHeaders, "content-type": "application/json; charset=utf-8", connection: "close" }); res.end(JSON.stringify({ error: "too_large", message: `body exceeds ${limit} bytes` }), () => req.destroy()); resolve(null); };
      if (cl !== undefined && Number(cl) > limit) return tooBig();
      const chunks = []; let n = 0, over = false;
      req.on("data", c => { if (over) return; n += c.length; if (n > limit) { over = true; tooBig(); } else chunks.push(c); });
      req.on("end", () => { if (!over) resolve(Buffer.concat(chunks)); });
      req.on("error", () => { if (!over) resolve(null); });
    });
  }

  async function submit(req, res) {
    const body = await readBody(req, res, MAX_BYTES); if (body === null) return;
    const demoId = req.headers["x-demo-input-id"];
    let bytes, stubName, label = null;
    if (demoId !== undefined) {
      const d = demo.find(x => x.id === demoId);
      if (!d || body.length) return err(res, 400, "bad_input", "unknown demo input id, or a body was sent together with x-demo-input-id");
      bytes = readFileSync(d.abs); stubName = `${d.category === "real_bug" ? "real_bug" : "fake"}_${demo.indexOf(d) + 1}.bin`; label = d.label;
    } else {
      if (!body.length) return err(res, 400, "bad_input", "empty body: send the proof bytes");
      bytes = body; stubName = safeName(req.headers["x-filename"]);
    }
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return err(res, bytes.length ? 413 : 400, bytes.length ? "too_large" : "bad_input", `proof must be 1..${MAX_BYTES} bytes`);
    // From here to the spawn there is no await: check-and-set is atomic.
    if (st.current) return err(res, 409, "busy", "another submission is running; wait for it to finish");
    if (!budget.canReserve()) return err(res, 422, "session_budget_exhausted", `Session budget exhausted: only ${dollars(budget.remaining)} of ${dollars(budget.budget)} remains, below the ${dollars(cap)} per-report cap.`);
    const wait429 = st.lastEndAt + spacingMs - Date.now();
    if (wait429 > 0) return err(res, 429, "rate_limited", "submits must be spaced out (server allows one paid request per 10 s per wallet)", { retryAfterSeconds: Math.ceil(wait429 / 1000) });
    budget.reserve();
    const hash = sha256(bytes), id = randomUUID();
    const job = new Job(id, hash); jobs.set(id, job); st.current = job;
    while (jobs.size > 20) jobs.delete(jobs.keys().next().value);
    const scratchFile = path.join(scratchDir, `${hash}.bin`); // named by hash; the client's filename never touches a path
    writeFileSync(scratchFile, bytes, { mode: 0o600 });
    const jobLogPath = path.join(jobsDir, `${id}.decisions.log`);
    const base = countLines(logFile);
    const cenv = { ...childEnv(env, { allowedUrl, logPath: jobLogPath, testFilename: mode === "stub" ? stubName : null }), ...(o.extraChildEnv ?? {}) };
    (async () => {
      const r = await runJob(job, { scratchFile, logFile, jobLogPath, env: cenv, agentCmd, agentCwd, cap, baseline: base, knownPayTo: wallet.payTo, onChild: c => { st.child = c; }, ...wait });
      budget.settle(r.charge);
      st.child = null; st.current = null; st.lastEndAt = Date.now(); job.done = true;
      job.emit("done", { recordSeq: r.recordSeq ?? null });
      for (const s of job.subs) s(null);
      try { rmSync(jobLogPath, { force: true }); } catch { /* ignore */ }
    })();
    send(res, 202, { jobId: id, baselineSeq: base }); // baselineSeq (optional, additive): verdict-log length at submit; a record for this run has seq >= it
  }

  function sse(req, res, id) {
    const job = jobs.get(id);
    if (!job) return err(res, 404, "not_found", "unknown job");
    res.writeHead(200, { ...baseHeaders, "content-type": "text/event-stream; charset=utf-8", connection: "keep-alive" });
    const write = ev => res.write(redact(`id: ${ev.n}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`));
    job.events.forEach(write);
    if (job.done) return res.end();
    const sub = ev => { if (ev === null) { res.end(); return; } write(ev); };
    job.subs.add(sub);
    const hb = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => { clearInterval(hb); job.subs.delete(sub); });
  }

  async function notes(req, res) {
    const body = await readBody(req, res, 4096); if (body === null) return;
    let j; try { j = JSON.parse(body.toString("utf8")); } catch { return err(res, 400, "bad_input", "body must be JSON"); }
    if (!j || typeof j !== "object" || typeof j.reportHash !== "string" || !/^[0-9a-f]{64}$/.test(j.reportHash)) return err(res, 400, "bad_input", "reportHash must be a 64-char hex sha256");
    if (!NOTE_DECISIONS.includes(j.decision)) return err(res, 400, "bad_input", `decision must be one of ${NOTE_DECISIONS.join(", ")}`);
    if (typeof j.text !== "string" || [...j.text].length > 500) return err(res, 400, "bad_input", "text must be a string of at most 500 characters");
    const nf = noteFileStats(notesFile);
    if (nf.count >= MAX_NOTES || nf.bytes >= MAX_NOTES_BYTES) return err(res, 413, "notes_full", `triage notes file is full (${MAX_NOTES} notes or ${MAX_NOTES_BYTES / 1024} KB); delete or archive web/data/notes.jsonl to add more`);
    if (!parseLines(readLogText(logFile)).some(x => x.rec.reportHash === j.reportHash)) return err(res, 400, "bad_input", "no verdict-log record for that reportHash");
    appendNote(notesFile, { reportHash: j.reportHash, decision: j.decision, text: j.text });
    send(res, 200, { ok: true });
  }

  function serveStatic(req, res, pathname) {
    let p = pathname === "/" ? "/index.html" : pathname;
    const bad = () => err(res, 404, "not_found", "not found");
    if ((req.url ?? "").split("?")[0].includes("..") || /%/.test(req.url ?? "")) return bad(); // no dot-dot or percent-encoding tricks, even ones the URL parser would normalize
    if (!/^\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p) || p.split("/").some(s => s.startsWith("."))) return bad();
    const ext = p.split(".").pop().toLowerCase();
    if (!MIME[ext]) return bad();
    try {
      const real = realpathSync(path.join(publicDir, p)), rootReal = realpathSync(publicDir);
      if (!real.startsWith(rootReal + path.sep) || !statSync(real).isFile()) return bad();
      const data = readFileSync(real);
      res.writeHead(200, { ...baseHeaders, "content-type": MIME[ext], "content-length": data.length, "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch { bad(); }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address().port;
      if (!guard(req, res, port)) return;
      const url = new URL(req.url, "http://x");
      const p = url.pathname;
      if (req.method === "GET" || req.method === "HEAD") {
        if (p === "/api/config") return send(res, 200, config());
        if (p === "/api/log") return send(res, 200, buildLogView({ file: logFile, signerPub, mode, labelFor: h => labelByHash.get(h) }));
        if (p === "/api/inbox") return send(res, 200, buildInbox({ file: logFile, notesFile, signerPub }));
        const m = /^\/api\/jobs\/([0-9a-f-]{36})\/events$/.exec(p);
        if (m) return sse(req, res, m[1]);
        if (p.startsWith("/api/")) return err(res, 404, "not_found", "unknown API route");
        return serveStatic(req, res, p);
      }
      if (req.method === "POST") {
        if (p === "/api/submit") return await submit(req, res);
        if (p === "/api/notes") return await notes(req, res);
        return err(res, 404, "not_found", "unknown API route");
      }
      return err(res, 405, "method_not_allowed", "method not allowed", {});
    } catch { if (!res.headersSent) err(res, 500, "internal", "internal error"); else res.end(); }
  });
  return {
    server, budget, state: st, token,
    listen: (port = 0) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => resolve(server.address().port)); }),
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

// ---------- main ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = process.env;
    assertNoSecrets(env);
    const mode = env.WEB_MODE;
    if (mode !== "stub" && mode !== "real") throw new Error("WEB_MODE must be stub or real (use scripts/web.sh --stub|--real)");
    const port = Number(env.WEB_PORT || 4030);
    const runDir = env.WEB_RUN_DIR || path.join(ROOT, "web", "run", mode);
    const swept = sweepRunDir(runDir, Date.now()); if (swept) console.log(`removed ${swept} leftover job/scratch file(s) from a previous run`);
    const app = createApp({ mode, runDir, serverPort: Number(env.WEB_SERVER_PORT || 4021) });
    const p = await app.listen(port);
    console.log(`web app (${mode} mode) listening on http://127.0.0.1:${p}`);
    // Kill the agent child on SIGINT/SIGTERM/normal exit. SIGKILL of this process cannot be handled: the child is then orphaned (QE-W-002, documented).
    const killChild = () => { try { app.state.child?.kill("SIGKILL"); } catch { /* gone */ } };
    process.on("exit", killChild);
    for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { killChild(); process.exit(0); });
  } catch (e) { console.error("web server: " + (e?.message ?? e)); process.exit(2); }
}
