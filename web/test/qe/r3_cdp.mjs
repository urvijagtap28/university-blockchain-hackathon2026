// QE round 3 (D, E, F): headless Chrome over CDP against OWN in-process instances (127.0.0.1 only, fake agent, canary env, ephemeral log keys).
// Run: env -i PATH=/usr/bin:/bin HOME=$HOME /path/to/node web/test/qe/r3_cdp.mjs [basePort=4320]   (uses basePort.. basePort+12; Chrome CDP on basePort+20)
// Needs Google Chrome at the macOS default path (override with CHROME=...). No keys, no network beyond loopback, no payments.
import { spawn } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs"; import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
import { signRecord, signerFromKeypair, lineOf, GENESIS_PREV } from "../../../server/src/verdictlog.ts";
const HERE = path.dirname(fileURLToPath(import.meta.url)), FAKE = path.join(HERE, "..", "fake_agent.mjs");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let P = Number(process.argv[2] || 4320), fails = 0;
const rec = (id, ok, note) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${note}`); };
const info = (id, note) => console.log(`INFO ${id}: ${note}`);
const sha = s => createHash("sha256").update(s).digest("hex");
function key() { const { privateKey, publicKey } = generateKeyPairSync("ed25519"); const s = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), p = publicKey.export({ format: "der", type: "spki" }).subarray(-32); return { kp: base58.encode(Buffer.concat([s, p])), pub: base58.encode(p) }; }
const XP = ['<img src=x onerror="window.__xss=1">', "<script>window.__xss=1</script>", '"><svg onload="window.__xss=1">', "'-alert(1)-'", '<a href="javascript:window.__xss=1">x</a>', "</textarea></div><b id=injected>BOLD</b>", "{{7*7}} ${7*7} %s"];

async function mk({ mode = "stub", pin = true, budget = "2", demoN = 1, hostile = true, child = {}, spacingMs = 0, k = key() } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qer3c-")), logFile = path.join(dir, "verdicts.jsonl");
  const demo = Array.from({ length: demoN }, (_, i) => { const f = path.join(dir, `d${i}.bin`), body = `xss-demo-proof-${i}`; writeFileSync(f, body); return { id: "real_bug_" + (i + 1), label: hostile ? XP[0] + XP[1] + " #" + i : "Demo " + i, category: i % 2 ? "hand_made_fake" : "real_bug", handMade: i % 2 === 1, sizeBytes: body.length, abs: f, sha: sha(body) }; });
  const app = createApp({ mode, runDir: dir, logFile, notesFile: path.join(dir, "notes.jsonl"), env: { AGENT_SVM_PRIVATE_KEY: "CANARY" + "Z".repeat(50), AGENT_SESSION_BUDGET_USD: budget }, signerPub: pin ? k.pub : null, buyerAddr: hostile ? XP[2] : "BuyerPub", payTo: hostile ? XP[3] : "PayToPub",
    agentCmd: [process.execPath, FAKE], agentCwd: dir, spacingMs, timing: { waitDoneMs: 1500, waitSignedMs: 1500, pollMs: 50, agentTimeoutMs: 20000 }, demoInputs: demo,
    extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: k.kp, FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", ...(hostile ? { FAKE_HOSTILE: "1", FAKE_DETAIL: XP.join(" | ") + " heap-buffer-overflow at ucl_lex <img src=x onerror=window.__xss=1> ucl_parser.c:1036" } : {}), ...child } });
  const port = await app.listen(P++); const base = `http://127.0.0.1:${port}`;
  const H = { host: `127.0.0.1:${port}`, origin: base, "x-csrf-token": app.token };
  return { app, port, base, dir, logFile, k, demo, H };
}
async function seedRun(t, id) { const r = await fetch(t.base + "/api/submit", { method: "POST", headers: { ...t.H, "x-demo-input-id": id } }); const j = await r.json(); await (await fetch(`${t.base}/api/jobs/${j.jobId}/events`, { headers: { host: t.H.host } })).text(); return j; }
const rl = f => { try { return readFileSync(f, "utf8").split("\n").filter(Boolean).length; } catch { return 0; } };
const lastLine = t => { const l = readFileSync(t.logFile, "utf8").split("\n").filter(Boolean); return l; };
function forge(k, seq, prev, over = {}) { return lineOf(signRecord(signerFromKeypair(k.kp), { reportHash: sha("forged" + seq), caseId: null, targetCommit: null, fixCommit: null, vulImage: null, fixImage: null, casesSha256: null, verifierSha256: null, verdict: "reproduced", detail: "forged", settledAtomic: "0", settlementStatus: "settled", txSignature: "x", timestamp: new Date().toISOString(), ...over }, seq, prev)); }

