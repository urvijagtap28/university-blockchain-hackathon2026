// Single-board layout checks (headline honesty, Run-all spend gate, stub-mode tags, honesty guarantees on every state, dialogs).
// Key-free, no devnet, no payments. Fixtures over file:// (headless Chrome, CDP) plus one in-process web app with the fake agent for the live batch spacing check.
// Usage: env -i node web/test/qe/layout_cdp.mjs <shots-dir> [cdp-port=9491] [web-port=4132]      (ports 4130-4140 / 9481-9499 only)
import { spawn } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(HERE, "../../public");
const [shots, cport = "9491", wport = "4132"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const dir = mkdtempSync(path.join(os.tmpdir(), "layout-"));

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(dir, "prof")}`, "--window-size=1280,900", "--no-first-run", "--disable-gpu", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
let tgt; for (let i = 0; i < 60 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch(`http://127.0.0.1:${cport}/json`)).json()).find(x => x.type === "page"); } catch {} }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pend = new Map(), events = [];
ws.addEventListener("message", m => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else events.push(j); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r?.result?.value; };
const shot = async n => writeFileSync(path.join(shots, n), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const key = async (k, code) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: code || k, windowsVirtualKeyCode: k === "Escape" ? 27 : k === "Enter" ? 13 : k === "Tab" ? 9 : 0, ...(k === "Enter" && type === "keyDown" ? { text: "\r" } : {}) }); };
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const fx = q => "file://" + path.join(PUB, "index.html") + "?fixtures=1&delay=150&" + q;
const go = async (q, wait = 900) => { await send("Page.navigate", { url: fx(q) }); await sleep(wait); };
const text = sel => ev(`document.querySelector(${JSON.stringify(sel)}).innerText`);
const body = () => ev(`document.body.innerText`);
// every dialog's own text too: closed dialogs are display:none and absent from innerText
const allText = () => ev(`document.documentElement.textContent`);
const BAD = /\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]/;
const closeAll = () => ev(`['confirm','ledger','agent','trust'].forEach(i => { const d = document.getElementById(i); if (d.open) d.close(); })`);
const STUB_LINE = "Rehearsal: stub verdicts follow the filename, not a sandbox.";
const REAL_LINE = /^Bug reports that have to prove themselves\.$/;

// ---------- 1. headline honesty ----------
await go("mode=stub");
let h = await text("#headline h2");
ok(h === STUB_LINE, `stub headline is "${h}"`);
ok(!/Only reports that crash/i.test(await allText()), "old overstated headline is gone");
await go("mode=real");
h = await text("#headline h2");
ok(REAL_LINE.test(h), `real headline is "${h}"`);
const info = await ev(`[...document.querySelectorAll('#panel-overview .pop')].map(p => p.textContent).join(' ')`);
ok(/filter, not a judge/.test(info) && /not proof of a valid bug/.test(info) && /inconclusive/.test(info), "the maintainer-pane info popover carries 'filter, not a judge', 'not proof of a valid bug', and the inconclusive caveat");
await go("mode=real&log=tampered");
h = await text("#headline h2");
ok(!REAL_LINE.test(h) && /did not verify/.test(h), `real + tampered log: headline does not state the product rule as fact: "${h}"`);
await go("mode=real&log=error", 1200);
ok(!REAL_LINE.test(await text("#headline h2")) && /not checked/.test(await text("#headline h2")), "real + log unavailable: headline does not state the rule as fact: " + JSON.stringify(await text("#headline h2")));

