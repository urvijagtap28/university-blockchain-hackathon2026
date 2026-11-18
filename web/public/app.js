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
  const HASH64 = /^[0-9a-f]{64}$/;
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
  // QE-W2-007: bounded, no quadratic regex: clip first, cut at the first "(" or "," with indexOf.
  const rowName = r => {
    if (!r.label) return "Unlabeled";
    let t = String(r.label).slice(0, 300).replace(/^HAND-MADE[^:]*:\s*/i, "");
    const a = t.indexOf("("), b = t.indexOf(","), i = a < 0 ? b : b < 0 ? a : Math.min(a, b);
    return i >= 0 ? t.slice(0, i).trimEnd() : t;
  };

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
      if (!fxInbox) fxInbox = await fx(FX.inbox === "empty" ? "inbox.empty.json" : FX.inbox === "unverified" ? "inbox.unverified.json" : FX.inbox === "xss" || FX.xss ? "inbox.xss.json" : "inbox." + FX.mode + ".json");
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
  let cfg = null, cfgErr = null, logData = null, logErr = null;
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
  const logRecFor = d => logData ? logData.records.filter(r => r.label === d.label && r.sigOk === true).sort((a, b) => b.seq - a.seq)[0] || null : null;
  const paneHead = (title, ...kids) => { const h = el("div", "pane-h"); h.appendChild(el("h2", "sec", title)); kids.forEach(k => k && h.appendChild(k)); return h; };
  function renderSubmit() {
    const p = $("panel-submit"); p.replaceChildren();
    if (cfgErr) { p.appendChild(emptyState("alert", "Config not loaded.")); return; }
    if (!cfg) { p.appendChild(skeleton(4)); return; }
    const busy = cfg.busy || !!(run && !run.done && !run.lost) || !!queue;
    const all = el("button", "btn primary sm", queue ? "Running…" : "Run all " + cfg.demoInputs.length); all.type = "button"; all.id = "run-all"; all.disabled = busy || !cfg.demoInputs.length;
    all.addEventListener("click", () => { sel = { demo: null, file: null, fileErr: null }; pendingQueue = cfg.demoInputs.slice(); openConfirm(); });
    p.appendChild(paneHead("Reports", info("Quote, limits and caveats", ...quoteInfo()), all));
    const list = el("ul", "reps"); list.setAttribute("aria-label", "Demo inputs");
    const row = (name, tag, stateNode, onRun, live) => {
      const li = el("li", "rep" + (live ? " live" : "")); const t = el("div", "rep-t"); t.appendChild(el("span", "rep-n", name)); if (tag) t.appendChild(tag); li.appendChild(t);
      li.appendChild(stateNode);
      const b = el("button", "btn sm", "Run"); b.type = "button"; b.disabled = busy; b.setAttribute("aria-label", "Run " + name); b.addEventListener("click", onRun); li.appendChild(b); list.appendChild(li);
    };
    cfg.demoInputs.forEach(d => {
      const rec = logRecFor(d), live = !!(run && run.demoId === d.id && !run.done);
      const st = el("div", "rep-s");
      if (live) st.appendChild(pill("chk", "Running", "spin")); else if (rec) { st.appendChild(verdictPill(rec.verdict)); st.appendChild(el("span", "num mute", rec.settledAtomic === null ? "" : String(rec.settledAtomic) === "0" ? "bond back" : "-" + usd(rec.settledAtomic))); } else st.appendChild(el("span", "mute", "not run yet"));
      if (live) st.firstChild.querySelector(".ic").classList.add("spin");
      row(chipName(d), d.handMade ? el("span", "tag", "HAND-MADE") : el("span", "tag real", "REAL"), st, () => { sel = { demo: d, file: null, fileErr: null }; pendingQueue = null; openConfirm(); }, live);
    });
    if (sel.file) row(sel.file.name, el("span", "tag", "YOURS"), el("div", "rep-s mute", sel.file.size < 1024 ? sel.file.size + " B" : (sel.file.size / 1024).toFixed(1) + " KB"), () => { pendingQueue = null; openConfirm(); }, false);
    p.appendChild(list);
    const zone = el("label", "drop sm"); const fi = document.createElement("input"); fi.type = "file"; fi.id = "file-input"; fi.className = "vh"; fi.setAttribute("aria-label", "Choose a proof file");
    const zMain = el("span", "drop-main", "Drop your own proof file"); add(zone, fi, icon("upload"), zMain);
    const zErr = el("p", "field-err"); zErr.setAttribute("role", "alert"); zErr.textContent = sel.fileErr || "";
    const takeFile = f => {
      if (!f) return;
      if (f.size > cfg.limits.maxInputBytes) sel = { demo: null, file: null, fileErr: "File is " + f.size + " bytes; the limit is " + cfg.limits.maxInputBytes + "." };
      else if (f.size === 0) sel = { demo: null, file: null, fileErr: "File is empty; the server rejects empty bodies." };
      else sel = { demo: null, file: f, fileErr: null };
      submitMsg = null; renderSubmit();
    };
    fi.addEventListener("change", () => takeFile(fi.files[0]));
    ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("over"); }));
    zone.addEventListener("drop", e => takeFile(e.dataTransfer && e.dataTransfer.files[0]));
    const foot = el("div", "pane-f"); foot.appendChild(zone); foot.appendChild(zErr);
    if (submitMsg) { const m = errorBox(submitMsg.text); if (submitMsg.kind === "busy") m.classList.add("calm"); foot.appendChild(m); }
    p.appendChild(foot);
  }
  function openConfirm() {
    const cap = usdNum(cfg.policy.perReportCapUsd);
    $("confirm-amt").textContent = cap + (pendingQueue ? " each" : "");
    const what = pendingQueue ? pendingQueue.length + " demo inputs, one after another (REAL and HAND-MADE)" : sel.demo ? (sel.demo.handMade ? "HAND-MADE: " : "") + chipName(sel.demo) : sel.file.name + " (" + sel.file.size + " bytes)";
    $("confirm-what").textContent = what;
    const wa = typeof cfg.wallet.buyerAddress === "string" ? cfg.wallet.buyerAddress : null; $("confirm-wallet").textContent = wa ? short(wa) : "not configured"; $("confirm-wallet").title = wa || "";
    const dlg = $("confirm"); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }
  // "Run all": the same single-submit path, one input at a time. Every run keeps the per-report cap, session budget and rate limit; any refusal or error stops the queue.
  let pendingQueue = null, queue = null;
  function nextInQueue() {
    if (!queue || !queue.length) { queue = null; renderSubmit(); return; }
    sel = { demo: queue.shift(), file: null, fileErr: null }; doSubmit();
  }
  async function doSubmit() {
    submitMsg = null;
    let r;
    // QE-W2-002: the "record is new" baseline comes from a fresh log read made now, before the POST (never from the page-load copy)
    let freshBase = null; const submitMs = Date.now();
    try { const L0 = await api("/api/log"); if (L0 && Array.isArray(L0.records)) freshBase = L0.records.reduce((m, x) => Math.max(m, Number(x.seq) + 1 || 0), 0); } catch (_) { freshBase = null; }
    try { r = await postSubmit(sel); } catch (e) { queue = null; submitMsg = { kind: "err", text: "Submit failed: " + e.message + ". Nothing was paid (the request did not complete)." }; renderSubmit(); return; }
    if (r.status === 202 && r.body && r.body.jobId) {
      const sb = r.body.baselineSeq; // optional additive field: the server's log length at submit time
      startRun(r.body.jobId, Number.isSafeInteger(sb) && sb >= 0 ? Math.max(sb, freshBase || 0) : freshBase, submitMs); return;
    }
    const b = r.body || {}; const msg = typeof b.message === "string" ? b.message : "no message";
    if (r.status === 429 && queue) { queue.unshift(sel.demo); const w = (Number(b.retryAfterSeconds) || 11) + 1; setTimeout(nextInQueue, w * 1000); renderSubmit(); return; }
    queue = null;
    const m = { 409: "Busy (409): ", 422: "Refused (422, session budget): ", 429: "Rate limited (429): ", 413: "Too large (413): ", 403: "Blocked (403): ", 400: "Bad input (400): " }[r.status] || ("Error (HTTP " + r.status + "): ");
    submitMsg = { kind: r.status === 409 ? "busy" : "err", text: m + msg + (r.status === 429 && b.retryAfterSeconds ? " Retry in " + b.retryAfterSeconds + " s." : "") + " No payment was made." };
    refreshConfig(); renderSubmit();
  }

  // ---------- Activity (live run + recent) ----------
  const STEPS = [["policy", "Policy"], ["approved", "Approved"], ["signed", "Signed"], ["verdict", "Verdict"], ["settled", "Settled"]];
  function newRun(jobId) { const steps = {}; STEPS.forEach(([k]) => steps[k] = { st: "pending", text: "" }); return { jobId, reportHash: null, steps, notes: [], outcome: null, error: null, lost: false, done: false, events: [], chain: null, verdict: null, verdictDetail: null, facts: {} }; }
  function startRun(jobId, baseSeq, submitMs) {
    run = newRun(jobId); runDone = false;
    run.demoId = sel.demo ? sel.demo.id : null; run.name = sel.demo ? chipName(sel.demo) + (sel.demo.handMade ? " (hand-made)" : "") : sel.file ? sel.file.name : "proof";
    run.baseSeq = baseSeq === undefined ? null : baseSeq; run.submitMs = submitMs || 0; // only a record with seq >= baseSeq, the same hash and a timestamp not before submit can belong to this run (null: never adopt)
    renderRun(); renderSubmit(); $("panel-run").focus({ preventScroll: true });
    const mine = run;
    openStream(jobId, onEvent, () => { if (!runDone && run === mine && !mine.lost) { mine.lost = true; queue = null; renderRun(); recover(mine); } });
  }
  // After a dropped stream: look for the signed record of THIS proof hash (bounded retries). Never invents an outcome.
  async function recover(r) {
    r.checking = true; renderRun();
    for (let i = 0; i < 12 && run === r; i++) {
      await new Promise(res => setTimeout(res, FIX ? FX.delay : 2500));
      if (run !== r) return;
      try {
        const L = await api("/api/log");
        const rec = r.reportHash && (FIX || r.baseSeq !== null) ? L.records.filter(x => x.reportHash === r.reportHash && (FIX || (x.seq >= r.baseSeq && Date.parse(x.timestamp) >= r.submitMs - 2000))).sort((a, b) => b.seq - a.seq)[0] : null;
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
    else if (t === "done") { run.done = true; runDone = true; if (stream) stream.close(); refreshConfig(); refreshLog(); if (queue) setTimeout(nextInQueue, 1500); }
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
  // QE-W2-007: replaces /above .*cap/ (quadratic): clip, then two indexOf calls.
  function overCap(m) { m = String(m).slice(0, 400); if (/per-report cap/i.test(m)) return true; const i = m.toLowerCase().indexOf("above "); return i >= 0 && m.toLowerCase().indexOf("cap", i + 6) >= 0; }
  function refusalTitle(m) { m = String(m || "").slice(0, 400); if (/allowlist|endpoint|URL/i.test(m)) return "Not allowed"; if (overCap(m)) return "Over limit"; if (/budget/i.test(m)) return "Budget used up"; return "Refused"; }
  function outcomeCard() {
    const r = run, card = el("div", "ocard"); card.setAttribute("aria-live", "polite");
    const head = (kind, ic, title, spinner, sub, extra) => {
      const h = el("div", "oh"); h.appendChild(add(el("span", "oi"), icon(spinner ? "spin" : ic, spinner ? "spin" : "")));
      const t = el("div", "ohb"); t.appendChild(el("h2", "ot", title)); if (sub) t.appendChild(el("p", "os", sub)); h.appendChild(t); if (extra) h.appendChild(extra);
      card.className = "ocard o-" + kind; card.appendChild(h);
    };
    const note = t => card.appendChild(el("p", "os", t));
    const acts = el("div", "actions");
    const again = () => {};
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
    const cap = cfg && cfg.policy ? usdNum(cfg.policy.perReportCapUsd) : "$0.25";
    p.appendChild(paneHead("Console", run && !run.done && !run.lost ? pill("chk", "Live", "spin") : null));
    const term = el("div", "term");
    const ps = el("div", "ps"); ps.appendChild(el("span", "prompt", "$")); ps.appendChild(el("span", "ps-t", run ? run.name : "waiting for a report")); if (!run) ps.appendChild(el("span", "cursor")); term.appendChild(ps);
    if (!run) {
      const h = el("ul", "hints");
      ["Lock a " + cap + " bond", "Sandbox replays the proof", "Crash: bond back. No crash: bond forfeited."].forEach(t => { const li = el("li"); li.appendChild(icon("ring", "sm")); li.appendChild(el("span", "", t)); h.appendChild(li); });
      term.appendChild(h);
    } else {
      term.appendChild(stepper()); term.appendChild(outcomeCard());
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
      term.appendChild(d);
    }
    p.appendChild(term);
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
    if (!cfg || cfg.mode !== "real") return null; // QE2-F-001: stub verdicts follow the filename, so REAL/HAND-MADE tags next to them mislead; Submit chips keep theirs
    let tg = null; if (r.category === "hand_made_fake") tg = el("span", "tag", "HAND-MADE"); else if (r.category === "real_bug") tg = el("span", "tag", "REAL");
    if (tg) tg.title = LABEL_NOTE; return tg;
  }

  // ---------- Headline + maintainer pane ----------
  const newest = list => list.slice().sort((a, b) => b.seq - a.seq)[0] || null;
  function renderOverview() {
    const h = $("headline"), p = $("panel-overview"); h.replaceChildren(); p.replaceChildren();
    h.appendChild(el("h2", "", "Only reports that crash the library reach a maintainer."));
    p.appendChild(paneHead("For a maintainer", info("What this pane is", "Reproduced reports only: the sandbox saw the expected ASan error on the vulnerable build and a clean fixed build. The sandbox is a filter, not a judge; a human still triages these.")));
    if (logErr) { p.appendChild(errorBox("Could not load the log: " + logErr, loadLog)); return; }
    if (!logData) { p.appendChild(skeleton(3)); return; }
    const L = logData, recs = L.records, good = recs.filter(r => r.sigOk === true);
    const rep = good.filter(r => r.verdict === "reproduced"), forf = good.filter(r => r.verdict === "not_reproduced" && r.settlementStatus === "settled" && AMT.test(String(r.settledAtomic)));
    const inc = good.filter(r => r.verdict === "inconclusive").length, fSum = forf.reduce((a, r) => a + Number(r.settledAtomic), 0);
    const sum = el("div", "sumline");
    sum.appendChild(el("span", "num", recs.length + (recs.length === 1 ? " report" : " reports")));
    sum.appendChild(el("span", "num", rep.length + " reproduced"));
    sum.appendChild(el("span", "num", usd(fSum) + " forfeited"));
    if (inc) sum.appendChild(el("span", "num", inc + " inconclusive"));
    sum.appendChild(trustBadge(L.verify)); h.appendChild(sum);
    const list = el("ul", "mnt");
    if (!rep.length) list.appendChild(el("li", "mnt-empty", "Nothing yet. Reports that do not reproduce never show up here."));
    rep.slice().sort((a, b) => b.seq - a.seq).forEach(r => {
      const li = el("li", "mnt-i"); const t = el("div", "rep-t"); const nm = el("span", "rep-n", rowName(r)); nm.title = r.label || "Unlabeled submission"; t.appendChild(nm); const tg = labelTag(r); if (tg) t.appendChild(tg); li.appendChild(t);
      li.appendChild(evidenceNode(r.verdict, r.detail, false)); li.appendChild(txBtn(r.txSignature, false)); list.appendChild(li);
    });
    p.appendChild(list);
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
    if (!recs.length) { col.appendChild(emptyState("ledger", "No reports yet.")); p.appendChild(col); return; }
    const narrow = window.matchMedia("(max-width:640px)").matches;
    const wrap = el("div", "tablewrap"); const tb = el("table", "tbl");
    const hr = el("tr"); const th = (t, cls, lab) => { const h = el("th", cls || "", t); if (lab) h.setAttribute("aria-label", lab); hr.appendChild(h); };
    th("Label"); th("Status"); th("Settled", "r"); if (!narrow) th("", "txc", "Transaction");
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

  // ---------- drawers (Ledger, Agent) ----------
  function openDrawer(id) { const d = $(id); if (d.open) return; if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
  [["results", "Ledger", "ledger", "ledger"], ["policy", "Agent", "agent", "agent"]].forEach(([id, label, ic, dlg]) => {
    const b = el("button", "tab"); b.type = "button"; b.id = "tab-" + id; b.setAttribute("aria-haspopup", "dialog");
    b.appendChild(icon(ic)); b.appendChild(el("span", "", label)); b.addEventListener("click", () => selectTab(id)); $("tabs").appendChild(b);
    $(dlg + "-close").appendChild(icon("x")); $(dlg + "-close").addEventListener("click", () => $(dlg).close()); $(dlg).addEventListener("click", e => { if (e.target === $(dlg)) $(dlg).close(); });
  });
  function selectTab(name) {
    closePop();
    if (name === "results") { loadLog(); openDrawer("ledger"); } else if (name === "policy") { refreshConfig(); openDrawer("agent"); }
  }

  // ---------- loading ----------
  async function loadConfig() { try { cfg = await api("/api/config"); cfgErr = null; } catch (e) { cfgErr = e.message; } }
  async function refreshConfig() { await loadConfig(); renderBanners(); renderSubmit(); renderPolicy(); renderOverview(); }
  async function loadLog() { try { logData = await api("/api/log"); logErr = null; } catch (e) { logErr = e.message; logData = null; } renderBanners(); renderOverview(); renderResults(); renderSubmit(); renderRun(); }
  async function refreshLog() { return loadLog(); }
  async function loadAll() { renderBanners(); await loadConfig(); renderBanners(); renderSubmit(); renderPolicy(); await loadLog(); }

  // dialogs
  $("confirm-info").textContent = "Returned if reproduced or inconclusive. Forfeited if not.";
  $("confirm-cancel").addEventListener("click", () => { pendingQueue = null; $("confirm").close(); });
  $("confirm-ok").addEventListener("click", () => { $("confirm").close(); if (pendingQueue) { queue = pendingQueue; pendingQueue = null; nextInQueue(); } else doSubmit(); });
  $("confirm").addEventListener("click", e => { if (e.target === $("confirm")) { pendingQueue = null; $("confirm").close(); } });
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
  renderOverview(); renderSubmit(); renderRun(); renderResults(); renderPolicy();
  const startTab = Q.get("tab"); if (startTab === "results" || startTab === "policy") selectTab(startTab);
  loadAll().then(() => { if (FIX && Q.get("autorun") === "all" && cfg) { queue = cfg.demoInputs.slice(); nextInQueue(); } else if (FIX && Q.get("autorun") !== null && cfg) { const i = Number(Q.get("autorun") || 0); sel = { demo: cfg.demoInputs[i], file: null, fileErr: null }; renderSubmit(); doSubmit(); } });
  window.__app = FIX ? { selectTab, getState: () => ({ cfg, logData, run }), pick(i) { sel = { demo: cfg.demoInputs[i], file: null, fileErr: null }; renderSubmit(); }, doSubmit, runAll() { pendingQueue = cfg.demoInputs.slice(); queue = pendingQueue; pendingQueue = null; nextInQueue(); } } : undefined;
})();