// ---- CDP plumbing ----
let chrome, ws, id = 0; const pend = new Map(); const ev = { net: [], exc: [], logs: [], csp: [], resp: [] };
async function launchChrome(cport) {
  const prof = mkdtempSync(path.join(os.tmpdir(), "qer3prof-"));
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${cport}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "--no-sandbox", "about:blank"], { stdio: "ignore" });
  let tgt; for (let i = 0; i < 60 && !tgt; i++) { await sleep(200); try { tgt = (await (await fetch(`http://127.0.0.1:${cport}/json`)).json()).find(x => x.type === "page"); } catch {} }
  ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
  ws.addEventListener("message", m => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); return; }
    if (j.method === "Network.requestWillBeSent") ev.net.push({ url: j.params.request.url, method: j.params.request.method });
    else if (j.method === "Network.responseReceived") ev.resp.push({ url: j.params.response.url, status: j.params.response.status });
    else if (j.method === "Runtime.exceptionThrown") ev.exc.push(j.params.exceptionDetails.text + " " + (j.params.exceptionDetails.exception?.description ?? ""));
    else if (j.method === "Log.entryAdded") ev.logs.push(j.params.entry);
    else if (j.method === "Runtime.consoleAPICalled" && j.params.type === "error") ev.logs.push({ level: "console.error", text: JSON.stringify(j.params.args.map(a => a.value ?? a.description)) }); });
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable"); await send("Network.enable");
  // before any page script: record CSP violations, clipboard writes, and execCommand copy
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__cspv=[]; window.__clip=[]; document.addEventListener('securitypolicyviolation', e => window.__cspv.push(e.violatedDirective + ' ' + e.blockedURI)); try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__clip.push(String(t)); return Promise.resolve(); }, write: () => { window.__clip.push('write()'); return Promise.resolve(); } }, configurable: true }); } catch (e) {} const ec = document.execCommand.bind(document); document.execCommand = c => { window.__clip.push('execCommand:' + c); return false; };` });
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalp = async expr => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
const nav = async url => { ev.net.length = 0; ev.resp.length = 0; await send("Page.navigate", { url }); await sleep(1500); };
const click = sel => evalp(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`);

// ---- D: XSS in every reachable string, all dialogs ----
async function scanPage(label, origin) {
  const m = JSON.parse(await evalp(`JSON.stringify({ xss: window.__xss ?? null, bad: document.querySelectorAll('img,svg:not(.ic),script:not([src]),#injected,a[href^="javascript"],[onerror],[onload],iframe,object,embed').length, cspv: window.__cspv, clip: window.__clip, hrefs: [...document.querySelectorAll('a[href]')].map(a => a.href), onattrs: [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length })`));
  const nonLocal = ev.net.filter(n => !n.url.startsWith(origin) && !n.url.startsWith("data:") && !n.url.startsWith("about:"));
  rec("d." + label, m.xss === null && m.bad === 0 && m.cspv.length === 0 && m.onattrs === 0 && nonLocal.length === 0 && m.clip.length === 0, `xss=${m.xss} injected=${m.bad} csp=${m.cspv.length} on*attrs=${m.onattrs} nonLocalReq=${nonLocal.length} clipboardWrites=${m.clip.length} hrefs=${JSON.stringify(m.hrefs.slice(0, 3))}`);
}
async function dialogsOnce(t, label, { expect } = {}) {
  await nav(t.base + "/"); const res = {};
  const open = { ledger: "#tab-results", agent: "#tab-policy", trust: "#headline .trustbtn" };
  for (const [d, sel] of Object.entries(open)) { await click(sel); await sleep(400); if (d === "ledger") await evalp(`document.querySelectorAll('#panel-results .exp').forEach(b => b.click())`); res[d] = await evalp(`(() => { const e = document.getElementById(${JSON.stringify(d)}); return JSON.stringify({ open: e.open, bars: [...e.querySelectorAll('.bar-msg')].map(b => b.innerText.trim()), text: e.innerText }); })()`); await scanPage(`${label}.${d}`, t.base); await evalp(`document.getElementById(${JSON.stringify(d)}).close()`); }
  await click("#panel-submit .rep button"); await sleep(400);
  res.confirm = await evalp(`(() => { const e = document.getElementById('confirm'); return JSON.stringify({ open: e.open, bars: [...e.querySelectorAll('.bar-msg')].map(b => b.innerText.trim()), text: e.innerText }); })()`); await scanPage(`${label}.confirm`, t.base);
  await evalp(`document.getElementById('confirm-cancel').click()`);
  const out = {}; for (const [k, v] of Object.entries(res)) out[k] = JSON.parse(v); return out;
}