// ---------- 2. stub-mode tags ----------
await go("mode=stub");
let rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#panel-submit .rep')].map(l => ({ name: l.querySelector('.rep-n').textContent, pill: !!l.querySelector('.pill'), tag: !!l.querySelector('.tag') })))`));
ok(rows.length === 5 && rows.some(r => r.pill), "stub Reports list: 5 rows, some with a verdict pill: " + JSON.stringify(rows.map(r => [r.name, r.pill, r.tag])));
ok(rows.every(r => !(r.pill && r.tag)), "stub Reports list: no REAL / HAND-MADE tag beside a verdict pill");
ok(rows.filter(r => !r.pill).every(r => r.tag), "stub Reports list: tags kept on the not-yet-run chips (no verdict beside them)");
await ev(`document.getElementById('tab-results').click()`); await sleep(500);
ok(await ev(`document.querySelectorAll('#panel-results .tag').length`) === 0, "stub Ledger: no tags");
await ev(`document.querySelectorAll('#panel-results .exp').forEach(b => b.click())`);
ok(!/HAND-MADE|\bREAL\b/.test(await ev(`document.getElementById('panel-results').textContent`)), "stub Ledger (rows expanded): no HAND-MADE / REAL text");
await closeAll();
ok(await ev(`document.querySelectorAll('#panel-overview .tag').length`) === 0, "stub maintainer pane: no tags");
// run a hand-made input and a real one in stub mode; the console must not say HAND-MADE / REAL beside the verdict
for (const [idx, nm] of [[2, "hand-made"], [0, "real"]]) {
  await go("mode=stub&log=empty"); await ev(`window.__app.pick(${idx}); window.__app.doSubmit()`); await sleep(2600);
  const rt = await ev(`document.getElementById('panel-run').textContent`);
  ok(/Bond (returned|forfeited)/.test(rt) && !/hand-made|HAND-MADE|\bREAL\b/.test(rt), `stub console outcome card for a ${nm} input: verdict shown, no category label`);
}
await go("mode=real");
rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#panel-submit .rep')].map(l => ({ pill: !!l.querySelector('.pill'), tag: l.querySelector('.tag')?.textContent || null })))`));
ok(rows.some(r => r.pill && r.tag === "HAND-MADE") && rows.some(r => r.pill && r.tag === "REAL"), "real Reports list: tags shown beside verdicts: " + JSON.stringify(rows));
ok(await ev(`document.querySelectorAll('#panel-overview .tag').length`) >= 1, "real maintainer pane shows the REAL tag");

// ---------- 3. stub bar on every state, never dismissable, repeated inside every dialog ----------
const barState = () => ev(`(() => { const v = e => !!e && e.offsetParent !== null; const top = document.querySelector('#banners .bar-msg.stub'); return JSON.stringify({ top: v(top) && /STUB MODE: not a real sandbox run/.test(top.textContent), btn: !!document.querySelector('.bar-msg.stub button'), inDialog: ['confirm','ledger','agent','trust'].map(i => { const d = document.getElementById(i); return d.open ? v(d.querySelector('.bar-msg.stub')) : null; }) }); })()`);
await go("mode=stub");
let b = JSON.parse(await barState()); ok(b.top && !b.btn, "stub bar visible on the default state, no close/dismiss control");
await ev(`document.querySelector('#panel-submit .rep button').click()`); await sleep(300);
b = JSON.parse(await barState()); ok(b.inDialog[0] === true, "stub bar repeated inside the open confirm dialog"); await shot("confirm_single_stub.png"); await closeAll();
for (const [nm, open] of [["ledger", "tab-results"], ["agent", "tab-policy"]]) { await ev(`document.getElementById('${open}').click()`); await sleep(500); b = JSON.parse(await barState()); ok(b.inDialog[["confirm", "ledger", "agent", "trust"].indexOf(nm)] === true && !b.btn, `stub bar visible inside the open ${nm} drawer`); await closeAll(); }
await ev(`document.querySelector('#headline .trustbtn').click()`); await sleep(400); b = JSON.parse(await barState()); ok(b.inDialog[3] === true, "stub bar visible inside the open trust drawer"); await closeAll();
await go("mode=stub&log=empty"); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(500);
b = JSON.parse(await barState()); ok(b.top, "stub bar present while a run is live"); await sleep(2500);
b = JSON.parse(await barState()); ok(b.top, "stub bar present on the outcome card");
for (const sc of ["refused", "error", "dropped", "settlement_pending"]) { await go("mode=stub&scenario=" + sc); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(3200); b = JSON.parse(await barState()); ok(b.top, `stub bar present in scenario ${sc}`); }
await go("mode=stub&log=tampered"); b = JSON.parse(await barState()); ok(b.top, "stub bar present with a tampered log");
await go("mode=stub&log=error", 1200); b = JSON.parse(await barState()); ok(b.top, "stub bar present with the log unavailable");
await go("mode=stub&busy=1", 1200); b = JSON.parse(await barState()); ok(b.top, "stub bar present with busy=1");
// the old real-mode rules: 'Real' only when verified, red CHECKS FAILED otherwise
await go("mode=real"); let top = await ev(`document.getElementById('topr').innerText + '|' + document.getElementById('banners').innerText`);
ok(/Real/.test(top) && !/Checks failed|CHECKS FAILED/i.test(top), "real + verified log: Real pill, no failure bar");
await go("mode=real&log=tampered"); top = await ev(`document.getElementById('topr').innerText + '|' + document.getElementById('banners').innerText`);
ok(/CHECKS FAILED/.test(top) && (await ev(`document.querySelector('#topr .pill').innerText.trim()`)).toLowerCase() !== "real", "real + tampered: red CHECKS FAILED bar, no Real pill"); await shot("tampered_real.png");
await ev(`document.getElementById('tab-results').click()`); await sleep(400);
ok(await ev(`document.querySelector('#ledger-bars .bar-msg.fail') !== null && document.querySelector('#ledger-bars .bar-msg.fail').offsetParent !== null`), "CHECKS FAILED bar repeated inside the open Ledger drawer"); await closeAll();
await go("mode=real&log=error", 1200); top = await ev(`document.getElementById('banners').innerText`);
ok(/log not checked/i.test(top) && (await ev(`document.querySelector('#topr .pill').innerText.trim()`)).toLowerCase() !== "real", "real + log unavailable: red 'log not checked' bar, pill is not 'Real'");

