"use strict";
/* Prove-It Bond local web app. Plain JS, no framework, no external requests.
   All report- or log-derived text goes through textContent. Never innerHTML.
   Fixture mode (no backend): open index.html?fixtures=1 (see FIXTURES below). */
(function () {
  const Q = new URLSearchParams(location.search);
  const FIX = Q.get("fixtures") === "1";
  const FX = {
    mode: Q.get("mode") === "real" ? "real" : "stub",
    log: Q.get("log") || "ok",          // ok | tampered | empty | xss | error
    inbox: Q.get("inbox") || "ok",      // ok | empty | xss
    xss: Q.get("xss") === "1",
    busy: Q.get("busy") === "1",
    scenario: Q.get("scenario") || "auto", // auto | success_returned | success_forfeited | refused | settlement_pending | error | xss | busy | budget_exhausted | rate_limited
    base: new URL("../fixtures/", location.href).href,
    delay: Number(Q.get("delay") || 700),
  };

  // ---------- helpers ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; };
  const add = (p, ...kids) => { kids.forEach(k => k && p.appendChild(k)); return p; };
  const $ = id => document.getElementById(id);
  const SIG = /^[1-9A-HJ-NP-Za-km-z]{43,90}$/;
  const AMT = /^[0-9]{1,12}$/;
  const usd = a => AMT.test(String(a)) ? "$" + (Number(a) / 1e6).toFixed(2) : "unknown";
  const usdNum = n => (typeof n === "number" || (typeof n === "string" && n !== "" && !isNaN(Number(n)))) ? "$" + Number(n).toFixed(2) : "unknown";
  const short = s => (typeof s === "string" && s.length > 20) ? s.slice(0, 10) + "..." + s.slice(-8) : String(s);
  const KNOWN = ["reproduced", "not_reproduced", "inconclusive"];
  const word = v => v === "not_reproduced" ? "not reproduced" : String(v);

  function txLink(sig) {
    const s = el("span", "mono");
    if (typeof sig === "string" && SIG.test(sig)) {
      const a = el("a", "mono", short(sig));
      a.href = "https://explorer.solana.com/tx/" + sig + "?cluster=devnet";
      a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", "settle tx on Solana Explorer (devnet)");
      s.appendChild(a);
    } else s.textContent = sig ? "invalid signature, no link" : "none";
    return s;
  }
  function badge(v) {
    const m = { reproduced: ["b-repro", "REPRODUCED"], not_reproduced: ["b-forf", "NOT REPRODUCED"], inconclusive: ["b-inc", "INCONCLUSIVE"], error: ["b-err", "ERROR"] };
    const [cls, t] = m[v] || ["b-err", v ? "UNKNOWN VERDICT" : "NO RECORD"];
    return el("span", "badge " + cls, t);
  }
  const row = (k, node) => { const d = el("div", "row"); d.appendChild(el("span", "", k)); d.appendChild(typeof node === "string" ? el("span", "mono", node) : node); return d; };
  function details(summary, ...kids) { const d = el("details"); d.appendChild(el("summary", "", summary)); kids.forEach(k => d.appendChild(k)); return d; }
  function emptyBox(text) { return el("p", "empty", text); }
  function errorBox(text, retry) {
    const b = el("div", "banner fail"); b.setAttribute("role", "alert"); b.appendChild(el("div", "", text));
    if (retry) { const r = el("button", "btn", "Retry"); r.type = "button"; r.addEventListener("click", retry); b.appendChild(el("div")).appendChild(r); }
    return b;
  }

  // ---------- data access (real or fixture) ----------
  async function getJson(url) {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
    return r.json();
  }
  const fx = name => getJson(FX.base + name);
  let fxInbox = null;
  async function api(path) {
    if (!FIX) return getJson(path);
    if (path === "/api/config") { const c = await fx(FX.busy ? "config.busy.json" : FX.xss ? "config.xss.json" : "config." + FX.mode + ".json"); if (FX.busy && FX.mode === "real") c.mode = "real"; return c; }
    if (path === "/api/log") {
      if (FX.log === "error") throw new Error("fixture: log unavailable");
      const real = FX.mode === "real";
      const name = FX.log === "tampered" ? (real ? "log.real.tampered.json" : "log.tampered.json") : FX.log === "empty" ? "log.empty.json" : FX.log === "xss" ? "log.xss.json" : real ? "log.real.json" : "log.stub.json";
      const l = await fx(name); l.mode = FX.mode; return l;
    }
    if (path === "/api/inbox") {
      if (!fxInbox) fxInbox = await fx(FX.inbox === "empty" ? "inbox.empty.json" : FX.inbox === "xss" || FX.xss ? "inbox.xss.json" : "inbox." + FX.mode + ".json");
      return fxInbox;
    }
    throw new Error("fixture: no route " + path);
  }
  async function postNote(body) {
    if (FIX) { await fx("notes.ok.json"); const it = fxInbox && fxInbox.items.find(i => i.reportHash === body.reportHash); if (it) it.note = body.decision === "unreviewed" ? null : { decision: body.decision, text: body.text, ts: new Date().toISOString() }; return; }
    const r = await fetch("/api/notes", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": cfg.csrfToken }, body: JSON.stringify(body) });
    if (!r.ok) { let m = "HTTP " + r.status; try { m = (await r.json()).message || m; } catch (_) { } throw new Error(m); }
  }
  async function postSubmit(sel) {
    // returns {status, body}
    if (FIX) {
      let sc = FX.scenario;
      if (sc === "auto") sc = sel.demo && sel.demo.category === "hand_made_fake" ? "success_forfeited" : "success_returned";
      fxScenario = sc;
      const map = { busy: ["submit.409.json", 409], budget_exhausted: ["submit.422.json", 422], rate_limited: ["submit.429.json", 429], too_large: ["submit.413.json", 413] };
      if (map[sc]) return { status: map[sc][1], body: await fx(map[sc][0]) };
      return { status: 202, body: await fx("submit.202.json") };
    }
    const headers = { "x-csrf-token": cfg.csrfToken, "content-type": "application/octet-stream" };
    let body;
    if (sel.demo) { headers["x-demo-input-id"] = sel.demo.id; body = new Uint8Array(0); }
    else { headers["x-filename"] = String(sel.file.name).replace(/[^\x20-\x7e]/g, "_").slice(0, 100); body = await sel.file.arrayBuffer(); }
    const r = await fetch("/api/submit", { method: "POST", headers, body });
    let j = {}; try { j = await r.json(); } catch (_) { }
    return { status: r.status, body: j };
  }
  let fxScenario = null;

  function parseSse(text) {
    return text.split(/\n\n+/).map(b => {
      let ev = "message", data = [];
      b.split("\n").forEach(l => { if (l.startsWith("event:")) ev = l.slice(6).trim(); else if (l.startsWith("data:")) data.push(l.slice(5).trim()); });
      if (!data.length) return null;
      try { return { ev, d: JSON.parse(data.join("\n")) }; } catch (_) { return null; }
    }).filter(Boolean);
  }
  let stream = null; // {close()}
  function openStream(jobId, onEvent, onLost) {
    if (stream) stream.close();
    if (FIX) {
      let cancelled = false; const timers = [];
      const file = { success_returned: "sse.success_returned.txt", success_forfeited: "sse.success_forfeited.txt", refused: "sse.refused.txt", settlement_pending: "sse.settlement_pending.txt", error: "sse.error.txt", xss: "sse.xss.txt" }[fxScenario] || "sse.success_returned.txt";
      fetch(FX.base + file).then(r => r.text()).then(t => {
        const evs = parseSse(t); let at = 0;
        evs.forEach(e => { at += e.ev === "checking" ? FX.delay * 2 : FX.delay; timers.push(setTimeout(() => { if (!cancelled) onEvent(e.ev, e.d); }, at)); });
      }).catch(() => onLost());
      stream = { close() { cancelled = true; timers.forEach(clearTimeout); } };
      return;
    }
    const es = new EventSource("/api/jobs/" + encodeURIComponent(jobId) + "/events");
    ["started", "decision", "checking", "verdict", "settled", "error", "done"].forEach(t => es.addEventListener(t, m => { let d = {}; try { d = JSON.parse(m.data); } catch (_) { } onEvent(t, d); }));
    es.onerror = () => { if (es.readyState === 2 || !runDone) { es.close(); onLost(); } };
    stream = { close() { es.close(); } };
  }

  // ---------- state ----------
  let cfg = null, cfgErr = null, logData = null, logErr = null, inboxData = null, inboxErr = null;
  let sel = { demo: null, file: null, fileErr: null };
  let submitMsg = null; // {kind, text}
  let decisions = [];
  let run = null, runDone = false;

  // ---------- banners ----------
  function renderBanners() {
    const w = $("banners"); w.replaceChildren();
    if (cfgErr) { w.appendChild(errorBox("Cannot reach the backend (" + cfgErr + "). Nothing below can be trusted or used until it loads.", loadAll)); return; }
    if (!cfg) { w.appendChild(el("div", "banner note", "Loading config...")); return; }
    const verifyOk = logData && logData.verify && logData.verify.ok === true;
    if (cfg.mode === "stub") {
      const b = el("div", "banner stub", "STUB VERIFIER: not a real sandbox run. Not evidence."); b.setAttribute("role", "alert"); w.appendChild(b);
    } else if (cfg.mode !== "real") {
      w.appendChild(errorBox("UNKNOWN RUN MODE (" + cfg.mode + "): do not treat anything here as evidence."));
    }
    if (logData && !verifyOk) {
      const b = el("div", "banner fail"); b.setAttribute("role", "alert");
      const v = logData.verify || {};
      b.appendChild(el("div", "", "CHECKS FAILED: the signed log did not verify (" + (v.verified ?? "?") + " of " + (v.records ?? "?") + " entries verified). Do not trust these results."));
      const ul = el("ul", "list"); (v.problems || []).forEach(p => ul.appendChild(el("li", "", "log line " + p.line + ": " + p.message))); b.appendChild(ul); w.appendChild(b);
    } else if (cfg.mode === "real" && logData && verifyOk) {
      w.appendChild(el("div", "banner real", "REAL verifier. The log re-verification passed (" + logData.verify.verified + " of " + logData.verify.records + " entries). That covers the log, not whether the verdicts are right: a human triages reproduced reports."));
    } else if (cfg.mode === "real") {
      const b = el("div", "banner fail", "Real mode, but the signed log could not be checked (" + (logErr || "no log") + "). Not labeled as verified real results."); b.setAttribute("role", "alert"); w.appendChild(b);
    }
    if (cfg.mode === "real") w.appendChild(el("div", "banner note", "UNVERIFIED viewer: the real-mode view has only been tested against fixtures until a real run is rendered and compared with RESULTS.md."));
    w.appendChild(el("div", "banner note", "Demo wallet pays on your behalf. This is not a third-party sender."));
  }

  // ---------- screen 1: Submit ----------
  function renderSubmit() {
    const p = $("panel-submit"); p.replaceChildren();
    if (cfgErr) { p.appendChild(emptyBox("Config not loaded.")); return; }
    if (!cfg) { p.appendChild(emptyBox("Loading...")); return; }
    p.appendChild(el("h2", "", "Choose a proof input"));
    if (cfg.busy) { const b = el("div", "banner fail", "Busy: a report is already being processed. One job at a time; try again when it finishes."); b.setAttribute("role", "status"); p.appendChild(b); }
    const fs = el("fieldset"); fs.className = "panel";
    const lg = el("legend", "", "Demo inputs"); fs.appendChild(lg);
    if (!cfg.demoInputs.length) fs.appendChild(emptyBox("No demo inputs configured."));
    cfg.demoInputs.forEach(d => {
      const lab = el("label", "pick"); const inp = document.createElement("input"); inp.type = "radio"; inp.name = "demo"; inp.value = d.id; inp.checked = !!(sel.demo && sel.demo.id === d.id);
      inp.addEventListener("change", () => { sel = { demo: d, file: null, fileErr: null }; submitMsg = null; renderSubmit(); });
      lab.appendChild(inp); lab.appendChild(document.createTextNode(" "));
      lab.appendChild(d.handMade ? el("span", "tag", "HAND-MADE") : el("span", "tag real", "REAL BUG (hand-assigned)"));
      lab.appendChild(el("span", "", d.label)); lab.appendChild(el("span", "mono fn", "  " + d.sizeBytes + " bytes"));
      fs.appendChild(lab);
    });
    fs.appendChild(el("p", "fn", "Labels are assigned by hand in demo/manifest.json. They are not measured by the system."));
    p.appendChild(fs);
    const fp = el("div", "panel"); const fl = el("label", "", "Or choose a file (at most " + cfg.limits.maxInputBytes + " bytes): ");
    const fi = document.createElement("input"); fi.type = "file"; fi.id = "file-input"; fl.appendChild(fi); fp.appendChild(fl);
    fi.addEventListener("change", () => {
      const f = fi.files[0]; if (!f) return;
      if (f.size > cfg.limits.maxInputBytes) { sel = { demo: null, file: null, fileErr: "File is " + f.size + " bytes; the limit is " + cfg.limits.maxInputBytes + "." }; }
      else if (f.size === 0) { sel = { demo: null, file: null, fileErr: "File is empty; the server rejects empty bodies." }; }
      else sel = { demo: null, file: f, fileErr: null };
      submitMsg = null; renderSubmit();
    });
    if (sel.file) fp.appendChild(el("p", "mono", "Selected: " + sel.file.name + " (" + sel.file.size + " bytes)"));
    if (sel.fileErr) { const e = el("p", "banner fail", sel.fileErr); e.setAttribute("role", "alert"); fp.appendChild(e); }
    p.appendChild(fp);

    p.appendChild(el("h2", "", "The quote"));
    const q = el("div", "panel"); const ul = el("ul", "p");
    ul.appendChild(el("li", "", "Bond: $0.25 (USDC, Solana devnet), refundable, posted by the demo agent."));
    ul.appendChild(el("li", "", "Reproduced or inconclusive: bond returned ($0 settled)."));
    ul.appendChild(el("li", "", "Not reproduced: bond forfeited ($0.25 settled)."));
    ul.appendChild(el("li", "", "Any error, crash or timeout also settles $0."));
    q.appendChild(ul);
    const t = cfg.target;
    q.appendChild(row("Target", "libucl, case " + t.caseId));
    q.appendChild(row("Pinned vulnerable commit", el("span", "mono", t.targetCommit)));
    q.appendChild(row("Fixed control commit", el("span", "mono", t.fixCommit)));
    q.appendChild(el("p", "fn", "Caveat: " + t.caveat));
    q.appendChild(details("Technical detail: images", row("Vulnerable image", el("span", "mono", t.vulImage)), row("Fixed image", el("span", "mono", t.fixImage))));
    p.appendChild(q);
    p.appendChild(el("h2", "", "Sandbox limits"));
    const lm = el("div", "panel"); const lu = el("ul", "p");
    cfg.limits.sandbox.forEach(s => lu.appendChild(el("li", "", s)));
    lu.appendChild(el("li", "", "Verifier hard cap " + cfg.limits.verifierTimeoutSeconds + " s; input cap " + cfg.limits.maxInputBytes + " bytes; at most " + cfg.limits.maxConcurrent + " concurrent runs; one submit per " + cfg.limits.rateLimitSeconds + " s."));
    lm.appendChild(lu); lm.appendChild(el("p", "fn", "The sandbox is a filter, not a judge, and we do not claim it is escape-proof. In production the verifier runs on the maintainer's infrastructure."));
    p.appendChild(lm);

    const can = !!(sel.demo || sel.file);
    const act = el("div", "actions"); const btn = el("button", "btn primary", "Submit with a $0.25 bond..."); btn.type = "button"; btn.disabled = !can || cfg.busy; btn.id = "submit-btn";
    btn.addEventListener("click", openConfirm); act.appendChild(btn); p.appendChild(act);
    if (!can) p.appendChild(el("p", "fn", "Pick a demo input or a file first."));
    if (submitMsg) { const m = el("div", "banner " + (submitMsg.kind === "busy" ? "note" : "fail"), submitMsg.text); m.setAttribute("role", "alert"); p.appendChild(m); }
  }
  function openConfirm() {
    const what = sel.demo ? (sel.demo.handMade ? "HAND-MADE: " : "") + sel.demo.label : sel.file.name + " (" + sel.file.size + " bytes)";
    $("confirm-what").textContent = "Input: " + what;
    const dlg = $("confirm"); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  async function doSubmit() {
    submitMsg = null;
    let r;
    try { r = await postSubmit(sel); } catch (e) { submitMsg = { kind: "err", text: "Submit failed: " + e.message + ". Nothing was paid (the request did not complete)." }; renderSubmit(); return; }
    if (r.status === 202 && r.body && r.body.jobId) { startRun(r.body.jobId); return; }
    const b = r.body || {}; const msg = typeof b.message === "string" ? b.message : "no message";
    const m = { 409: "Busy (409): ", 422: "Refused (422, session budget): ", 429: "Rate limited (429): ", 413: "Too large (413): ", 403: "Blocked (403): ", 400: "Bad input (400): " }[r.status] || ("Error (HTTP " + r.status + "): ");
    submitMsg = { kind: r.status === 409 ? "busy" : "err", text: m + msg + (r.status === 429 && b.retryAfterSeconds ? " Retry in " + b.retryAfterSeconds + " s." : "") + " No payment was made." };
    refreshConfig(); renderSubmit();
  }

  // ---------- screen 2: Run ----------
  const STEPS = [["policy", "Policy check"], ["approved", "Approved"], ["signed", "Payment signed"], ["chain", "Checking the chain"], ["verdict", "Verdict"], ["settled", "Settled"]];
  function newRun(jobId) { const steps = {}; STEPS.forEach(([k]) => steps[k] = { st: "pending", text: "" }); return { jobId, reportHash: null, steps, notes: [], outcome: null, error: null, lost: false, done: false, events: [] }; }
  function startRun(jobId) {
    run = newRun(jobId); runDone = false; renderRun(); selectTab("run");
    openStream(jobId, onEvent, () => { if (!runDone) { run.lost = true; renderRun(); } });
  }
  function setStep(k, st, text) { run.steps[k] = { st, text }; }
  function onEvent(t, d) {
    if (!run) return;
    run.events.push({ t, d });
    if (t === "started") run.reportHash = d.reportHash;
    else if (t === "decision") {
      decisions.push({ ts: d.ts, action: d.action, detail: d.detail, job: run.jobId }); if (decisions.length > 200) decisions.shift();
      if (d.action === "allow") setStep("policy", "done", "Allowed: " + d.detail);
      else if (d.action === "refuse") { setStep("policy", "fail", "Refused: " + d.detail); run.refused = true; }
      else if (d.action === "approve") setStep("approved", "done", d.detail);
      else if (d.action === "reject") setStep("approved", "fail", "Not approved: " + d.detail);
      else if (d.action === "sign") setStep("signed", "done", d.detail);
      else if (d.action === "retry") run.notes.push("retry: " + d.detail);
    } else if (t === "checking") setStep("chain", "active", (d.message || "checking the chain") + " (not a failure; waiting for settlement to be confirmed)");
    else if (t === "verdict") setStep("verdict", d.verdict === "error" ? "fail" : "done", word(d.verdict) + (d.detail ? ": " + d.detail : ""));
    else if (t === "settled") {
      if (run.steps.chain.st === "active") setStep("chain", "done", "Settlement confirmed");
      setStep("settled", "done", usd(d.settledAtomic) + " settled");
      run.outcome = { kind: d.bondOutcome, atomic: d.settledAtomic, tx: d.txSignature };
    } else if (t === "error") { run.error = { message: d.message, atomic: d.settledAtomic }; }
    else if (t === "done") { run.done = true; runDone = true; if (stream) stream.close(); refreshConfig(); refreshLog(); inboxData = null; if (FIX) { } }
    if (t === "done") STEPS.forEach(([k]) => { if (run.steps[k].st === "pending" || run.steps[k].st === "active") run.steps[k] = { st: "skip", text: k === "chain" && run.steps.settled.st === "done" ? "no waiting needed: settlement was confirmed immediately" : "not reached" }; });
    renderRun();
  }
  function renderRun() {
    const p = $("panel-run"); p.replaceChildren();
    p.appendChild(el("h2", "", "Live status"));
    if (!run) { p.appendChild(emptyBox("No run yet. Submit an input on the Submit screen.")); return; }
    p.appendChild(el("p", "mono fn", "job " + run.jobId + (run.reportHash ? " | report hash " + run.reportHash : "")));
    const ol = el("ol", "steps"); ol.setAttribute("aria-live", "polite");
    const lab = { pending: "WAITING", active: "IN PROGRESS", done: "DONE", fail: "FAILED", skip: "SKIPPED" };
    STEPS.forEach(([k, name]) => {
      const s = run.steps[k]; const li = el("li", "s-" + s.st); li.appendChild(el("span", "mk", lab[s.st]));
      const b = el("div", "tx"); b.appendChild(el("strong", "", name)); if (s.text) { b.appendChild(el("br")); b.appendChild(el("span", "", s.text)); } li.appendChild(b); ol.appendChild(li);
    });
    p.appendChild(ol);
    run.notes.forEach(n => p.appendChild(el("p", "fn", n)));
    if (run.lost) p.appendChild(errorBox("Lost the live connection before the run finished. The outcome is UNKNOWN here: check Results and trust for the signed record."));
    if (run.outcome) {
      const o = run.outcome; const kind = o.kind;
      const box = el("div", "panel");
      const txt = kind === "returned" ? "Bond returned" : kind === "forfeited" ? "Bond forfeited" : "Bond outcome unknown: check the chain";
      box.appendChild(el("div", "outcome " + (kind === "returned" ? "ret" : kind === "forfeited" ? "forf" : "unk"), txt));
      box.appendChild(el("p", "", kind === "returned" ? "The sandbox did not settle any money (" + usd(o.atomic) + " settled); the escrowed $0.25 deposit goes back to the demo wallet." : kind === "forfeited" ? usd(o.atomic) + " was settled to the receiver wallet (a transfer between our own demo wallets)." : "Settled amount reported: " + usd(o.atomic) + ". Do not assume either way until the chain confirms."));
      box.appendChild(row("settle tx", txLink(o.tx)));
      box.appendChild(el("p", "fn", "One Explorer link only: the log records the settle tx, not the deposit tx."));
      p.appendChild(box);
    }
    if (run.error) {
      const b = el("div", "banner fail"); b.setAttribute("role", "alert");
      b.appendChild(el("div", "", run.refused ? "Refused by policy, no payment was made." : "Error"));
      b.appendChild(el("div", "mono", run.error.message));
      b.appendChild(el("div", "", "Settled amount: " + (run.error.atomic === null || run.error.atomic === undefined ? "none (no payment was made)" : usd(run.error.atomic) + (run.error.atomic === "0" ? " (the error path settles $0)" : ""))));
      p.appendChild(b);
    }
    if (run.done && !run.error && !run.outcome) p.appendChild(emptyBox("Run finished without a settled event. Check Results and trust."));
    if (!run.done && !run.lost) p.appendChild(el("p", "fn", "Waiting for events..."));
    const evd = el("div"); run.events.forEach(e => evd.appendChild(el("div", "mono fn", e.t + " " + JSON.stringify(e.d))));
    p.appendChild(details("Technical detail: raw events (" + run.events.length + ")", evd));
    if (run.done) { const b = el("button", "btn", "Submit another"); b.type = "button"; b.addEventListener("click", () => selectTab("submit")); p.appendChild(b); }
  }

  // ---------- screen 3: Results and trust ----------
  function renderResults() {
    const p = $("panel-results"); p.replaceChildren();
    p.appendChild(el("h2", "", "Results from the signed log"));
    if (logErr) { p.appendChild(errorBox("Could not load the log: " + logErr, loadLog)); return; }
    if (!logData) { p.appendChild(emptyBox("Loading...")); return; }
    const L = logData, V = L.verify, recs = L.records.slice().sort((a, b) => b.seq - a.seq);
    const c = { reproduced: 0, forfeited: 0, inconclusive: 0, errors: 0, wrong: 0 };
    const errRows = [];
    recs.forEach(r => {
      if (r.verdict === "reproduced") c.reproduced++; else if (r.verdict === "not_reproduced") { c.forfeited++; if (r.category === "real_bug") c.wrong++; }
      else if (r.verdict === "inconclusive") c.inconclusive++; else { c.errors++; errRows.push(r); }
    });
    if (!recs.length) p.appendChild(emptyBox("The log is empty: no reports have been settled yet."));
    const g = el("div", "counts");
    const box = (n, l, x) => { const d = el("div", "count"); add(d, el("div", "n", n), el("div", "l", l)); if (x) d.appendChild(el("div", "x", x)); g.appendChild(d); };
    box(c.reproduced, "Reproduced", "bond returned ($0 settled)");
    box(c.forfeited, "Not reproduced", "bond forfeited ($0.25 settled)");
    box(c.inconclusive, "Inconclusive", "bond returned ($0 settled)");
    box(c.errors, "Errors", "settled: " + (errRows.length ? errRows.map(r => usd(r.settledAtomic)).join(", ") : "none") + " (expected $0)");
    box(c.wrong + " *", "Wrongly forfeited", "hand-labeled real bugs that were forfeited");
    p.appendChild(g);
    p.appendChild(el("p", "fn", "* \"Real bug\" and \"hand-made fake\" labels, and so this count, are assigned by hand in demo/manifest.json by proof hash. The system does not measure them and they are not in the signed log. Entries with no label were submitted outside the demo set."));

    p.appendChild(el("h2", "", "Reports (" + recs.length + ", newest first)"));
    const cards = el("div", "cards");
    recs.forEach(r => {
      const bad = r.sigOk !== true;
      const cd = el("div", "card" + (bad ? " broken" : ""));
      const top = el("div");
      top.appendChild(r.category === "hand_made_fake" ? el("span", "tag", "HAND-MADE") : r.category === "real_bug" ? el("span", "tag real", "REAL BUG (hand-assigned)") : el("span", "tag", "UNLABELED"));
      top.appendChild(badge(r.verdict)); cd.appendChild(top);
      cd.appendChild(el("h3", "", r.label || "Unlabeled submission"));
      const settled = AMT.test(String(r.settledAtomic)) ? Number(r.settledAtomic) : null;
      cd.appendChild(el("div", "", settled === 0 ? "Bond returned" : settled > 0 ? "Bond forfeited" : "Settled amount unknown"));
      cd.appendChild(row("settled", r.settledAtomic === null ? "no record" : usd(r.settledAtomic)));
      cd.appendChild(row("status", r.settlementStatus === "pending" ? "checking the chain" : String(r.settlementStatus)));
      cd.appendChild(row("settle tx", txLink(r.txSignature)));
      cd.appendChild(row("log record", "seq " + r.seq + (bad ? " (NOT VERIFIED)" : " (signature ok)")));
      if (bad) cd.appendChild(el("p", "banner fail", "This record's signature did not verify. Do not trust it."));
      cd.appendChild(details("Technical detail", el("div", "mono fn", "detail: " + (r.detail ?? "-")), el("div", "mono fn", "report hash: " + r.reportHash), el("div", "mono fn", "time: " + r.timestamp)));
      cards.appendChild(cd);
    });
    p.appendChild(cards);
    if (recs.length) p.appendChild(el("p", "fn", "The log stores one transaction signature per report, the settle tx. The deposit (escrow open) tx is not recorded in the log, so each card has at most one link."));

    p.appendChild(el("h2", "", "Trust"));
    const t = el("div", "panel");
    const h = el("div", "outcome " + (V.ok ? "ret" : "forf"), V.verified + " of " + V.records + " log entries verified"); t.appendChild(h);
    if (!V.ok) {
      const b = el("div", "banner fail"); b.setAttribute("role", "alert"); b.appendChild(el("div", "", "BROKEN ENTRIES: " + (V.records - V.verified) + " of " + V.records + " did not verify."));
      const ul = el("ul", "list"); V.problems.forEach(pr => ul.appendChild(el("li", "", "BROKEN log line " + pr.line + ": " + pr.message))); b.appendChild(ul); t.appendChild(b);
    }
    const dl = el("dl"); const kv = (k, v, mono) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", mono ? "mono" : "", v)); };
    kv("Signer public key (pinned)", L.signer, true);
    kv("Log head", L.head ? "seq " + L.head.seq + ", sha256(last line) " + L.head.hash : "none (empty log)", true);
    kv("Mode", L.mode); kv("Network", "Solana devnet; cap $0.25 per report");
    t.appendChild(dl);
    t.appendChild(el("p", "fn", "Tail truncation is undetectable from the log alone: dropping the last N records leaves a valid chain. Publish the head hash and seq elsewhere to make it detectable. Records are signed by the server, so they are not independent proof that the server told the truth."));
    t.appendChild(el("p", "fn", "Both wallets belong to the demo operator; a forfeit here is a transfer between our own wallets."));
    p.appendChild(t);
    p.appendChild(el("h2", "", "Not demonstrated, and caveats"));
    const n = el("div", "panel"); const nu = el("ul", "p");
    ["flaky_or_timeout", "crash_on_both"].forEach(k => nu.appendChild(el("li", "", k + ": NOT demonstrated. The backtest found no genuine example and we do not fake one.")));
    nu.appendChild(el("li", "", "libucl/ARVO caveat: the fixed image is a later libucl version, not the per-bug fix commit; reproduced means the input triggers the expected ASan error on the pinned vulnerable build and the crash is gone in a later libucl."));
    nu.appendChild(el("li", "", "The sandbox is a filter, not a judge. Not reproduced only means this pinned build ran the input clean."));
    nu.appendChild(el("li", "", "This does not prove that spam is stopped. The demo set is small and hand-picked."));
    if (cfg && cfg.mode === "stub") nu.appendChild(el("li", "", "Stub mode: everything about the real verifier, Docker and ASan is unexercised."));
    n.appendChild(nu); p.appendChild(n);
  }

  // ---------- screen 4: Maintainer inbox ----------
  function renderInbox() {
    const p = $("panel-inbox"); p.replaceChildren();
    p.appendChild(el("h2", "", "Maintainer inbox: reproduced and inconclusive, newest first"));
    p.appendChild(el("p", "fn", "Triage notes, not payouts. Nothing here moves money: the verdict already decided the settlement."));
    if (inboxErr) { p.appendChild(errorBox("Could not load the inbox: " + inboxErr, loadInbox)); return; }
    if (!inboxData) { p.appendChild(emptyBox("Loading...")); return; }
    const items = inboxData.items;
    if (!items.length) { p.appendChild(emptyBox("Nothing to triage: no reproduced or inconclusive reports yet.")); return; }
    items.forEach(it => {
      const card = el("div", "panel");
      const top = el("div"); top.appendChild(badge(it.verdict)); card.appendChild(top);
      card.appendChild(el("h3", "", it.errorType ? it.errorType + (it.topFrame ? " at " + it.topFrame : "") : it.topFrame ? "Top frame: " + it.topFrame : "No error type in the log detail"));
      card.appendChild(row("proof hash", el("span", "mono", it.reportHash)));
      card.appendChild(row("case / commit", el("span", "mono", (it.caseId || "-") + " / " + (it.targetCommit || "-"))));
      card.appendChild(row("time", el("span", "mono", it.timestamp)));
      card.appendChild(details("Technical detail (from the signed log)", el("div", "mono fn", it.detail)));
      const st = el("p", "fn", it.note ? "Triage: " + it.note.decision + (it.note.text ? " - " + it.note.text : "") + " (" + it.note.ts + ")" : "Not triaged yet.");
      card.appendChild(st);
      const ta = document.createElement("input"); ta.type = "text"; ta.maxLength = 500; ta.placeholder = "Optional note (500 characters max)"; ta.setAttribute("aria-label", "Triage note text");
      card.appendChild(ta);
      const act = el("div", "actions"); const msg = el("span", "fn", "");
      [["valid", "Valid"], ["not_a_bug", "Not a bug"], ["misuse", "Misuse"]].forEach(([d, l]) => {
        const b = el("button", "btn", l); b.type = "button";
        b.addEventListener("click", async () => {
          try { await postNote({ reportHash: it.reportHash, decision: d, text: ta.value.slice(0, 500) }); it.note = { decision: d, text: ta.value.slice(0, 500), ts: new Date().toISOString() }; renderInbox(); }
          catch (e) { msg.textContent = "Note not saved: " + e.message; }
        });
        act.appendChild(b);
      });
      act.appendChild(msg); card.appendChild(act);
      card.appendChild(el("p", "fn", "These buttons write local triage notes only."));
      p.appendChild(card);
    });
  }

  // ---------- screen 5: Agent policy ----------
  function renderPolicy() {
    const p = $("panel-policy"); p.replaceChildren();
    p.appendChild(el("h2", "", "Agent policy (enforced in agent code)"));
    if (cfgErr) { p.appendChild(errorBox("Config not loaded: " + cfgErr, loadAll)); return; }
    if (!cfg) { p.appendChild(emptyBox("Loading...")); return; }
    const po = cfg.policy, s = cfg.session;
    const d = el("div", "panel"); const dl = el("dl");
    const kv = (k, v) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "mono", v)); };
    kv("Per-report cap", usdNum(po.perReportCapUsd)); kv("Session budget", usdNum(po.sessionBudgetUsd));
    kv("Allowlist", po.allowedUrl); kv("Human approval above", usdNum(po.approvalThresholdUsd) + " (the confirm dialog is that approval)");
    kv("Retry budget", String(po.retryBudget)); d.appendChild(dl); p.appendChild(d);
    p.appendChild(el("h2", "", "Session budget"));
    const b = el("div", "panel"); const tot = Number(s.budgetAtomic) || 1;
    const pct = a => Math.max(0, Math.min(100, Number(a) / tot * 100));
    const bar = el("div", "bar"); bar.setAttribute("role", "img"); bar.setAttribute("aria-label", "spent " + usd(s.spentAtomic) + ", reserved " + usd(s.reservedAtomic) + ", remaining " + usd(s.remainingAtomic) + " of " + usd(s.budgetAtomic));
    [["sp", s.spentAtomic], ["rs", s.reservedAtomic], ["rm", s.remainingAtomic]].forEach(([c, a]) => { const sp = el("span", c); sp.style.width = pct(a) + "%"; bar.appendChild(sp); });
    b.appendChild(bar);
    const lg = el("div", "legend"); lg.appendChild(el("span", "", "spent " + usd(s.spentAtomic))); lg.appendChild(el("span", "", "reserved " + usd(s.reservedAtomic))); lg.appendChild(el("span", "", "remaining " + usd(s.remainingAtomic))); lg.appendChild(el("span", "", "budget " + usd(s.budgetAtomic)));
    b.appendChild(lg); p.appendChild(b);
    p.appendChild(el("h2", "", "Decision stream"));
    const ds = el("div", "panel");
    if (!decisions.length) ds.appendChild(emptyBox("No decisions seen yet in this browser session. They appear here as runs happen (the backend has no history endpoint)."));
    else decisions.slice().reverse().forEach(x => { const r = el("div", "row"); r.appendChild(el("span", "mono", x.ts + " " + x.action)); r.appendChild(el("span", "", x.detail)); ds.appendChild(r); });
    p.appendChild(ds);
  }

  // ---------- tabs ----------
  const TABS = ["submit", "run", "results", "inbox", "policy"];
  function selectTab(name, focus) {
    TABS.forEach(t => { const on = t === name; const b = $("tab-" + t); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; $("panel-" + t).hidden = !on; });
    if (focus) $("tab-" + name).focus();
    if (name === "results") loadLog(); else if (name === "inbox") loadInbox(); else if (name === "policy") refreshConfig();
  }
  $("tabs").addEventListener("click", e => { const t = e.target.closest("[role=tab]"); if (t) selectTab(t.id.slice(4)); });
  $("tabs").addEventListener("keydown", e => {
    const i = TABS.findIndex(t => $("tab-" + t) === document.activeElement); if (i < 0) return;
    let n = null; if (e.key === "ArrowRight") n = (i + 1) % TABS.length; else if (e.key === "ArrowLeft") n = (i + TABS.length - 1) % TABS.length; else if (e.key === "Home") n = 0; else if (e.key === "End") n = TABS.length - 1;
    if (n !== null) { e.preventDefault(); selectTab(TABS[n], true); }
  });

  // ---------- loading ----------
  async function loadConfig() { try { cfg = await api("/api/config"); cfgErr = null; } catch (e) { cfgErr = e.message; } }
  async function refreshConfig() { await loadConfig(); renderBanners(); renderSubmit(); renderPolicy(); }
  async function loadLog() { try { logData = await api("/api/log"); logErr = null; } catch (e) { logErr = e.message; logData = null; } renderBanners(); renderResults(); }
  async function refreshLog() { return loadLog(); }
  async function loadInbox() { try { inboxData = await api("/api/inbox"); inboxErr = null; } catch (e) { inboxErr = e.message; } renderInbox(); }
  async function loadAll() { renderBanners(); await loadConfig(); renderBanners(); renderSubmit(); renderPolicy(); await Promise.all([loadLog(), loadInbox()]); }

  $("confirm-cancel").addEventListener("click", () => $("confirm").close());
  $("confirm-ok").addEventListener("click", () => { $("confirm").close(); doSubmit(); });

  if (FIX) {
    const fb = $("fixbar"); fb.hidden = false;
    fb.textContent = "FIXTURE MODE: no backend. Data comes from web/fixtures. Params: mode=stub|real, log=ok|tampered|empty|xss|error, inbox=ok|empty|xss, xss=1, busy=1, scenario=" + "success_returned|success_forfeited|refused|settlement_pending|error|xss|busy|budget_exhausted|rate_limited|too_large, delay=ms. Current: mode=" + FX.mode + ", scenario=" + FX.scenario + ".";
  }
  renderSubmit(); renderRun(); renderResults(); renderInbox(); renderPolicy();
  const startTab = Q.get("tab"); if (TABS.includes(startTab)) selectTab(startTab);
  loadAll().then(() => { if (FIX && Q.get("autorun") !== null && cfg) { const i = Number(Q.get("autorun") || 0); sel = { demo: cfg.demoInputs[i], file: null, fileErr: null }; renderSubmit(); doSubmit(); } });
  window.__app = FIX ? { selectTab, getState: () => ({ cfg, logData, run }), pick(i) { sel = { demo: cfg.demoInputs[i], file: null, fileErr: null }; renderSubmit(); }, doSubmit } : undefined;
})();