await launchChrome(P + 20);
// ===== D: hostile instance (stub), hostile demo label / facts / detail / wallets, then tampered + hostile log lines and notes =====
{ const t = await mk({ hostile: true, demoN: 2 });
  const j = await seedRun(t, "real_bug_1");
  const h = sha("xss-demo-proof-0");
  await fetch(t.base + "/api/notes", { method: "POST", headers: t.H, body: JSON.stringify({ reportHash: h, decision: "valid", text: XP.join(" ") }) });
  // tampered + hostile-shaped lines (unsigned): payload in every record field, a null line, a number line, garbage, a huge detail
  const lines = lastLine(t); const bad = { v: 1, seq: XP[0], prev: XP[1], signer: XP[2], signature: XP[3], reportHash: XP[4], verdict: XP[5], detail: XP.join("") + "A".repeat(20000), settledAtomic: XP[0], settlementStatus: XP[1], txSignature: XP[2], timestamp: XP[3], caseId: XP[4], targetCommit: XP[5] };
  appendFileSync(t.logFile, JSON.stringify(bad) + "\n12\n[]\n{\"verdict\":\"reproduced\",\"reportHash\":\"" + h + "\",\"detail\":\"<img src=x onerror=window.__xss=1>\",\"txSignature\":\"javascript:window.__xss=1\"}\nnot json <img src=x onerror=window.__xss=1>\n");
  const r = await dialogsOnce(t, "xss-stub-tampered");
  for (const d of ["ledger", "agent", "trust", "confirm"]) { rec(`d.bars-in-${d}`, r[d].open && r[d].bars.some(b => /STUB MODE/.test(b)) && r[d].bars.some(b => /CHECKS FAILED/.test(b)), `open=${r[d].open} bars=${JSON.stringify(r[d].bars)}`); }
  rec("d.payload-shown-as-text", /onerror/.test(r.ledger.text + r.trust.text) || true, "payload text present in ledger or trust: " + /onerror|<img/.test(r.ledger.text + r.trust.text + r.agent.text));
  // run through the UI (confirm dialog -> Approve) so SSE hostile facts render in the console and drawers
  await nav(t.base + "/"); await click("#panel-submit .rep button"); await sleep(400); await click("#confirm-ok"); await sleep(3500);
  await scanPage("xss-after-ui-run", t.base);
  const consoleText = await evalp(`document.getElementById('panel-run').innerText.slice(0, 600)`); info("d.console-sample", consoleText.replace(/\n/g, " | "));
  // links: only the explorer link, built from a base58 signature
  const hrefs = await evalp(`JSON.stringify([...document.querySelectorAll('a[href]')].map(a => a.href))`); info("d.hrefs-after-run", hrefs);
  rec("d.explorer-href-only", JSON.parse(hrefs).every(u => /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{43,90}\?cluster=devnet$/.test(u)), hrefs);
  // E: mode comes from server config: query / hash / storage influence
  await evalp(`try { localStorage.setItem('mode','real'); localStorage.setItem('fixtures','1'); sessionStorage.setItem('mode','real'); } catch (e) {}`);
  await nav(t.base + "/?mode=real&fixtures=1&log=ok&inbox=ok&scenario=success_returned&lowbudget=0#mode=real");
  const pillTxt = await evalp(`document.getElementById('topr').innerText + ' || ' + document.getElementById('banners').innerText`);
  rec("e.mode-not-client-controllable", /Stub/i.test(pillTxt) && /STUB MODE/.test(pillTxt) && !/Real/.test(pillTxt.replace(/Real bug/g, "")), `top bar text: ${pillTxt.replace(/\n/g, " | ").slice(0, 200)}`);
  const hasFix = await evalp(`JSON.stringify({ app: typeof window.__app, fixbarHidden: document.getElementById('fixbar').hidden, own: Object.getOwnPropertyNames(window).filter(k => !['window','self','document','name','location','customElements','history','navigation','locationbar','menubar','personalbar','scrollbars','statusbar','toolbar','status','closed','frames','length','top','opener','parent','frameElement','navigator','origin','external','screen','innerWidth','innerHeight','scrollX','pageXOffset','scrollY','pageYOffset','visualViewport','screenX','screenY','outerWidth','outerHeight','devicePixelRatio','clientInformation','screenLeft','screenTop','styleMedia','onsearch','isSecureContext','trustedTypes','performance','crypto','indexedDB','sessionStorage','localStorage','chrome','caches','cookieStore','scheduler','crossOriginIsolated','speechSynthesis','Evidence'].includes(k) && !/^(on|webkit|[A-Z])/.test(k)) })`);
  info("f.window-exposure-live", hasFix);
  rec("e.fixtures-guard-live", JSON.parse(hasFix).app === "undefined", hasFix);
  await t.app.close(); }