// ---------- 4. unverified maintainer item ----------
await go("mode=real&log=unverified");
const mt = await text("#panel-overview");
const unv = JSON.parse(await ev(`JSON.stringify({ n: document.querySelectorAll('#panel-overview .mnt-i.unv').length, pill: [...document.querySelectorAll('#panel-overview .mnt-i.unv .pill')].map(p => p.textContent), btns: document.querySelectorAll('#panel-overview .mnt-i.unv button, #panel-overview .mnt-i.unv a, #panel-overview .mnt-i.unv .evd, #panel-overview .mnt-i.unv .tag').length })`));
ok(unv.n === 1 && unv.pill[0] === "Unverified record" && unv.btns === 0, "unverified reproduced record shown as 'Unverified record' with no link, evidence, tag or action: " + JSON.stringify(unv));
ok(!/Nothing yet/.test(mt), "empty-list line is not shown when only unverified items exist"); await shot("unverified_maintainer.png");

// ---------- 5. Run-all spend gate ----------
await go("mode=real");
await ev(`document.getElementById('run-all').click()`); await sleep(300);
const cf = JSON.parse(await ev(`JSON.stringify({ open: document.getElementById('confirm').open, t: document.getElementById('confirm').innerText, title: document.getElementById('confirm-title').textContent, subs: document.getElementById('confirm-bars').children.length })`));
ok(cf.open && /\$1\.25/.test(cf.t) && /5 × \$0\.25/.test(cf.t) && /worst case/.test(cf.t) && /\$1\.25 left of \$2\.00/.test(cf.t) && /Approve up to 5 payments/.test(cf.title), "Run all opens the confirm dialog with total ($1.25 = 5 x $0.25 worst case) and remaining budget: " + cf.t.replace(/\n+/g, " | "));
ok(await ev(`!!document.querySelector('#confirm #confirm-cancel') && !!document.querySelector('#confirm #confirm-ok')`), "Approve and Cancel are present"); await shot("run_all_confirm.png");
ok(await ev(`window.__app.getState().run`) === null, "nothing submitted before Approve");
await ev(`document.getElementById('confirm-cancel').click()`); await sleep(1500);
ok(await ev(`!document.getElementById('confirm').open && window.__app.getState().run === null`), "Cancel does nothing (no run started)");
await ev(`document.getElementById('run-all').click()`); await sleep(200); await key("Escape"); await sleep(1500);
ok(await ev(`!document.getElementById('confirm').open && window.__app.getState().run === null`), "Esc on the Run-all dialog does nothing either");
await ev(`document.querySelector('#panel-submit .rep button').click()`); await sleep(200); await ev(`document.getElementById('confirm-cancel').click()`); await sleep(1500);
ok(await ev(`window.__app.getState().run === null`), "single Run also confirms, and Cancel does nothing");
// low budget: refuse up front
await go("mode=real&lowbudget=1");
await ev(`document.getElementById('run-all').click()`); await sleep(400);
const lb = JSON.parse(await ev(`JSON.stringify({ open: document.getElementById('confirm').open, msg: document.getElementById('panel-submit').innerText, run: window.__app.getState().run })`));
ok(!lb.open && lb.run === null && /Refused up front/.test(lb.msg) && /5 × \$0\.25 = \$1\.25/.test(lb.msg) && /\$0\.75 left of \$2\.00/.test(lb.msg) && /session budget/i.test(lb.msg), "Run all with $0.75 left refuses up front (no dialog, no request) and names the session budget: " + lb.msg.replace(/\n+/g, " | ").slice(0, 260));
ok(!/No payment was made/.test(lb.msg), "client-side refusal does not claim the server said 'No payment was made'"); await shot("run_all_refused_budget.png");
// batch runs sequentially: names in order, never two live at once, each finished before the next starts
await go("mode=real");
const rowsBefore = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#panel-submit .rep')].map(l => l.querySelector('.rep-n').textContent + (l.querySelector('.tag')?.textContent === 'HAND-MADE' ? ' (hand-made)' : '')))`));
await ev(`document.getElementById('run-all').click()`); await sleep(200); await ev(`document.getElementById('confirm-ok').click()`);
const seq = []; let maxLive = 0, overlap = false; let shotRun = false;
for (let i = 0; i < 160; i++) {
  await sleep(100);
  const s = JSON.parse(await ev(`JSON.stringify({ n: window.__app.getState().run?.name || null, done: window.__app.getState().run?.done || false, live: document.querySelectorAll('#panel-submit .rep.live').length, btn: document.getElementById('run-all').textContent })`));
  maxLive = Math.max(maxLive, s.live);
  if (s.n && seq[seq.length - 1]?.n !== s.n) { if (seq.length && !seq[seq.length - 1].done) overlap = true; seq.push({ n: s.n, done: s.done }); }
  if (seq.length) seq[seq.length - 1].done = s.done;
  if (s.n && !shotRun && !s.done && seq.length === 2) { shotRun = true; await shot("running_batch.png"); }
  if (seq.length === 5 && s.done) break;
}
console.log("batch order:", seq.map(x => x.n).join(" > "));
ok(seq.length === 5 && !overlap && maxLive <= 1, `Run all runs the 5 inputs one at a time (never concurrent): ${seq.length} runs, overlap=${overlap}, max live chips ${maxLive}`);
ok(JSON.stringify(seq.map(x => x.n)) === JSON.stringify(rowsBefore), "batch order follows the Reports list: " + JSON.stringify(rowsBefore));
await sleep(600); ok(await ev(`document.getElementById('run-all').textContent`) === "Submit all 5", "button returns to 'Run all 5' after the batch");
// stop on the first refusal / error and show it
for (const [sc, re] of [["refused", /Batch stopped: .* was refused/], ["error", /Batch stopped: .* ended with an error|Batch stopped: .* did not finish with a settled verdict/]]) {
  await go("mode=real&scenario=" + sc);
  await ev(`document.getElementById('run-all').click()`); await sleep(200); await ev(`document.getElementById('confirm-ok').click()`); await sleep(4500);
  const m = JSON.parse(await ev(`JSON.stringify({ msg: document.getElementById('panel-submit').innerText, run: window.__app.getState().run?.name, btn: document.getElementById('run-all').textContent })`));
  ok(re.test(m.msg) && /4 not submitted/.test(m.msg) && /Submit all 5/.test(m.btn), `scenario ${sc}: batch stops on the first ${sc}, shows why, 4 not submitted, run name stays ${m.run}`);
  ok(!BAD.test(m.msg) && !/\b\d{4,} atomic\b/.test(m.msg), `scenario ${sc}: batch-stopped message has no raw atomic amounts or null/undefined`);
  if (sc === "refused") await shot("batch_stopped_refused.png");
}
await go("mode=real&scenario=budget_exhausted");
await ev(`document.getElementById('run-all').click()`); await sleep(200); await ev(`document.getElementById('confirm-ok').click()`); await sleep(1500);
ok(/Refused \(422, session budget\)/.test(await text("#panel-submit")), "server 422 on the first submit stops the batch and is shown");

