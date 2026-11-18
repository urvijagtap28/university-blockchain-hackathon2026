"use strict";
/* Prove-It Bond local web app. Plain JS, no framework, no external requests.
   All report- or log-derived text goes through textContent. Never innerHTML.
   Fixture mode (no backend): open index.html?fixtures=1 (see FIXTURES below). */
(function () {
  const Q = new URLSearchParams(location.search);
  // Fixture mode only when opened from file:// or when /fixtures/ is really served next to the page (dev). On the live server it is not,
  // so a crafted ?fixtures=1 link is ignored there and cannot show fabricated results (QE-W-004).
  const FIX = Q.get("fixtures") === "1" && (location.protocol === "file:" || (() => {
    try { const x = new XMLHttpRequest(); x.open("HEAD", new URL("../fixtures/config.stub.json", location.href).href, false); x.send(); return x.status === 200; } catch (_) { return false; }
  })());
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
  const short = (s, a = 4, b = 4) => (typeof s === "string" && s.length > a + b + 1) ? s.slice(0, a) + "\u2026" + s.slice(-b) : String(s);
  const KNOWN = ["reproduced", "not_reproduced", "inconclusive"];
  const word = v => v === "not_reproduced" ? "not reproduced" : String(v);
  // Local time like "Nov 17, 2:41 PM". Falls back to the raw text if it does not parse.
  const when = ts => { const d = new Date(String(ts)); return isNaN(d.getTime()) ? String(ts) : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  // Never show raw "N atomic" amounts: turn them into dollars (USDC has 6 decimals).
  const money = t => String(t === undefined || t === null ? "" : t).replace(/\b(\d{1,12}) atomic\b/g, (_, n) => "$" + (Number(n) / 1e6).toFixed(2));
  // Amount of the bond that went back: per-report cap (from config) minus what was settled. Never hardcoded.
  const capAtomic = () => (cfg && cfg.policy && Number.isFinite(Number(cfg.policy.perReportCapUsd))) ? Math.round(Number(cfg.policy.perReportCapUsd) * 1e6) : null;
  const backAtomic = settled => { const c = capAtomic(); return (c !== null && AMT.test(String(settled)) && Number(settled) <= c) ? String(c - Number(settled)) : null; };
  // Compact display name for a demo input or ledger row. The full label stays in title/aria-label.
  const chipName = d => String(d.id || d.label || "").replace(/^fake_/, "").split("_").map((w, i) => w.toLowerCase() === "arvo" ? "ARVO" : w.toLowerCase() === "asan" ? "ASan" : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
  const rowName = r => r.label ? String(r.label).replace(/^HAND-MADE[^:]*:\s*/i, "").split(/\s*[(,]/)[0] : "Unlabeled";

  // Inline SVG icons, built with DOM nodes (no innerHTML, no external requests).
  const NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    upload: ["M12 16V4", "M7 9l5-5 5 5", "M5 20h14"],
    home: ["M4 11l8-7 8 7", "M6 10v10h12V10"],
    activity: ["M3 12h4l3-8 4 16 3-8h4"],
    ledger: ["M4 5h16", "M4 12h16", "M4 19h16"],
    inbox: ["M4 13l2-8h12l2 8", "M4 13v6h16v-6", "M4 13h5l1 2h4l1-2h5"],
    agent: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
    info: ["M12 11v6", "M12 7.5v.01", "M12 21a9 9 0 100-18 9 9 0 000 18z"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    x: ["M6 6l12 12", "M18 6L6 18"],
    alert: ["M12 8v5", "M12 16.5v.01", "M12 3l10 18H2z"],
    dash: ["M6 12h12"],
    dot: ["M12 12v.01"],
    shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", "M8.5 12l2.5 2.5 4.5-5"],
    external: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"],
    wallet: ["M4 7h14a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2z", "M4 7V6a2 2 0 012-2h11", "M16 14h.01"],
    file: ["M7 3h7l5 5v13H7z", "M14 3v5h5"],
    chevron: ["M9 6l6 6-6 6"],
    spin: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M12 3a9 9 0 019 9"],
    ring: ["M12 21a9 9 0 100-18 9 9 0 000 18z"],
    undo: ["M9 14L4 9l5-5", "M4 9h10a6 6 0 010 12h-3"],
    ban: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M5.6 5.6l12.8 12.8"],
  };
  function icon(name, cls) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.setAttribute("focusable", "false");
    s.setAttribute("class", "ic" + (cls ? " " + cls : ""));
    (ICONS[name] || ICONS.dot).forEach((d, i) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); if (name === "spin" && i === 0) p.setAttribute("opacity", ".25"); s.appendChild(p); });
    return s;
  }
  const btnIcon = (name, label, cls) => { const b = el("button", "btn icon-btn" + (cls ? " " + cls : "")); b.type = "button"; b.setAttribute("aria-label", label); b.appendChild(icon(name)); return b; };

  // Popover: a trigger plus hidden content. Keyboard (Enter/Space toggles, Esc closes), hover shows, content is read via aria-describedby.
  let popSeq = 0, openPop = null;
  function closePop(focus) { if (openPop) { const o = openPop; openPop = null; o.pop.hidden = true; o.trigger.setAttribute("aria-expanded", "false"); o.pinned = false; if (focus) o.trigger.focus(); } }
  function placePop(o) {
    const r = o.trigger.getBoundingClientRect(), p = o.pop; p.hidden = false;
    const w = p.offsetWidth, h = p.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8)), top = r.bottom + 8;
    if (top + h > vh - 8) top = r.top - h - 8 > 8 ? r.top - h - 8 : Math.max(8, vh - h - 8);
    p.style.left = left + "px"; p.style.top = top + "px";
  }
  function popover(trigger, kids) {
    const w = el("span", "pw"), pop = el("div", "pop"), id = "pop" + (++popSeq);
    pop.id = id; pop.hidden = true; pop.setAttribute("role", "note"); kids.forEach(k => pop.appendChild(typeof k === "string" ? el("p", "", k) : k));
    trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", id); trigger.setAttribute("aria-describedby", id);
    const o = { trigger, pop, pinned: false };
    const show = () => { if (openPop && openPop !== o) closePop(); openPop = o; trigger.setAttribute("aria-expanded", "true"); placePop(o); };
    trigger.addEventListener("click", e => { e.stopPropagation(); if (openPop === o && o.pinned) closePop(); else { show(); o.pinned = true; } });
    trigger.addEventListener("mouseenter", () => { if (!openPop) show(); });
    trigger.addEventListener("mouseleave", () => { if (openPop === o && !o.pinned) closePop(); });
    pop.addEventListener("click", e => e.stopPropagation());
    w.appendChild(trigger); w.appendChild(pop); return w;
  }
  const info = (label, ...kids) => popover(btnIcon("info", label, "info"), kids);
  document.addEventListener("click", () => closePop());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && openPop) { e.stopPropagation(); closePop(true); } }, true);
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; closePop(); } });

  // Evidence block: at most three short lines, parsed with strict regexes (evidence.js). Unknown formats show a neutral line; stub details are never styled as evidence.
  function evidenceNode(verdict, detail, hint) {
    const E = window.Evidence.parseEvidence(verdict, detail);
    const d = el("div", "evd evd-" + E.kind); d.setAttribute("data-evidence", E.kind);
    if (E.kind === "raw") d.appendChild(el("p", "evl", "Detail not in a known format" + (hint ? " (raw text in Details)" : "")));
    else E.lines.forEach(l => d.appendChild(el("p", "evl ev-" + l.k, l.text)));
    return d;
  }
  function txBtn(sig, big) {
    if (typeof sig === "string" && SIG.test(sig)) {
      const a = el("a", big ? "btn primary lnk" : "txl", big ? "View transaction" : "");
      a.href = "https://explorer.solana.com/tx/" + sig + "?cluster=devnet"; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", big ? "settle tx on Solana Explorer (devnet)" : "View transaction"); a.title = "settle tx on Solana Explorer (devnet)"; a.appendChild(icon("external")); return a;
    }
    const s = el("span", "mute", big ? "No link" : "\u2013"); s.title = sig ? "invalid signature, no link" : "no transaction recorded"; return s;
  }
  const PILLS = { reproduced: ["ok", "Reproduced", "check"], not_reproduced: ["forf", "Not reproduced", "x"], inconclusive: ["inc", "Inconclusive", "dash"], error: ["err", "Error", "alert"], busy: ["err", "Error: busy", "alert"], rate_limited: ["err", "Error: rate limited", "alert"], payment_failed: ["err", "Error: payment failed", "alert"] };
  function pill(kind, text, ic) { const p = el("span", "pill p-" + kind); if (ic) p.appendChild(icon(ic)); p.appendChild(document.createTextNode(text)); return p; }
  function verdictPill(v) { const m = PILLS[v]; return m ? pill(m[0], m[1], m[2]) : pill("err", v ? "Unknown verdict" : "No record", "alert"); }
  function skeleton(rows, label) { const d = el("div", "skel"); d.setAttribute("role", "status"); d.setAttribute("aria-busy", "true"); d.setAttribute("aria-label", label || "Loading"); for (let i = 0; i < rows; i++) d.appendChild(el("div", "sk")); return d; }
  function emptyState(ic, text, actionLabel, onAction) {
    const d = el("div", "empty"); d.appendChild(icon(ic)); d.appendChild(el("p", "", text));
    if (actionLabel) { const b = el("button", "btn", actionLabel); b.type = "button"; b.addEventListener("click", onAction); d.appendChild(b); }
    return d;
  }
  function errorBox(text, retry) {
    const b = el("div", "alertbox"); b.setAttribute("role", "alert"); b.appendChild(icon("alert")); b.appendChild(el("span", "", text));
    if (retry) { const r = el("button", "btn", "Retry"); r.type = "button"; r.addEventListener("click", retry); b.appendChild(r); }
    return b;
  }
  function meter(s, compact) {
    const tot = Number(s.budgetAtomic) || 1, pct = a => Math.max(0, Math.min(100, Number(a) / tot * 100));
    const bar = el("div", "meter" + (compact ? " sm" : "")); bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", "spent " + usd(s.spentAtomic) + ", reserved " + usd(s.reservedAtomic) + ", remaining " + usd(s.remainingAtomic) + " of " + usd(s.budgetAtomic));
    [["sp", s.spentAtomic], ["rs", s.reservedAtomic]].forEach(([c, a]) => { const sp = el("span", c); sp.style.width = pct(a) + "%"; bar.appendChild(sp); });
    return bar;
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
      const name = FX.log === "tampered" ? (real ? "log.real.tampered.json" : "log.tampered.json") : FX.log === "empty" ? "log.empty.json" : FX.log === "returned_only" ? (real ? "log.real.returned_only.json" : "log.stub.returned_only.json") : FX.log === "xss" ? "log.xss.json" : real ? "log.real.json" : "log.stub.json";
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
      if (sc === "auto") sc = (FX.mode === "real" ? "real_" : "success_") + (sel.demo && sel.demo.category === "hand_made_fake" ? "forfeited" : "returned");
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
      const file = { success_returned: "sse.success_returned.txt", success_forfeited: "sse.success_forfeited.txt", refused: "sse.refused.txt", settlement_pending: "sse.settlement_pending.txt", error: "sse.error.txt", real_returned: "sse.real_returned.txt", real_forfeited: "sse.real_forfeited.txt", real_inconclusive: "sse.real_inconclusive.txt", real_refused: "sse.real_refused.txt", facts_returned: "sse.facts_returned.txt", facts_forfeited: "sse.facts_forfeited.txt", facts_refused: "sse.facts_refused.txt", xss: "sse.xss.txt", hostile_facts: "hostile.facts.txt", dropped: "sse.dropped.txt", dropped_norecord: "sse.dropped_norecord.txt" }[fxScenario] || "sse.success_returned.txt";
      fetch(FX.base + file).then(r => r.text()).then(t => {
        const evs = parseSse(t); let at = 0;
        evs.forEach(e => { at += e.ev === "checking" ? FX.delay * 2 : FX.delay; timers.push(setTimeout(() => { if (!cancelled) onEvent(e.ev, e.d); }, at)); });
        if (fxScenario === "dropped" || fxScenario === "dropped_norecord") timers.push(setTimeout(() => { if (!cancelled) onLost(); }, at + FX.delay)); // simulated connection drop, no done event
      }).catch(() => onLost());
      stream = { close() { cancelled = true; timers.forEach(clearTimeout); } };
      return;
    }
    const es = new EventSource("/api/jobs/" + encodeURIComponent(jobId) + "/events");
    ["started", "decision", "checking", "verdict", "settled", "error", "done"].forEach(t => es.addEventListener(t, m => {
      // The browser fires a plain Event named "error" when the connection drops; it has no data and must NOT be treated as a server error event (QE-F-001).
      if (t === "error" && !(m && typeof m.data === "string" && m.data)) return;
      let d = {}; try { d = JSON.parse(m.data); } catch (_) { if (t === "error") return; }
      onEvent(t, d);
    }));
    es.onerror = () => { if (es.readyState === 2 || !runDone) { es.close(); onLost(); } };
    stream = { close() { es.close(); } };
  }

  // ---------- state ----------
  let cfg = null, cfgErr = null, logData = null, logErr = null, inboxData = null, inboxErr = null;
  let sel = { demo: null, file: null, fileErr: null };
  let submitMsg = null; // {kind, text}
  let decisions = [];
  let run = null, runDone = false;

  // ---------- top bar and banners ----------
  function renderBanners() {
    const w = $("banners"); w.replaceChildren();
    const tr = $("topr"); tr.replaceChildren();
    if (cfgErr) { w.appendChild(el("div", "bar-msg fail")).appendChild(errorBox("Cannot reach the backend (" + cfgErr + "). Nothing below can be trusted or used until it loads.", loadAll)); return; }
    if (!cfg) return;
    const verifyOk = !!(logData && logData.verify && logData.verify.ok === true);
    const V = (logData && logData.verify) || {};
    // mode pill
    let mp, mtext, mnote = [];
    if (cfg.mode === "stub") {
      mp = ["stub", "Stub", "alert"]; mtext = "Stub mode";
      mnote = ["Verdicts follow the file name; nothing is run. A name starting with real reproduces (bond returned), flaky is inconclusive (bond returned), anything else is not reproduced (bond forfeited). Uploaded names are sanitized and demo inputs map to real_bug_N or fake_N. The money still moves on devnet. Not evidence."];
    } else if (cfg.mode !== "real") { mp = ["err", "Unknown mode", "alert"]; mtext = "Unknown mode"; mnote = ["UNKNOWN RUN MODE (" + cfg.mode + "): do not treat anything here as evidence."]; }
    else if (logData && !verifyOk) { mp = ["err", "Checks failed", "alert"]; mtext = "Checks failed"; mnote = ["The signed log did not verify. Do not trust these results."]; }
    else if (logData) {
      mp = ["ok", "Real", "shield"]; mtext = "Real mode";
      mnote = ["Real verifier. The log re-verification passed (" + V.verified + " of " + V.records + " entries). That covers the log, not whether the verdicts are right: a human triages reproduced reports.", "UNVERIFIED viewer: the real-mode view has only been tested against fixtures until a real run is rendered and compared with RESULTS.md."];
    } else { mp = ["neutral", "Real, unchecked", "alert"]; mtext = "Real mode, log not checked"; mnote = ["The signed log could not be checked (" + (logErr || "not loaded yet") + "). Not labeled as verified real results."]; }
    const mb = el("button", "pillbtn"); mb.type = "button"; mb.setAttribute("aria-label", "Run mode: " + mtext); const mpill = pill(mp[0], mp[1], mp[2]); mpill.classList.add("tp"); mb.appendChild(mpill);
    tr.appendChild(popover(mb, mnote));
    // wallet pill
    const wAddr = typeof cfg.wallet.buyerAddress === "string" ? cfg.wallet.buyerAddress : null, wPay = typeof cfg.wallet.payTo === "string" ? cfg.wallet.payTo : null;
    const wb = el("button", "pillbtn"); wb.type = "button"; wb.setAttribute("aria-label", "Demo wallet " + (wAddr || "not configured"));
    const wp = el("span", "pill p-neutral mono tp"); wp.appendChild(icon("wallet")); wp.appendChild(el("span", "wfull", wAddr ? short(wAddr) : "No wallet")); wp.appendChild(el("span", "wshort", wAddr ? wAddr.slice(0, 4) : "None")); wb.appendChild(wp);
    tr.appendChild(popover(wb, ["Demo wallet pays on your behalf. This is not a third-party sender.", add(el("p", "mono sm"), el("span", "", "payer " + (wAddr || "not configured"))), add(el("p", "mono sm"), el("span", "", "receiver " + (wPay || "not configured")))]));
    // budget meter
    const b = el("div", "budget"); b.title = "Session budget: " + usd(cfg.session.spentAtomic) + " spent, " + usd(cfg.session.reservedAtomic) + " reserved, " + usd(cfg.session.remainingAtomic) + " left of " + usd(cfg.session.budgetAtomic);
    b.appendChild(meter(cfg.session, true)); b.appendChild(el("span", "num", usd(cfg.session.remainingAtomic))); b.appendChild(el("span", "bl", "left")); tr.appendChild(b);
    // bars
    if (cfg.mode === "stub") { const s = el("div", "bar-msg stub banner stub"); s.setAttribute("role", "alert"); s.appendChild(icon("alert", "sm")); s.appendChild(el("span", "", "STUB MODE: not a real sandbox run")); w.appendChild(s); }
    if (cfg.mode !== "stub" && cfg.mode !== "real") w.appendChild(el("div", "bar-msg fail")).appendChild(errorBox("UNKNOWN RUN MODE (" + cfg.mode + "): do not treat anything here as evidence."));
    if (logData && !verifyOk) {
      // Compact bar; the broken line names live in the drawer behind "View".
      const bar = el("div", "bar-msg fail"); bar.setAttribute("role", "alert"); bar.appendChild(icon("alert", "sm"));
      bar.appendChild(el("span", "grow", "CHECKS FAILED: signed log did not verify (" + (V.verified ?? "?") + " of " + (V.records ?? "?") + " entries)"));
      const vb = el("button", "barlink", "View"); vb.type = "button"; vb.setAttribute("aria-haspopup", "dialog"); vb.addEventListener("click", () => openTrust()); bar.appendChild(vb); w.appendChild(bar);
    } else if (cfg.mode === "real" && !logData) {
      const bar = el("div", "bar-msg fail"); bar.setAttribute("role", "alert"); bar.appendChild(icon("alert", "sm")); bar.appendChild(el("span", "", "Real mode, log not checked (" + (logErr || "no log") + ")")); w.appendChild(bar);
    }
  }

  // ---------- Submit ----------
  function quoteInfo() {
    const t = cfg.target, L = cfg.limits, out = [];
    const ul = el("ul", "p");
    ["Bond: " + usdNum(cfg.policy.perReportCapUsd) + " (USDC, Solana devnet), refundable, posted by the demo agent.", "Reproduced or inconclusive: bond returned ($0 settled).", "Not reproduced: bond forfeited (" + usdNum(cfg.policy.perReportCapUsd) + " settled).", "Any error, crash or timeout also settles $0."].forEach(s => ul.appendChild(el("li", "", s)));
    out.push(ul);
    if (cfg.mode === "stub" || !t.caseId) out.push("Target: none in stub mode (no library is run, no commit is pinned). The verdict is chosen by the file name: a name starting with real is reproduced, flaky is inconclusive, any other name is not reproduced.");
    else {
      out.push("Target: libucl, case " + t.caseId + ". Pinned vulnerable commit " + (t.targetCommit || "unknown") + ", fixed control commit " + (t.fixCommit || "unknown") + ".");
      out.push("Caveat: " + t.caveat);
      out.push(add(el("p", "mono sm"), el("span", "", "vulnerable image " + (t.vulImage || "unknown"))));
      out.push(add(el("p", "mono sm"), el("span", "", "fixed image " + (t.fixImage || "unknown"))));
    }
    const lu = el("ul", "p"); L.sandbox.forEach(s => lu.appendChild(el("li", "", s)));
    lu.appendChild(el("li", "", "Verifier hard cap " + L.verifierTimeoutSeconds + " s; input cap " + L.maxInputBytes + " bytes; at most " + L.maxConcurrent + " concurrent runs; one submit per " + L.rateLimitSeconds + " s."));
    out.push(lu);
    out.push("The sandbox is a filter, not a judge, and we do not claim it is escape-proof. In production the verifier runs on the maintainer's infrastructure.");
    out.push("Demo input labels are assigned by hand in demo/manifest.json. They are not measured by the system.");
    return out;
  }
  function renderSubmit() {
    const p = $("panel-submit"); p.replaceChildren();
    if (cfgErr) { p.appendChild(emptyState("alert", "Config not loaded.")); return; }
    if (!cfg) { p.appendChild(skeleton(4)); return; }
    const col = el("div", "col narrow");
    const names = [];
    // drop zone
    const zone = el("label", "drop"); const fi = document.createElement("input"); fi.type = "file"; fi.id = "file-input"; fi.className = "vh"; fi.setAttribute("aria-label", "Choose a proof file");
    const zIcon = icon("upload"); const zMain = el("span", "drop-main"); const zSub = el("span", "drop-sub");
    add(zone, fi, zIcon, zMain, zSub);
    const zErr = el("p", "field-err"); zErr.setAttribute("role", "alert");
    const takeFile = f => {
      if (!f) return;
      if (f.size > cfg.limits.maxInputBytes) sel = { demo: null, file: null, fileErr: "File is " + f.size + " bytes; the limit is " + cfg.limits.maxInputBytes + "." };
      else if (f.size === 0) sel = { demo: null, file: null, fileErr: "File is empty; the server rejects empty bodies." };
      else sel = { demo: null, file: f, fileErr: null };
      submitMsg = null; sync();
    };
    fi.addEventListener("change", () => takeFile(fi.files[0]));
    ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", e => takeFile(e.dataTransfer && e.dataTransfer.files[0]));
    col.appendChild(zone); col.appendChild(zErr);
    // demo chips
    let chips = null;
    if (cfg.demoInputs.length) {
      col.appendChild(el("div", "or", "or"));
      chips = el("div", "chips"); chips.setAttribute("role", "radiogroup"); chips.setAttribute("aria-label", "Demo inputs");
      cfg.demoInputs.forEach(d => {
        const lab = el("label", "chip"); lab.title = d.label;
        const inp = document.createElement("input"); inp.type = "radio"; inp.name = "demo"; inp.value = d.id; inp.setAttribute("aria-label", (d.handMade ? "Hand-made: " : "Real bug: ") + d.label);
        inp.addEventListener("change", () => { sel = { demo: d, file: null, fileErr: null }; submitMsg = null; sync(); });
        lab.appendChild(inp); lab.appendChild(el("span", "chip-n", chipName(d)));
        lab.appendChild(d.handMade ? el("span", "tag", "HAND-MADE") : el("span", "tag real", "REAL"));
        lab._id = d.id; chips.appendChild(lab);
      });
      col.appendChild(chips);
    }
    // quote line + submit
    const q = el("div", "quote"); q.appendChild(el("span", "", usdNum(cfg.policy.perReportCapUsd) + " bond")); q.appendChild(info("Quote, limits and caveats", ...quoteInfo()));
    col.appendChild(q);
    const act = el("div", "actions"); const btn = el("button", "btn primary lg", "Submit"); btn.type = "button"; btn.id = "submit-btn"; btn.addEventListener("click", openConfirm); act.appendChild(btn);
    if (cfg.busy) { const b = pill("inc", "Busy: one job at a time", "dash"); b.setAttribute("role", "status"); act.appendChild(b); }
    col.appendChild(act);
    const msg = el("div", "msgslot"); col.appendChild(msg);
    p.appendChild(col);
    function sync() {
      if (chips) chips.querySelectorAll(".chip").forEach(l => { const on = !!(sel.demo && sel.demo.id === l._id); l.classList.toggle("on", on); l.querySelector("input").checked = on; });
      zone.classList.toggle("has", !!sel.file);
      zMain.textContent = sel.file ? sel.file.name : "Drop a proof file";
      zSub.textContent = sel.file ? (sel.file.size < 1024 ? sel.file.size + " B" : (sel.file.size / 1024).toFixed(1) + " KB") : "";
      zErr.textContent = sel.fileErr || "";
      btn.disabled = !(sel.demo || sel.file) || cfg.busy;
      msg.replaceChildren();
      if (submitMsg) { const m = errorBox(submitMsg.text); if (submitMsg.kind === "busy") m.classList.add("calm"); msg.appendChild(m); }
    }
    sync();
  }
  function openConfirm() {
    $("confirm-amt").textContent = usdNum(cfg.policy.perReportCapUsd);
    const what = sel.demo ? (sel.demo.handMade ? "HAND-MADE: " : "") + chipName(sel.demo) : sel.file.name + " (" + sel.file.size + " bytes)";
    $("confirm-what").textContent = what;
    const wa = typeof cfg.wallet.buyerAddress === "string" ? cfg.wallet.buyerAddress : null; $("confirm-wallet").textContent = wa ? short(wa) : "not configured"; $("confirm-wallet").title = wa || "";
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

  // ---------- Activity (live run + recent) ----------
  const STEPS = [["policy", "Policy"], ["approved", "Approved"], ["signed", "Paid"], ["verdict", "Verdict"], ["settled", "Settled"]];
  function newRun(jobId) { const steps = {}; STEPS.forEach(([k]) => steps[k] = { st: "pending", text: "" }); return { jobId, reportHash: null, steps, notes: [], outcome: null, error: null, lost: false, done: false, events: [], chain: null, verdict: null, verdictDetail: null, facts: {} }; }
  function startRun(jobId) {
    run = newRun(jobId); runDone = false;
    run.baseSeq = logData ? logData.records.reduce((m, r) => Math.max(m, r.seq + 1), 0) : null; // only a record newer than this can belong to this run
    renderRun(); selectTab("run"); $("panel-run").focus({ preventScroll: true });
    const mine = run;
    openStream(jobId, onEvent, () => { if (!runDone && run === mine && !mine.lost) { mine.lost = true; renderRun(); recover(mine); } });
  }
  // After a dropped stream: look for the signed record of THIS proof hash (bounded retries). Never invents an outcome.
  async function recover(r) {
    r.checking = true; renderRun();
    for (let i = 0; i < 12 && run === r; i++) {
      await new Promise(res => setTimeout(res, FIX ? FX.delay : 2500));
      if (run !== r) return;
      try {
        const L = await api("/api/log");
        const rec = r.reportHash && (FIX || r.baseSeq !== null) ? L.records.filter(x => x.reportHash === r.reportHash && (FIX || x.seq >= r.baseSeq)).sort((a, b) => b.seq - a.seq)[0] : null;
        if (rec) {
          const atom = AMT.test(String(rec.settledAtomic)) ? String(rec.settledAtomic) : null;
          const kind = atom === "0" ? "returned" : atom !== null ? "forfeited" : "unknown";
          r.recovered = true; r.checking = false; r.outcome = { kind, atomic: atom, tx: rec.txSignature };
          r.verdictDetail = typeof rec.detail === "string" ? rec.detail : null;
          setVerdictStep(rec.verdict, rec.detail, atom);
          setStep("settled", "done", usd(atom) + " settled (from the signed log)");
          logData = L; logErr = null; renderBanners(); renderResults(); renderOverview(); refreshConfig();
          renderRun(); return;
        }
      } catch (_) { /* keep waiting */ }
    }
    if (run === r) { r.checking = false; r.gaveUp = true; renderRun(); }
  }
  function setVerdictStep(v, detail, atomic) {
    run.verdict = v;
    if (v === "error" || !KNOWN.includes(v)) {
      const m = atomic === "0" ? "error: $0 settled, bond returned" : (atomic === null || atomic === undefined) ? "error: outcome unknown, check the log" : "error: " + usd(atomic) + " settled, check the log";
      setStep("verdict", "err", m + (detail ? " (" + detail + ")" : ""));
    } else setStep("verdict", "done", word(v) + (detail ? ": " + detail : ""));
  }
  function setStep(k, st, text) { run.steps[k] = { st, text }; }
  function onEvent(t, d) {
    if (!run) return;
    run.events.push({ t, d });
    if (t === "started") run.reportHash = d.reportHash;
    else if (t === "decision") {
      decisions.push({ ts: d.ts, action: d.action, detail: d.detail, job: run.jobId }); if (decisions.length > 200) decisions.shift();
      // sub-lines: only the backend's own wording plus the optional, re-validated `facts`; unknown wording or absent facts add nothing
      window.Evidence.factLines(d.action, d.detail, d.facts).forEach(l => { (run.facts[l.step] = run.facts[l.step] || {})[l.slot] = l; });
      if (d.action === "allow") { if (/^allowlist: /.test(d.detail) || run.steps.policy.st !== "done") setStep("policy", "done", "Allowed: " + d.detail); }
      else if (d.action === "refuse") { setStep("policy", "fail", "Refused: " + d.detail); run.refused = true; }
      else if (d.action === "approve") setStep("approved", "done", d.detail);
      else if (d.action === "reject") setStep("approved", "fail", "Not approved: " + d.detail);
      else if (d.action === "sign") setStep("signed", "done", d.detail);
      else if (d.action === "retry") run.notes.push("retry: " + d.detail);
      renderPolicy();
    } else if (t === "checking") run.chain = "active";
    else if (t === "verdict") { run.verdictEv = d; run.verdictDetail = typeof d.detail === "string" ? d.detail : null; setVerdictStep(d.verdict, d.detail, undefined); if (d.verdict === "error") run.steps.verdict.text = "error: settled amount not reported yet" + (d.detail ? " (" + d.detail + ")" : ""); }
    else if (t === "settled") {
      if (run.chain === "active") run.chain = "done";
      setStep("settled", "done", usd(d.settledAtomic) + " settled");
      run.outcome = { kind: d.bondOutcome, atomic: d.settledAtomic, tx: d.txSignature };
      if (run.verdictEv && run.verdictEv.verdict === "error") setVerdictStep("error", run.verdictEv.detail, d.settledAtomic);
    } else if (t === "error") { run.error = { message: d.message, atomic: d.settledAtomic }; if (run.verdictEv && run.verdictEv.verdict === "error") setVerdictStep("error", run.verdictEv.detail, d.settledAtomic); }
    else if (t === "done") { run.done = true; runDone = true; if (stream) stream.close(); refreshConfig(); refreshLog(); inboxData = null; }
    if (t === "done") STEPS.forEach(([k]) => { if (run.steps[k].st === "pending" || run.steps[k].st === "active") run.steps[k] = { st: "skip", text: "not reached" }; });
    renderRun();
  }
  function stepper() {
    const ol = el("ol", "stepper"); ol.setAttribute("aria-label", "Progress");
    const live = !run.done && !run.lost; let prev = true, prevDone = false;
    const lab = { pending: "waiting", active: "in progress", done: "done", fail: "failed", err: "error", skip: "skipped" };
    const ic = { pending: "ring", active: "spin", done: "check", fail: "x", err: "alert", skip: null };
    STEPS.forEach(([k, name], i) => {
      const s = run.steps[k]; let st = s.st;
      if (k === "settled" && run.chain === "active" && st !== "done") st = "active";
      else if (st === "pending" && live && prev) st = "active";
      const li = el("li", "st st-" + st + (i && prevDone ? " link" : "")); li.setAttribute("aria-label", name + ", " + lab[st]); if (st === "active") li.setAttribute("aria-current", "step"); if (s.text) li.title = money(s.text);
      li.appendChild(add(el("span", "node"), ic[st] ? icon(ic[st], st === "active" ? "spin" : "") : null)); li.appendChild(el("span", "nm", name));
      const fl = i < 3 && run.facts[k] ? window.Evidence.SLOT_ORDER.map(sl => run.facts[k][sl]).filter(Boolean) : [];
      fl.forEach(fact => li.appendChild(el("span", "sub" + (fact.ok ? "" : " no"), (fact.ok ? "\u2713 " : "\u2717 ") + fact.text)));
      ol.appendChild(li);
      prevDone = s.st === "done"; if (s.st !== "done") prev = false;
    });
    return ol;
  }
  // Hero amount: a big number plus a short caption. For a returned bond the number is what came back (cap minus settled).
  function amountRow(num, caption) { const d = el("div", "amt"); d.appendChild(el("span", "num", num)); d.appendChild(el("span", "mute", caption)); return d; }
  function settledHero(atomic) { return amountRow(atomic === null || atomic === undefined ? "unknown" : usd(atomic), "settled"); }
  function returnedHero(atomic) { const b = backAtomic(atomic); return b === null ? settledHero(atomic) : amountRow(usd(b), "back to your wallet"); }
  const reasonFor = v => v === "reproduced" ? "Bug reproduced" : v === "not_reproduced" ? "Not reproduced" : v === "inconclusive" ? "Could not decide" : null;
  function refusalTitle(m) { m = String(m || ""); if (/allowlist|endpoint|URL/i.test(m)) return "Not allowed"; if (/per-report cap|above .*cap/i.test(m)) return "Over limit"; if (/budget/i.test(m)) return "Budget used up"; return "Refused"; }
  function outcomeCard() {
    const r = run, card = el("div", "ocard"); card.setAttribute("aria-live", "polite");
    const head = (kind, ic, title, spinner, sub, extra) => {
      const h = el("div", "oh"); h.appendChild(add(el("span", "oi"), icon(spinner ? "spin" : ic, spinner ? "spin" : "")));
      const t = el("div", "ohb"); t.appendChild(el("h2", "ot", title)); if (sub) t.appendChild(el("p", "os", sub)); h.appendChild(t); if (extra) h.appendChild(extra);
      card.className = "ocard o-" + kind; card.appendChild(h);
    };
    const note = t => card.appendChild(el("p", "os", t));
    const acts = el("div", "actions");
    const again = () => { if (r.done) { const b = el("button", "btn", "Submit another"); b.type = "button"; b.addEventListener("click", () => selectTab("submit", true)); acts.appendChild(b); } };
    if (r.refused || r.error) {
      if (r.refused) { head("err", "ban", refusalTitle(r.steps.policy.text || (r.error && r.error.message)), false, "No payment was made."); }
      else {
        head("err", "alert", "Error");
        const ea = r.error && r.error.atomic !== null && r.error.atomic !== undefined ? r.error.atomic : r.outcome ? r.outcome.atomic : null;
        card.appendChild(ea === "0" ? returnedHero(ea) : settledHero(ea));
        if (r.steps.verdict.st === "err") note(money(r.steps.verdict.text));
        else if (r.error.atomic === null || r.error.atomic === undefined) note("Outcome unknown, check the log.");
        else if (r.error.atomic === "0") note("The error path settles $0, bond returned.");
      }
      if (r.outcome && r.outcome.tx) acts.appendChild(txBtn(r.outcome.tx, true));
      again(); card.appendChild(acts); return card;
    }
    if (r.outcome) {
      const o = r.outcome;
      if (r.verdict === "error") {
        head("err", "alert", "Error"); card.appendChild(o.atomic === "0" ? returnedHero(o.atomic) : settledHero(o.atomic)); note(money(r.steps.verdict.text));
      } else {
        const inc = r.verdict === "inconclusive", why = reasonFor(r.verdict);
        if (o.kind === "returned") { head(inc ? "inc" : "ok", inc ? "dash" : "check", "Bond returned", false, why); card.appendChild(returnedHero(o.atomic)); }
        else if (o.kind === "forfeited") { head("forf", "x", "Bond forfeited", false, why); card.appendChild(amountRow(usd(o.atomic), "paid out")); }
        else { head("inc", "alert", "Bond outcome unknown", false, why); card.appendChild(settledHero(o.atomic)); note("Check the chain before assuming either way."); }
      }
      if (KNOWN.includes(r.verdict)) card.appendChild(evidenceNode(r.verdict, r.verdictDetail, true));
      acts.appendChild(txBtn(o.tx, true)); again(); card.appendChild(acts); return card;
    }
    if (r.lost) {
      // One line: spinner while checking, "Lost the live connection" + "Checking the chain". The explanation is in the popover.
      const why = info("About the lost connection", "The live connection dropped. A payment may already have been signed, so the signed record for this report hash decides the outcome. Nothing is assumed either way until it is found.");
      const u = pill("inc", "UNKNOWN", null); u.classList.add("unk");
      head("inc", "alert", r.checking ? "Lost the live connection \u00b7 Checking the chain" : "Lost the live connection", !!r.checking, null, add(el("span", "ohx"), u, why));
      card.setAttribute("role", "alert");
      if (r.gaveUp) note("No signed record yet. Still UNKNOWN: see the Ledger.");
      return card;
    }
    if (r.chain === "active") { head("chk", "spin", "Checking the chain", true); note("Not a failure. Settlement is being confirmed."); return card; }
    if (r.done) { head("inc", "alert", "No settlement seen"); note("Check the Ledger."); again(); card.appendChild(acts); return card; }
    card.className = "ocard o-wait"; card.appendChild(skeleton(3, "Waiting for events")); return card;
  }
  function evLine(e) {
    const d = e.d || {};
    if (e.t === "decision") return "decision " + d.action + ": " + money(d.detail);
    if (e.t === "verdict") return "verdict " + d.verdict + (d.detail ? ": " + money(d.detail) : "");
    if (e.t === "settled") return "settled " + usd(d.settledAtomic) + (d.bondOutcome ? " (" + d.bondOutcome + ")" : "");
    if (e.t === "error") return "error: " + money(d.message);
    return e.t;
  }
  function renderRun() {
    const p = $("panel-run"); p.replaceChildren();
    const col = el("div", "col");
    if (!run) col.appendChild(emptyState("activity", "No active run", "Submit a proof", () => selectTab("submit", true)));
    else {
      col.appendChild(stepper()); col.appendChild(outcomeCard());
      const d = el("details", "disc"); d.appendChild(el("summary", "", "Details"));
      const dl = el("dl", "kv"); const kv = (k, v, mono) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", mono ? "mono" : "", v)); };
      kv("Job", run.jobId, true); if (run.error) kv("Message", money(run.error.message)); kv("Report hash", run.reportHash || "not yet known", true);
      STEPS.forEach(([k, n]) => { if (run.steps[k].text) kv(n, money(run.steps[k].text)); });
      if (run.outcome && run.verdict !== "error") kv("Outcome", run.outcome.kind === "returned" ? "The sandbox settled no money; the escrowed bond goes back to the demo wallet." : run.outcome.kind === "forfeited" ? usd(run.outcome.atomic) + " was settled to the receiver wallet (a transfer between our own demo wallets)." : "Settled amount reported: " + usd(run.outcome.atomic) + ". Do not assume either way until the chain confirms.");
      if (run.outcome) kv("Explorer", "One link only: the log records the settle tx, not the deposit tx.");
      if (run.recovered) kv("Source", "Outcome read back from the signed verdict log.");
      run.notes.forEach(n => kv("Note", money(n)));
      d.appendChild(dl);
      const ev = el("div", "evs"); run.events.forEach(e => ev.appendChild(el("div", "mono sm", evLine(e)))); d.appendChild(ev);
      col.appendChild(d);
    }
    if (logData && logData.records.length) {
      const rec = logData.records.slice().sort((a, b) => b.seq - a.seq).slice(0, 3);
      const sec = el("section", "recent"); sec.appendChild(el("h2", "sec", "Recent"));
      rec.forEach(r => {
        const b = el("button", "rrow"); b.type = "button"; b.title = r.label || "Unlabeled submission"; b.addEventListener("click", () => selectTab("results", true));
        b.appendChild(el("span", "rn", rowName(r))); b.appendChild(verdictPill(r.verdict)); b.appendChild(el("span", "num", r.settledAtomic === null ? "none" : usd(r.settledAtomic))); sec.appendChild(b);
      });
      col.appendChild(sec);
    }
    p.appendChild(col);
  }

  // Counters shared by Overview and Ledger. The stub n/a rule for "wrongly forfeited" lives in the Not reproduced info popover.
  function tilesNode(recs, L) {
    const c = { reproduced: 0, forfeited: 0, inconclusive: 0, errors: 0, wrong: 0 };
    const errRows = [];
    recs.forEach(r => {
      if (r.verdict === "reproduced") c.reproduced++; else if (r.verdict === "not_reproduced") { c.forfeited++; if (r.category === "real_bug") c.wrong++; }
      else if (r.verdict === "inconclusive") c.inconclusive++; else { c.errors++; errRows.push(r); }
    });
    const g = el("div", "tiles");
    const tile = (n, l, kind, extra, title) => { const d = el("div", "tile t-" + kind); const h = el("div", "tl"); h.appendChild(el("span", "dotk")); h.appendChild(el("span", "l", l)); if (extra) h.appendChild(extra); d.appendChild(h); d.appendChild(el("div", "n num" + (n === 0 ? " zero" : ""), n)); if (title) d.title = title; g.appendChild(d); };
    tile(c.reproduced, "Reproduced", "ok");
    const wrongNote = L.mode === "stub"
      ? ["Wrongly forfeited: n/a, not meaningful in stub mode: stub verdicts follow the filename."]
      : ["Wrongly forfeited: " + c.wrong + ". Hand-labeled real bugs that were forfeited.", "\"Real bug\" and \"hand-made fake\" labels, and so this count, are assigned by hand in demo/manifest.json by proof hash. The system does not measure them and they are not in the signed log. Entries with no label were submitted outside the demo set."];
    tile(c.forfeited, "Not reproduced", "forf", info("Wrongly forfeited", ...wrongNote));
    tile(c.inconclusive, "Inconclusive", "inc");
    tile(c.errors, "Error", "err", null, errRows.length ? "Error settlements: " + errRows.map(r => usd(r.settledAtomic)).join(", ") + " (expected $0)" : "");
    return g;
  }
  const LABEL_NOTE = "Label assigned by hand in demo/manifest.json by proof hash; not measured by the system.";
  function labelTag(r) {
    let tg = null; if (r.category === "hand_made_fake") tg = el("span", "tag", "HAND-MADE"); else if (r.category === "real_bug") tg = el("span", "tag", "REAL");
    if (tg) tg.title = LABEL_NOTE; return tg;
  }

  // ---------- Overview ----------
  const newest = list => list.slice().sort((a, b) => b.seq - a.seq)[0] || null;
  function ovCard(r, kind) {
    const cap = capAtomic(), returned = kind === "returned";
    const card = el("article", "ocard ovc " + (!returned ? "o-forf" : r.verdict === "inconclusive" ? "o-inc" : "o-ok")); card.setAttribute("data-kind", kind);
    const h = el("div", "ovh"); const nm = el("span", "ovl", rowName(r)); nm.title = r.label || "Unlabeled submission"; h.appendChild(nm);
    const tg = labelTag(r); if (tg) h.appendChild(tg); h.appendChild(verdictPill(r.verdict)); card.appendChild(h);
    const amt = returned ? backAtomic(r.settledAtomic) : r.settledAtomic;
    card.appendChild(el("div", "num ovamt", amt === null || amt === undefined ? "unknown" : usd(amt)));
    card.appendChild(el("p", "ovflow", (cap === null ? "Bond" : usd(cap)) + " locked \u2192 " + (returned ? "returned to you" : "paid out")));
    card.appendChild(evidenceNode(r.verdict, r.detail, false));
    const tx = txBtn(r.txSignature, true); tx.classList.remove("primary"); card.appendChild(tx);
    return card;
  }
  function renderOverview() {
    const p = $("panel-overview"); p.replaceChildren();
    if (logErr) { p.appendChild(errorBox("Could not load the log: " + logErr, loadLog)); return; }
    if (!logData) { p.appendChild(skeleton(3)); return; }
    const L = logData, recs = L.records;
    const col = el("div", "col");
    if (!recs.length) {
      const e = el("div", "ovempty"); const b = el("button", "btn primary lg", "Submit a proof"); b.type = "button"; b.addEventListener("click", () => selectTab("submit", true)); e.appendChild(b); col.appendChild(e); p.appendChild(col); return;
    }
    col.appendChild(el("p", "ovloop", "Submit, lock, verify, settle, record"));
    const good = recs.filter(r => r.sigOk === true && r.settlementStatus === "settled" && AMT.test(String(r.settledAtomic)));
    const ret = newest(good.filter(r => (r.verdict === "reproduced" || r.verdict === "inconclusive") && String(r.settledAtomic) === "0"));
    const forf = newest(good.filter(r => r.verdict === "not_reproduced" && String(r.settledAtomic) !== "0"));
    const none = t => { const d = el("div", "ocard ovc none", t); return d; };
    const g = el("div", "ovg"); g.appendChild(ret ? ovCard(ret, "returned") : none("No returned run yet")); g.appendChild(forf ? ovCard(forf, "forfeited") : none("No forfeited run yet")); col.appendChild(g);
    col.appendChild(tilesNode(recs, L));
    const top = el("div", "ltop"); top.appendChild(trustBadge(L.verify)); col.appendChild(top);
    p.appendChild(col);
  }

  // ---------- Ledger ----------
  function trustBadge(V, id) {
    const b = el("button", "trustbtn"); b.type = "button"; if (id) b.id = id; b.setAttribute("aria-haspopup", "dialog");
    let cls, ic, text;
    if (!V.ok) { cls = "bad"; ic = "alert"; const lines = (V.problems || []).map(p => p.line); text = lines.length ? "Line " + lines.slice(0, 3).join(", ") + (lines.length > 3 ? " +" + (lines.length - 3) : "") + " broken" : V.verified + " of " + V.records + " verified"; }
    else if (!V.records) { cls = "neutral"; ic = "shield"; text = "No entries to verify yet"; }
    else { cls = "ok"; ic = "shield"; text = V.verified + " of " + V.records + " verified"; }
    b.className = "trustbtn t-" + cls; b.appendChild(icon(ic)); b.appendChild(el("span", "", text)); b.appendChild(icon("chevron", "sm"));
    b.addEventListener("click", () => openTrust());
    return b;
  }
  function openTrust() {
    const L = logData; if (!L) return;
    const V = L.verify, body = $("trust-body"); body.replaceChildren();
    if (!V.ok) {
      const bx = el("div", "alertbox"); bx.setAttribute("role", "alert"); bx.appendChild(icon("alert"));
      const t = el("div", "grow"); t.appendChild(el("div", "", "BROKEN ENTRIES: " + (V.records - V.verified) + " of " + V.records + " did not verify."));
      const ul = el("ul", "list"); V.problems.forEach(pr => ul.appendChild(el("li", "", "BROKEN log line " + pr.line + ": " + pr.message))); t.appendChild(ul); bx.appendChild(t); body.appendChild(bx);
    }
    const dl = el("dl", "kv"); const kv = (k, v, mono) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", mono ? "mono" : "", v)); };
    kv("Verified", V.records ? V.verified + " of " + V.records + " log entries" : "No entries to verify yet");
    kv("Signer key (pinned)", L.signer, true);
    kv("Log head", L.head ? "seq " + L.head.seq + ", sha256(last line) " + L.head.hash : "none (empty log)", true);
    kv("Mode", L.mode); kv("Network", "Solana devnet; cap " + (cfg ? usdNum(cfg.policy.perReportCapUsd) : "unknown") + " per report");
    body.appendChild(dl);
    const ul = el("ul", "p");
    ["Tail truncation is undetectable from the log alone: dropping the last N records leaves a valid chain. Publish the head hash and seq elsewhere to make it detectable.",
      "Records are signed by the server, so they are not independent proof that the server told the truth.",
      "Both wallets belong to the demo operator; a forfeit here is a transfer between our own wallets.",
      "The log stores one transaction signature per report, the settle tx. The deposit (escrow open) tx is not recorded, so each report has at most one link.",
      "The sandbox is a filter, not a judge. Not reproduced only means this pinned build ran the input clean.",
      "REAL and HAND-MADE labels are assigned by hand in demo/manifest.json by proof hash. They are not measured by the system and are not in the signed log. Entries with no label were submitted outside the demo set.",
      "This does not prove that spam is stopped. The demo set is small and hand-picked."].forEach(s => ul.appendChild(el("li", "", s)));
    ["flaky_or_timeout", "crash_on_both"].forEach(k => ul.appendChild(el("li", "", k + ": NOT demonstrated. The backtest found no genuine example and we do not fake one.")));
    ul.appendChild(el("li", "", "libucl/ARVO caveat: the fixed image is a later libucl version, not the per-bug fix commit; reproduced means the input triggers the expected ASan error on the pinned vulnerable build and the crash is gone in a later libucl."));
    if (cfg && cfg.mode === "stub") ul.appendChild(el("li", "", "Stub mode: everything about the real verifier, Docker and ASan is unexercised."));
    body.appendChild(el("h3", "sec", "Caveats")); body.appendChild(ul);
    const dlg = $("trust"); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  function renderResults() {
    const p = $("panel-results"); p.replaceChildren();
    if (logErr) { p.appendChild(errorBox("Could not load the log: " + logErr, loadLog)); return; }
    if (!logData) { p.appendChild(skeleton(5)); return; }
    const L = logData, V = L.verify, recs = L.records.slice().sort((a, b) => b.seq - a.seq);
    const col = el("div", "col");
    const top = el("div", "ltop"); top.appendChild(trustBadge(V, "trust-btn")); col.appendChild(top);
    const g = tilesNode(recs, L);
    col.appendChild(g);
    if (!recs.length) { col.appendChild(emptyState("ledger", "No reports yet.", "Submit a proof", () => selectTab("submit", true))); p.appendChild(col); return; }
    const narrow = window.matchMedia("(max-width:640px)").matches;
    const wrap = el("div", "tablewrap"); const tb = el("table", "tbl");
    const hr = el("tr"); const th = (t, cls, lab) => { const h = el("th", cls || "", t); if (lab) h.setAttribute("aria-label", lab); hr.appendChild(h); };
    th("Label"); th("Status"); th("Paid", "r"); if (!narrow) th("", "txc", "Transaction");
    const hd = el("thead"); hd.appendChild(hr); tb.appendChild(hd);
    const body = el("tbody");
    recs.forEach(r => {
      const bad = r.sigOk !== true;
      const tr = el("tr", bad ? "broken" : "");
      const c1 = el("td", "lab"); const eb = el("button", "exp"); eb.type = "button"; eb.setAttribute("aria-expanded", "false"); eb.title = r.label || "Unlabeled submission";
      eb.appendChild(icon("chevron", "sm")); eb.appendChild(el("span", "ln", rowName(r)));
      const tg = labelTag(r); if (tg) eb.appendChild(tg);
      c1.appendChild(eb); tr.appendChild(c1);
      const c2 = el("td"); c2.appendChild(bad ? pill("err", "Not verified", "alert") : verdictPill(r.verdict)); if (r.settlementStatus === "pending") c2.appendChild(el("span", "mute sm", " Checking the chain")); tr.appendChild(c2);
      tr.appendChild(el("td", "r num", r.settledAtomic === null ? "none" : usd(r.settledAtomic)));
      const tx = txBtn(r.txSignature, false);
      if (!narrow) { const c4 = el("td", "txc"); c4.appendChild(tx); tr.appendChild(c4); }
      body.appendChild(tr);
      const dr = el("tr", "drow"); dr.hidden = true; const dc = el("td"); dc.colSpan = narrow ? 3 : 4;
      const dl = el("dl", "kv"); const kv = (k, v) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "mono", v)); };
      kv("Detail", r.detail ?? "-"); kv("Report hash", r.reportHash); kv("Time", when(r.timestamp)); kv("Status", r.settlementStatus === "pending" ? "checking the chain" : String(r.settlementStatus)); kv("Log record", "seq " + r.seq + (bad ? " (NOT VERIFIED)" : " (signature ok)"));
      if (tg) kv("Label", (r.category === "hand_made_fake" ? "HAND-MADE. " : "REAL. ") + LABEL_NOTE);
      if (narrow) { dl.appendChild(el("dt", "", "Transaction")); const dd = el("dd"); dd.appendChild(tx); dl.appendChild(dd); }
      if (bad) dc.appendChild(errorBox("This record's signature did not verify. Do not trust it."));
      else if (KNOWN.includes(r.verdict)) dc.appendChild(evidenceNode(r.verdict, r.detail, false));
      dc.appendChild(dl); dr.appendChild(dc); body.appendChild(dr);
      eb.addEventListener("click", () => { const o = dr.hidden; dr.hidden = !o; eb.setAttribute("aria-expanded", String(o)); tr.classList.toggle("open", o); });
    });
    tb.appendChild(body); wrap.appendChild(tb); col.appendChild(wrap); p.appendChild(col);
  }

  window.matchMedia("(max-width:640px)").addEventListener("change", () => { if (logData) renderResults(); });
  // ---------- Inbox ----------
  // Click-to-copy. textContent only; the clipboard API may be missing or blocked, so fall back to a hidden textarea and never throw.
  async function copyText(text, btn) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
      try { const t = document.createElement("textarea"); t.value = text; t.setAttribute("readonly", ""); t.className = "vh"; document.body.appendChild(t); t.select(); ok = document.execCommand("copy"); t.remove(); } catch (_2) { ok = false; }
    }
    const old = btn.dataset.t || btn.textContent; btn.dataset.t = old; btn.textContent = ok ? "Copied" : "Copy failed";
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
  function renderInbox() {
    const p = $("panel-inbox"); p.replaceChildren();
    if (inboxErr) { p.appendChild(errorBox("Could not load the inbox: " + inboxErr, loadInbox)); return; }
    if (!inboxData) { p.appendChild(skeleton(4)); return; }
    const items = inboxData.items;
    if (!items.length) { p.appendChild(emptyState("inbox", "Nothing to triage.", "Submit a proof", () => selectTab("submit", true))); return; }
    const col = el("div", "col");
    const NOTE = { valid: "Valid", not_a_bug: "Not a bug", misuse: "Misuse" };
    items.forEach(it => {
      const card = el("article", "item");
      const r1 = el("div", "i1"); r1.appendChild(verdictPill(it.verdict));
      r1.appendChild(el("h3", "ih", it.errorType ? it.errorType + (it.topFrame ? " at " + it.topFrame : "") : it.topFrame ? "Top frame: " + it.topFrame : "Needs a look")); card.appendChild(r1);
      if (KNOWN.includes(it.verdict)) card.appendChild(evidenceNode(it.verdict, it.detail, true));
      const r2 = el("div", "i2"); const hs = el("button", "hashbtn mono sm", short(it.reportHash, 8, 4)); hs.type = "button"; hs.title = "Copy proof hash"; hs.setAttribute("aria-label", "Copy proof hash " + it.reportHash);
      hs.addEventListener("click", () => copyText(it.reportHash, hs)); r2.appendChild(hs);
      const cur = it.note && NOTE[it.note.decision] ? it.note.decision : null;
      const seg = el("div", "seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Triage note, no payout"); seg.title = "Notes only, no payout";
      const ta = document.createElement("input"); ta.type = "text"; ta.className = "note-in"; ta.maxLength = 500; ta.placeholder = "Optional note"; ta.setAttribute("aria-label", "Triage note text"); ta.value = it.note && it.note.text ? it.note.text : "";
      const msg = el("span", "sm err-t", "");
      Object.entries(NOTE).forEach(([d, l]) => {
        const b = el("button", "segb" + (cur === d ? " on" : ""), l); b.type = "button"; b.setAttribute("aria-pressed", String(cur === d));
        b.addEventListener("click", async () => {
          const dec = cur === d ? "unreviewed" : d;
          try { await postNote({ reportHash: it.reportHash, decision: dec, text: ta.value.slice(0, 500) }); it.note = dec === "unreviewed" ? null : { decision: d, text: ta.value.slice(0, 500), ts: new Date().toISOString() }; renderInbox(); }
          catch (e) { msg.textContent = "Note not saved: " + e.message; }
        });
        seg.appendChild(b);
      });
      const sw = el("div", "segwrap"); const tn = el("span", "tt mute"); tn.tabIndex = 0; tn.title = "Triage notes only, no payout. Nothing here moves money: the verdict already decided the settlement."; tn.setAttribute("aria-label", tn.title); tn.appendChild(icon("file")); sw.appendChild(tn); sw.appendChild(seg); r2.appendChild(sw); card.appendChild(r2);
      const d = el("details", "disc"); d.appendChild(el("summary", "", "Details"));
      const dl = el("dl", "kv"); const kv = (k, v) => { dl.appendChild(el("dt", "", k)); dl.appendChild(el("dd", "mono", v)); };
      kv("Proof hash", it.reportHash); kv("Case", (it.caseId || "-") + " / " + (it.targetCommit || "-")); kv("Time", when(it.timestamp)); kv("Log detail", it.detail);
      if (it.note) kv("Note", NOTE[it.note.decision] + (it.note.text ? " - " + it.note.text : "") + " (" + when(it.note.ts) + ")");
      d.appendChild(dl); const nr = el("div", "noterow"); nr.appendChild(ta); nr.appendChild(msg); d.appendChild(nr); card.appendChild(d);
      col.appendChild(card);
    });
    p.appendChild(col);
  }

  // ---------- Agent ----------
  function renderPolicy() {
    const p = $("panel-policy"); p.replaceChildren();
    if (cfgErr) { p.appendChild(errorBox("Config not loaded: " + cfgErr, loadAll)); return; }
    if (!cfg) { p.appendChild(skeleton(4)); return; }
    const po = cfg.policy, s = cfg.session;
    const grid = el("div", "grid2");
    const card = (title, x) => { const c = el("section", "acard"); const h = el("div", "ach"); h.appendChild(el("h2", "sec", title)); if (x) h.appendChild(x); c.appendChild(h); grid.appendChild(c); return c; };
    const lim = card("Limits");
    const dl = el("dl", "kv"); const kv = (k, v, tip) => { const dt = el("dt", "", k); if (tip) dt.title = tip; dl.appendChild(dt); const dd = el("dd", "num"); if (v instanceof Node) dd.appendChild(v); else dd.textContent = v; dl.appendChild(dd); };
    kv("Per report", usdNum(po.perReportCapUsd)); kv("Session", usdNum(po.sessionBudgetUsd));
    kv("Ask me above", usdNum(po.approvalThresholdUsd), "Enforced in agent code. Human approval above " + usdNum(po.approvalThresholdUsd) + ": the confirm dialog is that approval.");
    let host = null; try { host = new URL(po.allowedUrl).host; } catch (_) { host = null; }
    const chip = el("span", "hostchip mono", host || String(po.allowedUrl)); chip.title = String(po.allowedUrl); chip.tabIndex = 0;
    kv("Allowed", chip, "Allowlisted endpoint: " + po.allowedUrl);
    lim.appendChild(dl);
    const bud = card("Budget"); bud.appendChild(meter(s));
    const lg = el("div", "legend");
    [["sp", "Spent", s.spentAtomic], ["rs", "Reserved", s.reservedAtomic], ["rm", "Left", s.remainingAtomic]].forEach(([c, l, a]) => { const i = el("span", "lg"); i.appendChild(el("span", "sw " + c)); i.appendChild(document.createTextNode(l + " ")); i.appendChild(el("span", "num", usd(a))); lg.appendChild(i); });
    bud.appendChild(lg);
    p.appendChild(grid);
    if (!decisions.length) { const e = el("p", "mute dec-empty", "No decisions yet"); e.title = "Decisions seen in this browser session only (the backend has no history endpoint)."; p.appendChild(e); }
    else {
      const ds = el("section", "acard wide"); const h = el("div", "ach"); const ht = el("h2", "sec", "Decisions"); ht.title = "Decisions seen in this browser session only (the backend has no history endpoint)."; h.appendChild(ht); h.appendChild(el("span", "mute sm", "this session")); ds.appendChild(h);
      const ol = el("ol", "tl-list");
      decisions.slice().reverse().forEach(x => { const li = el("li", "ev ev-" + x.action); li.appendChild(el("span", "mono sm t", when(x.ts))); li.appendChild(el("span", "act", x.action)); li.appendChild(el("span", "dt2", money(x.detail))); ol.appendChild(li); });
      ds.appendChild(ol); const w = el("div", "agrid1"); w.appendChild(ds); p.appendChild(w);
    }
  }

  // ---------- tabs ----------
  const TABS = ["overview", "submit", "run", "results", "inbox", "policy"];
  const TABDEF = [["overview", "Overview", "home"], ["submit", "Submit", "upload"], ["run", "Activity", "activity"], ["results", "Ledger", "ledger"], ["inbox", "Inbox", "inbox"], ["policy", "Agent", "agent"]];
  TABDEF.forEach(([id, label, ic], i) => {
    const b = el("button", "tab"); b.type = "button"; b.id = "tab-" + id; b.setAttribute("role", "tab"); b.setAttribute("aria-controls", "panel-" + id); b.setAttribute("aria-selected", String(id === "overview")); b.tabIndex = id === "overview" ? 0 : -1;
    b.appendChild(icon(ic)); b.appendChild(el("span", "", label)); $("tabs").appendChild(b);
  });
  let userTabbed = false; // false until the person (or ?tab=) picks a tab; only then does the default stay put
  function selectTab(name, focus, auto) {
    closePop(); if (!auto) userTabbed = true;
    TABS.forEach(t => { const on = t === name; const b = $("tab-" + t); b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; $("panel-" + t).hidden = !on; });
    if (focus === true) $("tab-" + name).focus();
    window.scrollTo(0, 0);
    if (auto) return;
    if (name === "results" || name === "overview") loadLog(); else if (name === "inbox") loadInbox(); else if (name === "policy") refreshConfig();
  }
  $("tabs").addEventListener("click", e => { const t = e.target.closest("[role=tab]"); if (t) selectTab(t.id.slice(4)); });
  $("tabs").addEventListener("keydown", e => {
    const i = TABS.findIndex(t => $("tab-" + t) === document.activeElement); if (i < 0) return;
    let n = null; if (e.key === "ArrowRight") n = (i + 1) % TABS.length; else if (e.key === "ArrowLeft") n = (i + TABS.length - 1) % TABS.length; else if (e.key === "Home") n = 0; else if (e.key === "End") n = TABS.length - 1;
    if (n !== null) { e.preventDefault(); selectTab(TABS[n], true); }
  });

  // ---------- loading ----------
  async function loadConfig() { try { cfg = await api("/api/config"); cfgErr = null; } catch (e) { cfgErr = e.message; } }
  async function refreshConfig() { await loadConfig(); renderBanners(); renderSubmit(); renderPolicy(); renderOverview(); }
  async function loadLog() { try { logData = await api("/api/log"); logErr = null; } catch (e) { logErr = e.message; logData = null; } renderBanners(); renderOverview(); renderResults(); renderRun(); }
  async function refreshLog() { return loadLog(); }
  async function loadInbox() { try { inboxData = await api("/api/inbox"); inboxErr = null; } catch (e) { inboxErr = e.message; } renderInbox(); }
  async function loadAll() {
    renderBanners(); await loadConfig(); renderBanners(); renderSubmit(); renderPolicy(); await Promise.all([loadLog(), loadInbox()]);
    // Default screen: Overview when the log has at least one record, otherwise Submit. Never overrides a choice the person already made.
    if (!userTabbed && !run) selectTab(logData && logData.records.length ? "overview" : "submit", false, true);
  }

  // dialogs
  $("confirm-info").textContent = "Returned if reproduced or inconclusive. Forfeited if not.";
  $("confirm-cancel").addEventListener("click", () => $("confirm").close());
  $("confirm-ok").addEventListener("click", () => { $("confirm").close(); doSubmit(); });
  $("confirm").addEventListener("click", e => { if (e.target === $("confirm")) $("confirm").close(); });
  $("trust-close").appendChild(icon("x"));
  $("trust-close").addEventListener("click", () => $("trust").close());
  $("trust").addEventListener("click", e => { if (e.target === $("trust")) $("trust").close(); });

  if (FIX) {
    const fb = $("fixbar"); fb.hidden = false;
    fb.appendChild(el("strong", "", "FIXTURE MODE")); fb.appendChild(document.createTextNode(" no backend. "));
    const d = el("details"); d.appendChild(el("summary", "", "Params"));
    d.appendChild(el("p", "mono sm", "mode=stub|real, log=ok|tampered|empty|xss|error, inbox=ok|empty|xss, xss=1, busy=1, scenario=success_returned|success_forfeited|refused|settlement_pending|error|xss|busy|budget_exhausted|rate_limited|too_large|dropped|dropped_norecord, delay=ms. Current: mode=" + FX.mode + ", scenario=" + FX.scenario + "."));
    fb.appendChild(d);
  }
  renderOverview(); renderSubmit(); renderRun(); renderResults(); renderInbox(); renderPolicy();
  const startTab = Q.get("tab"); if (TABS.includes(startTab)) selectTab(startTab);
  loadAll().then(() => { if (FIX && Q.get("autorun") !== null && cfg) { const i = Number(Q.get("autorun") || 0); sel = { demo: cfg.demoInputs[i], file: null, fileErr: null }; renderSubmit(); doSubmit(); } });
  window.__app = FIX ? { selectTab, getState: () => ({ cfg, logData, run }), pick(i) { sel = { demo: cfg.demoInputs[i], file: null, fileErr: null }; renderSubmit(); }, doSubmit } : undefined;
})();