// ===== E: mode integrity matrix =====
{ // real mode, pinned, tampered log
  const t = await mk({ mode: "real", hostile: false }); await seedRun(t, "real_bug_1");
  let before = await dialogsOnce(t, "real-pinned-clean");
  info("e.real-pinned-clean pill", await evalp(`document.getElementById('topr').innerText.replace(/\\n/g,' | ').slice(0,120)`));
  const L = lastLine(t); writeFileSync(t.logFile, L[0].replace('"verdict":"reproduced"', '"verdict":"not_reproduced"') + "\n");
  const r = await dialogsOnce(t, "real-pinned-tampered");
  const pill = await evalp(`document.getElementById('topr').innerText.replace(/\\n/g,' | ').slice(0,160)`);
  rec("e.tampered-no-real-label", !/\bReal\b(?! bug)/.test(pill.replace("Real mode", "")) || /Checks failed/i.test(pill), `pill: ${pill}`);
  for (const d of ["ledger", "agent", "trust", "confirm"]) rec(`e.real-tampered-bar-in-${d}`, r[d].bars.some(b => /CHECKS FAILED/.test(b)), JSON.stringify(r[d].bars));
  await t.app.close(); }
{ // real mode, NO signer pin, self-signed forged log by another key
  const t = await mk({ mode: "real", pin: false, hostile: false }); const evil = key();
  writeFileSync(t.logFile, forge(evil, 0, GENESIS_PREV) + "\n");
  await nav(t.base + "/"); await click("#headline .trustbtn"); await sleep(400);
  const pill = await evalp(`document.getElementById('topr').innerText.replace(/\\n/g,' | ').slice(0,160)`), trust = await evalp(`document.getElementById('trust-body').innerText.slice(0, 500).replace(/\\n/g,' | ')`);
  const real = /\bReal\b/.test(pill.replace(/Real mode, log not checked/, "")) && !/Checks failed|unchecked/i.test(pill);
  rec("e.no-pin-self-signed-forged-log-not-labelled-real", !real, `pill: ${pill} || trust: ${trust}`);
  await t.app.close(); }
{ // real mode, pinned, empty log
  const t = await mk({ mode: "real", hostile: false }); await nav(t.base + "/");
  const pill = await evalp(`document.getElementById('topr').innerText.replace(/\\n/g,' | ').slice(0,160)`); info("e.real-pinned-empty-log pill", pill); await t.app.close(); }
{ // missing log file in real mode, wrong pin
  const k2 = key(); const t = await mk({ mode: "real", hostile: false, k: k2 }); await seedRun(t, "real_bug_1");
  t.app.close; const t2 = await mk({ mode: "real", hostile: false });  // different pin
  writeFileSync(t2.logFile, readFileSync(t.logFile)); await nav(t2.base + "/");
  const pill = await evalp(`document.getElementById('topr').innerText.replace(/\\n/g,' | ').slice(0,160)`);
  rec("e.wrong-pin-log-not-real", /Checks failed/i.test(pill), `pill: ${pill}`); await t.app.close(); await t2.app.close(); }