// ---------- 6. honesty guarantees on this layout ----------
const states = [["stub default", "mode=stub"], ["real default", "mode=real"], ["tampered", "mode=real&log=tampered"], ["empty log", "mode=stub&log=empty"], ["log error", "mode=real&log=error"], ["xss", "mode=real&log=xss&xss=1"]];
for (const [nm, q] of states) {
  await go(q, 1100);
  await ev(`document.getElementById('tab-results').click()`); await sleep(300); await ev(`document.querySelectorAll('#panel-results .exp').forEach(b => b.click())`);
  const t = await allText(); const bad = BAD.exec(t);
  ok(!bad && !/\b\d{4,} atomic\b/.test(t), `${nm}: no null/undefined/NaN/[object Object] and no raw atomic amounts` + (bad ? " (found: " + t.slice(Math.max(0, bad.index - 40), bad.index + 40).replace(/\s+/g, " ") + ")" : ""));
  await closeAll();
}
for (const sc of ["success_returned", "success_forfeited", "refused", "error", "dropped", "dropped_norecord", "settlement_pending", "xss", "real_returned", "real_forfeited", "real_inconclusive", "real_refused", "facts_returned", "facts_refused"]) {
  await go("mode=" + (sc.startsWith("real") || sc.startsWith("facts") ? "real" : "stub") + "&scenario=" + sc); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(sc.startsWith("dropped") ? 4500 : 3600);
  const t = await ev(`document.getElementById('panel-run').textContent`), bad = BAD.exec(t);
  ok(!bad && !/\b\d{4,} atomic\b/.test(t), `scenario ${sc}: console has no null/undefined/NaN/[object Object]/raw atomic` + (bad ? " (" + t.slice(Math.max(0, bad.index - 40), bad.index + 40) + ")" : ""));
  const links = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#panel-run a[href]')].map(a => a.href))`));
  ok(links.length <= 1 && links.every(l => /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{43,90}\?cluster=devnet$/.test(l)), `scenario ${sc}: at most one settle link, base58 only: ${JSON.stringify(links).slice(0, 120)}`);
  ok(!/deposit/i.test(await ev(`[...document.querySelectorAll('#panel-run a[href]')].map(a => a.getAttribute('aria-label') + ' ' + a.title).join(' ')`)), `scenario ${sc}: no deposit link`);
  if (sc === "success_returned") await shot("outcome_returned.png");
  if (sc === "success_forfeited") await shot("outcome_forfeited.png");
  if (sc === "refused") await shot("outcome_refused.png");
  if (sc === "error") await shot("outcome_error.png");
  if (sc === "real_returned") await shot("real_returned.png");
}
await go("mode=real&scenario=error"); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(3500);
{ const t = await ev(`document.getElementById('panel-run').textContent`); ok(/error: \$0 settled, bond returned/.test(t) && !/FAILED/.test(t), "error verdict wording on the new layout"); ok(!/No payment was made/i.test(t), "error verdict (a payment path ran) does not say 'No payment was made'"); }
await go("mode=stub&scenario=refused"); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(3200);
ok(/No payment was made/.test(await ev(`document.getElementById('panel-run').textContent`)), "'No payment was made' appears on a server/policy refusal");
await go("mode=stub&scenario=success_returned"); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(3500);
ok(!/No payment was made/.test(await ev(`document.getElementById('panel-run').textContent`)), "'No payment was made' does not appear on a normal outcome");
ok(await ev(`[...document.querySelectorAll('#panel-run .stepper .nm')].map(e => e.textContent).join(',')`) === "Agent checks its rules,You approve,Bond locked (x402),Sandbox replays the proof,Money settles on Solana", "stepper steps use plain names (no 'Paid')");
await ev(`document.getElementById('tab-results').click()`); await sleep(300);
ok(await ev(`[...document.querySelectorAll('#panel-results th')].map(e => e.textContent).join(',')`) === "Label,Status,Settled,", "Ledger columns Label, Status, Settled (no 'Paid')"); await closeAll();
// Ledger: one settle link per report, only base58
await go("mode=real&log=xss&xss=1"); await ev(`document.getElementById('tab-results').click()`); await sleep(400);
const ll = JSON.parse(await ev(`JSON.stringify({ rows: document.querySelectorAll('#panel-results tbody tr:not(.drow)').length, hrefs: [...document.querySelectorAll('#panel-results a[href]')].map(a => a.href) })`));
ok(ll.hrefs.length <= ll.rows && ll.hrefs.every(l => /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{43,90}\?cluster=devnet$/.test(l)), `Ledger (xss log): <= one link per row, base58 only (${ll.hrefs.length} links / ${ll.rows} rows)`); await closeAll();

// ---------- 7. keyboard, dialogs, focus ----------
await go("mode=real");
await ev(`document.getElementById('tab-results').focus()`); await key("Enter"); await sleep(100);
// Enter on a focused button fires click natively only via real input; CDP key events do that
await sleep(400); ok(await ev(`document.getElementById('ledger').open`), "Enter on the focused Ledger button opens the drawer");
await key("Escape"); await sleep(300);
ok(await ev(`!document.getElementById('ledger').open && document.activeElement.id === 'tab-results'`), "Esc closes the Ledger drawer and returns focus to its opener");
await ev(`document.getElementById('tab-policy').focus()`); await key("Enter"); await sleep(400);
ok(await ev(`document.getElementById('agent').open`), "Agent drawer opens from the keyboard"); await key("Escape"); await sleep(300);
ok(await ev(`!document.getElementById('agent').open && document.activeElement.id === 'tab-policy'`), "Esc closes the Agent drawer and returns focus");
await ev(`document.querySelector('#headline .trustbtn').focus()`); await key("Enter"); await sleep(400);
ok(await ev(`document.getElementById('trust').open`), "the trust badge opens the log-verification drawer from the keyboard"); await key("Escape"); await sleep(300);
ok(await ev(`!document.getElementById('trust').open && document.activeElement.classList.contains('trustbtn')`), "Esc closes the trust drawer and returns focus to the badge");
await ev(`document.querySelector('#panel-submit .rep button').focus()`);
ok(await ev(`document.activeElement.tagName === 'BUTTON' && /^Run /.test(document.activeElement.getAttribute('aria-label'))`), "Run buttons are focusable and labelled");
await key("Enter"); await sleep(400);
ok(await ev(`document.getElementById('confirm').open && document.activeElement.id === 'confirm-cancel'`), "Enter on a Run button opens the confirm dialog with focus on Cancel"); await key("Escape"); await sleep(300);
ok(await ev(`!document.getElementById('confirm').open && document.activeElement.tagName === 'BUTTON' && document.querySelector('#panel-submit .rep button') === document.activeElement`), "Esc closes the confirm dialog and returns focus to the Run button");
// popover keyboard
await ev(`document.querySelector('#panel-overview .info').focus()`); await key("Enter"); await sleep(200);
ok(await ev(`!document.querySelector('#panel-overview .pop').hidden`), "info popover opens from the keyboard"); await key("Escape"); await sleep(200);
ok(await ev(`document.querySelector('#panel-overview .pop').hidden && document.activeElement === document.querySelector('#panel-overview .info')`), "Esc closes the popover and returns focus");