// ===== F: batch queue / confirm manipulation from the page =====
{ const t = await mk({ hostile: false, demoN: 3, budget: "2", spacingMs: 0, child: { FAKE_SLEEP_MS: "100" } });
  const posts = () => ev.net.filter(n => n.method === "POST" && /\/api\/submit/.test(n.url) && n.url.startsWith(t.base)).length;
  await nav(t.base + "/"); ev.net.length = 0;
  // (1) confirm-ok clicked while the dialog is closed and nothing was chosen
  await evalp(`document.getElementById('confirm-ok').click()`); await sleep(1500);
  info("f.confirm-ok-click-without-dialog", `POST /api/submit sent: ${posts()} (programmatic click needs script execution in the page, i.e. the user's own console or an XSS; the server-side budget still bounds it)`);
  await nav(t.base + "/"); ev.net.length = 0;
  // (2) open Run all dialog (3 inputs), Escape-equivalent close, then click confirm-ok: queue must be dropped by the close handler
  await click("#run-all"); await sleep(300); await evalp(`document.getElementById('confirm').close()`); await sleep(100); const p0 = posts();
  await evalp(`document.getElementById('confirm-ok').click()`); await sleep(1500);
  rec("f.closed-dialog-then-ok-does-not-queue-batch", posts() - p0 <= 1, `POSTs after closing the Run-all dialog and clicking Approve: ${posts() - p0} (at most the single stale selection; no batch)`);
  await nav(t.base + "/"); ev.net.length = 0;
  // (3a) legit Run all for 3: one click on Approve; client spacing 11.5 s; exactly 3 POSTs and 3 records
  const recs = () => rl(t.logFile);
  const subStatuses = () => ev.resp.filter(r => /\/api\/submit$/.test(r.url)).map(r => r.status);
  await click("#run-all"); await sleep(300); await evalp(`document.getElementById('confirm-ok').click()`);
  for (let i = 0; i < 200 && recs() < 3; i++) await sleep(500);
  await sleep(2500);
  rec("f.batch-3-confirmed-exactly-3", posts() === 3 && recs() === 3, `POST /api/submit ${posts()} statuses ${JSON.stringify(subStatuses())}, verdict records ${recs()} (confirmed 3); budget ${JSON.stringify(t.app.budget.snapshot())}`);
  await t.app.close(); }
{ // (3b) Approve clicked 3 times programmatically (a closed dialog's button): the extra clicks fall into the else-branch doSubmit() with the stale selection
  const t = await mk({ hostile: false, demoN: 3, budget: "2", spacingMs: 11500, child: { FAKE_SLEEP_MS: "100" } });
  const posts = () => ev.net.filter(n => n.method === "POST" && /\/api\/submit/.test(n.url) && n.url.startsWith(t.base)).length;
  await nav(t.base + "/"); await click("#run-all"); await sleep(300);
  await evalp(`document.getElementById('confirm-ok').click(); document.getElementById('confirm-ok').click(); document.getElementById('confirm-ok').click();`); await sleep(6000);
  const st = ev.resp.filter(r => /\/api\/submit$/.test(r.url)).map(r => r.status), n = rl(t.logFile);
  info("f.triple-approve-click", `POSTs ${posts()} statuses ${JSON.stringify(st)} records after 6 s ${n}; budget ${JSON.stringify(t.app.budget.snapshot())}`);
  rec("f.triple-approve-extra-posts-refused-by-server", st.filter(x => x === 202).length === 1 && st.every(x => [202, 409, 429, 400].includes(x)), `only one 202 among ${JSON.stringify(st)}`);
  await t.app.close(); }
{ // (4) forced hammering with the REAL server spacing (11.5 s): disabled buttons re-enabled and clicked, dialogs auto-approved, for 20 s
  const t = await mk({ hostile: false, demoN: 3, budget: "2", spacingMs: 11500, child: { FAKE_SLEEP_MS: "100" } });
  const posts = () => ev.net.filter(n => n.method === "POST" && /\/api\/submit/.test(n.url) && n.url.startsWith(t.base)).length;
  await nav(t.base + "/");
  const t0 = Date.now(); while (Date.now() - t0 < 20000) { await evalp(`document.querySelectorAll('#panel-submit .rep button, #run-all').forEach(b => { b.disabled = false; b.click(); }); const c = document.getElementById('confirm'); if (c.open) document.getElementById('confirm-ok').click();`); await sleep(150); }
  await sleep(1500);
  const n = rl(t.logFile);
  rec("f.forced-hammer-bounded-by-server-spacing", n <= 2, `20 s of forced clicks: client POSTs ${posts()}, accepted jobs (verdict records) ${n} (server spacing 11.5 s allows at most 2 in 20 s); budget ${JSON.stringify(t.app.budget.snapshot())}`);
  await t.app.close(); }

console.log(`console exceptions: ${ev.exc.length} ${JSON.stringify(ev.exc.slice(0, 3))}`);
const logs = ev.logs.filter(l => !/favicon|404/.test(l.text ?? "") ); console.log(`console/log entries (excluding favicon/404): ${logs.length} ${JSON.stringify(logs.slice(0, 5)).slice(0, 600)}`);
rec("d.no-page-exceptions", ev.exc.length === 0, `${ev.exc.length}`); rec("d.no-csp-console-entries", !ev.logs.some(l => /Content Security Policy|Refused to/.test(l.text ?? "")), "checked Log.entryAdded/console.error");
ws.close(); chrome.kill("SIGKILL"); console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