// ---------- 8. static guarantees ----------
const src = readFileSync(path.join(PUB, "app.js"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
ok(!/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(code), "app.js code (comments removed) has no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval");
const csrfLines = code.split("\n").filter(l => /csrfToken/.test(l));
ok(csrfLines.length === 2 && csrfLines.every(l => /"x-csrf-token": cfg\.csrfToken/.test(l)), "csrfToken is used only as an x-csrf-token header (" + csrfLines.length + " uses)");
const html = readFileSync(path.join(PUB, "index.html"), "utf8");
ok(html.includes(`content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"`), "CSP meta unchanged");
ok(!/\sstyle=|<script>[^<]|onclick=|onerror=/.test(html), "index.html has no inline style/script/handlers");
const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
ok(reqs.every(u => u.startsWith("file://") || u.startsWith("data:") || u.startsWith("about:") || u.startsWith("http://127.0.0.1")), `no external network requests (${reqs.length} requests, non-local: ${JSON.stringify(reqs.filter(u => !(u.startsWith("file://") || u.startsWith("data:") || u.startsWith("about:") || u.startsWith("http://127.0.0.1"))))})`);

// ---------- 9. screenshots of the remaining states ----------
await go("mode=stub"); await shot("default_stub.png");
await go("mode=real"); await shot("default_real.png");
const words = await ev(`document.body.innerText.split(/\\s+/).filter(Boolean).length`);
console.log("INFO word count of the default real state (whole page, incl. top bar):", words);
await go("mode=stub"); const wstub = await ev(`document.body.innerText.split(/\\s+/).filter(Boolean).length`); console.log("INFO word count of the default stub state:", wstub);
await go("mode=stub&log=empty&delay=2500"); await ev(`window.__app.pick(1); window.__app.doSubmit()`); await sleep(5200); await shot("running_stub.png");
await go("mode=real"); await ev(`document.getElementById('tab-results').click()`); await sleep(500); await ev(`document.querySelector('#panel-results .exp').click()`); await shot("ledger_real.png"); await closeAll();
await go("mode=stub"); await ev(`document.getElementById('tab-results').click()`); await sleep(500); await shot("ledger_stub.png"); await closeAll();
await ev(`document.getElementById('tab-policy').click()`); await sleep(500); await shot("agent_stub.png"); await closeAll();
await ev(`document.querySelector('#headline .trustbtn').click()`); await sleep(500); await shot("trust_stub.png"); await closeAll();
await go("mode=real&log=tampered"); await ev(`document.querySelector('#banners .barlink').click()`); await sleep(500); await shot("trust_tampered.png"); await closeAll();

// ---------- 10. live in-process server: batch spacing >= 11.5 s and a gate that really blocks ----------
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const logFile = path.join(dir, "verdicts.jsonl");
const mkProof = n => { const f = path.join(dir, n + ".bin"); writeFileSync(f, "layout " + n); return { id: n, label: n, category: "real_bug", handMade: false, sizeBytes: 8 + n.length, abs: f, sha: createHash("sha256").update("layout " + n).digest("hex") }; };
let submits = 0;
const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: { PATH: process.env.PATH ?? "" }, signerPub: base58.encode(pub), spacingMs: 0,
  agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, timing: { waitDoneMs: 8000, waitSignedMs: 8000, pollMs: 100, agentTimeoutMs: 20000 },
  extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), FAKE_SLEEP_MS: "300", FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0" },
  demoInputs: [mkProof("real_one"), mkProof("real_two")] });
await app.listen(Number(wport));
const base = `http://127.0.0.1:${wport}`;
await send("Page.navigate", { url: base + "/" }); await sleep(1500);
events.length = 0;
await ev(`document.getElementById('run-all').click()`); await sleep(300);
ok(await ev(`document.getElementById('confirm').open && /\\$0\\.50/.test(document.getElementById('confirm-amt').textContent)`), "live: Run all (2 inputs) confirm shows $0.50 worst case");
await ev(`document.getElementById('confirm-cancel').click()`); await sleep(1500);
ok(!events.some(e => e.method === "Network.requestWillBeSent" && /\/api\/submit/.test(e.params.request.url)), "live: Cancel sent no /api/submit request");
await ev(`document.getElementById('run-all').click()`); await sleep(200); await ev(`document.getElementById('confirm-ok').click()`);
const t0 = Date.now(); const seen = new Map(); let doneAt = null;
for (let i = 0; i < 400; i++) {
  await sleep(100);
  const t = await ev(`document.getElementById('panel-run').textContent`); const m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(t);
  const fin = /Bond returned/.test(t);
  if (m && !seen.has(m[0])) seen.set(m[0], { start: Date.now(), end: null });
  if (m && fin && seen.get(m[0]) && !seen.get(m[0]).end) seen.get(m[0]).end = Date.now();
  if (seen.size === 2 && [...seen.values()].every(x => x.end)) { doneAt = Date.now(); break; }
}
const sv = [...seen.values()]; const submitReqs = events.filter(e => e.method === "Network.requestWillBeSent" && /\/api\/submit/.test(e.params.request.url));
ok(sv.length === 2 && doneAt, `live: both jobs finished (${sv.length} jobs, ${(doneAt ? (doneAt - t0) / 1000 : "n/a")} s)`);
if (sv.length === 2) { const gap = (sv[1].start - sv[0].end) / 1000; ok(gap >= 11.0, `live: second submit started ${gap.toFixed(1)} s after the first run ended (>= 11.5 s spacing, minus polling resolution)`); }
ok(submitReqs.length === 2, `live: exactly 2 /api/submit requests, sequential (${submitReqs.length}); no 429 backstop needed`);
await app.close();
ws.close(); chrome.kill("SIGKILL");
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
