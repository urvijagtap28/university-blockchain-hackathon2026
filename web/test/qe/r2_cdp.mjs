// QE round 2: headless Chrome (CDP, loopback) against LIVE createApp instances. No keys, no payments, fake agent.
//  Phase A: Overview/Ledger/Inbox/Activity/Agent with hostile labels, hostile D-019 facts, and a TAMPERED + hostile-shaped verdict log:
//           window.__xss unset, no injected elements, CSP violations, network log (only the instance's own origin), clipboard copy content, banners.
//  Phase B: dropped-connection read-back with a STALE page log (same proof submitted earlier): does the UI show the OLD record as this run's outcome?
// Usage: env -i node web/test/qe/r2_cdp.mjs <shots-dir> [cdp-port=9471] [web-port=4076]
import { spawn } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [shots, cport = "9471", wport0 = "4076"] = process.argv.slice(2); mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32), KP = base58.encode(Buffer.concat([seed, pub]));
const dir = mkdtempSync(path.join(os.tmpdir(), "r2cdp-"));
const X = '<img src=x onerror="window.__xss=1">', S = "<script>window.__xss=1</script>";
const TX = "49hbmUddNRyJ4RAfSrM66fEx1WYkHWeShiMH1kNpDYRVCG7jB9WvAvXywXBWTsV8SdScd6qWDLxtuTr75fZ8MJxT";
function mkApp(sub, port, extra, demoLabel, mode = "stub") {
  const d = path.join(dir, sub); mkdirSync(d, { recursive: true }); const logFile = path.join(d, "verdicts.jsonl"), proof = path.join(d, "proof.bin"); writeFileSync(proof, "r2 proof bytes " + sub);
  const sha = createHash("sha256").update("r2 proof bytes " + sub).digest("hex");
  const ex = { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: KP, ...extra };
  const app = createApp({ mode, runDir: d, logFile, notesFile: path.join(d, "n.jsonl"), env: { AGENT_SVM_PRIVATE_KEY: "CANARYSECRETKEY" + "Q".repeat(50) }, signerPub: base58.encode(pub), buyerAddr: X, payTo: S, spacingMs: 0,
    agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: d, timing: { waitDoneMs: 20000, waitSignedMs: 20000, pollMs: 100, agentTimeoutMs: 30000 }, extraChildEnv: ex,
    demoInputs: [{ id: "real_proof", label: demoLabel, category: "real_bug", handMade: false, sizeBytes: 20, abs: proof, sha }] });
  return { app, ex, logFile, sha, port, base: `http://127.0.0.1:${port}`, H: { host: `127.0.0.1:${port}` } };
}
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${cport}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${path.join(dir, "prof")}`, "--window-size=1200,1000", "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let tgt; for (let i = 0; i < 60 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch(`http://127.0.0.1:${cport}/json`)).json()).find(x => x.type === "page"); } catch {} }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pend = new Map(), events = [];
ws.addEventListener("message", m => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else events.push(j); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async n => writeFileSync(path.join(shots, n), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__csp=[]; window.__clip=[]; document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+String(e.blockedURI).slice(0,80)));
  try{ Object.defineProperty(navigator,'clipboard',{value:{writeText:t=>{window.__clip.push(String(t));return Promise.resolve()}},configurable:true}) }catch(e){}` });

// ================= Phase A =================
const A = mkApp("a", Number(wport0), { FAKE_HOSTILE: "1", FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", FAKE_DETAIL: "case 1, 5 B input: vul 3/3 heap-buffer-overflow at ucl_lex ucl_parser.c:1036; fixed build clean" }, "<b id=injected>L</b>" + X + S);
await A.app.listen(A.port);
const submitApi = async (t, extraH = {}) => { const r = await fetch(t.base + "/api/submit", { method: "POST", headers: { ...t.H, origin: t.base, "x-csrf-token": t.app.token, "x-demo-input-id": "real_proof", ...extraH } }); const j = await r.json(); await (await fetch(`${t.base}/api/jobs/${j.jobId}/events`, { headers: t.H })).text(); await sleep(100); return j; };
await submitApi(A); await submitApi(A);
// tamper: break record 0's signature with a payload and append hostile-shaped unsigned records
let lines = readFileSync(A.logFile, "utf8").split("\n").filter(Boolean);
const r0 = JSON.parse(lines[0]); r0.detail = X + S + " heap-buffer-overflow at ucl_lex <b id=injected>"; lines[0] = JSON.stringify(r0);
const hostile = [
  { seq: "9", reportHash: "$(touch /tmp/r2_pwn_should_not_exist)", verdict: "reproduced", detail: S + "A".repeat(100000), settledAtomic: { a: 1 }, settlementStatus: "<b>", txSignature: X, timestamp: "<svg onload=window.__xss=1>", caseId: "<b>", targetCommit: "x".repeat(5000) },
  { seq: 3, reportHash: "ab".repeat(32), verdict: "__proto__", detail: null, settledAtomic: "250000", settlementStatus: "settled", txSignature: TX, timestamp: 1e30 },
  { seq: 4, verdict: "inconclusive", reportHash: 123, detail: ["x"], settledAtomic: -1, timestamp: "2026-01-01T00:00:00Z" },
  { seq: 5, reportHash: "cd".repeat(32), verdict: "reproduced", detail: "javascript:window.__xss=1 ‮RTL\u0000nul", settledAtomic: "250000", settlementStatus: "settled", txSignature: "1".repeat(88), timestamp: "x" }];
writeFileSync(A.logFile, lines.concat(hostile.map(h => JSON.stringify(h))).join("\n") + "\n");
const log = await (await fetch(A.base + "/api/log", { headers: A.H })).json();
ok(!log.verify.ok, `A: tampered log: /api/log verify.ok=${log.verify.ok}, verified ${log.verify.verified}/${log.records.length}`);
const tabs = ["overview", "submit", "run", "results", "inbox", "policy"];
const probe = `(() => { const t = document.body.innerText; return JSON.stringify({ xss: window.__xss ?? null, bad: document.querySelectorAll('img,svg:not(.ic),script:not([src]),#injected,a[href^="javascript"],[onerror],[onload],iframe,object,embed,link[rel=stylesheet][href^=http]').length, banner: document.getElementById('banners').innerText.slice(0,120), csp: window.__csp, len: t.length }); })()`;
await send("Page.navigate", { url: A.base + "/" }); await sleep(1500);
for (const t of tabs) {
  await ev(`document.getElementById('tab-${t}').click()`); await sleep(500);
  if (t === "results") { await ev(`document.querySelectorAll('#panel-results .exp').forEach(b => b.click())`); await sleep(300); }
  if (t === "inbox") { await ev(`document.querySelectorAll('#panel-inbox .hashbtn').forEach(b => b.click())`); await sleep(400); await ev(`document.querySelectorAll('#panel-inbox details summary, #panel-inbox [aria-expanded=false]').forEach(b => b.click())`); }
  const r = JSON.parse(await ev(probe)); const hasBanner = /log|verif|tamper|check/i.test(r.banner);
  ok(r.xss === null && r.bad === 0 && r.csp.length === 0, `A tab:${t}: window.__xss=${r.xss}, injected/dangerous elements=${r.bad}, CSP violations=${JSON.stringify(r.csp)}, banner="${r.banner.replace(/\n/g, " ")}" (tamper banner shown: ${hasBanner})`);
  if (t === "overview" || t === "results" || t === "inbox") await shot(`r2_A_${t}.png`);
}
// Activity: UI-driven run with hostile facts through the confirm dialog (fresh job)
await ev(`document.getElementById('tab-submit').click()`); await sleep(300); await ev(`document.querySelector('input[name=demo]').click()`); await sleep(200);
await ev(`document.getElementById('submit-btn').click()`); await sleep(300); await ev(`document.getElementById('confirm-ok').click()`); await sleep(3500);
const ra = JSON.parse(await ev(probe)); ok(ra.xss === null && ra.bad === 0 && ra.csp.length === 0, `A run (hostile D-019 facts via UI): __xss=${ra.xss}, bad elements ${ra.bad}, CSP ${JSON.stringify(ra.csp)}`);
console.log("run panel text:", (await ev(`document.getElementById('panel-run').innerText.slice(0,500)`)).replace(/\n/g, " | ")); await shot("r2_A_run.png");
const clip = JSON.parse(await ev(`JSON.stringify(window.__clip.map(s => ({ len: s.length, head: s.slice(0, 40) })))`));
console.log("clipboard writes:", JSON.stringify(clip));
const okClip = clip.length > 0 && clip.every(c => c.len === 64 && /^[0-9a-f]+$/.test(c.head.slice(0, 40)));
ok(clip.length > 0 && clip.some(c => c.len === 64), `A clipboard: ${clip.length} copy click(s) captured; copies of valid 64-hex hashes present: ${clip.some(c => c.len === 64)}`);
ok(clip.every(c => c.len === 64), `A clipboard: EVERY copy is a 64-char hash: ${okClip ? "yes" : "NO, hostile reportHash from the tampered log was copied verbatim: " + JSON.stringify(clip.filter(c => c.len !== 64))}`);
const reqs = events.filter(e => e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
const ext = reqs.filter(u => !u.startsWith(A.base + "/") && !u.startsWith("data:") && !u.startsWith("about:"));
ok(ext.length === 0, `A network log: ${reqs.length} requests, non-origin: ${JSON.stringify(ext)}`);
const exc = events.filter(e => e.method === "Runtime.exceptionThrown").map(e => (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text).split("\n")[0].slice(0, 160));
console.log(`INFO A page exceptions during hostile-shaped log rendering: ${exc.length} ${JSON.stringify([...new Set(exc)]).slice(0, 600)}`);
await A.app.close();

// ================= Phase B: stale-log read-back =================
events.length = 0;
const B = mkApp("b", Number(wport0) + 1, { FAKE_VERDICT: "not_reproduced", FAKE_SETTLED: "250000", FAKE_DETAIL: "case 1, 20 B input: vul 3/3 clean" }, "real proof");
await B.app.listen(B.port);
await send("Page.navigate", { url: B.base + "/" }); await sleep(1500); // page loads an EMPTY log: its baseSeq is 0
await submitApi(B); // another client submitted the same proof: record seq 0, forfeited $0.25
const l1 = await (await fetch(B.base + "/api/log", { headers: B.H })).json(); ok(l1.records.length === 1 && l1.records[0].settledAtomic === "250000", "B: earlier record seq 0 same proof hash, forfeited 250000");
Object.assign(B.ex, { FAKE_SLEEP_MS: "9000", FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", FAKE_DETAIL: "case 1, 20 B input: vul 3/3 heap-buffer-overflow at f a.c:1; fixed build clean" });
await send("Fetch.enable", { patterns: [{ urlPattern: "*/events", requestStage: "Request" }] });
const pump = setInterval(() => { while (events.length) { const j = events.shift(); if (j.method === "Fetch.requestPaused") { const jobId = /jobs\/([0-9a-f-]+)\/events/.exec(j.params.request.url)[1];
  const body = `id: 0\nevent: started\ndata: ${JSON.stringify({ jobId, reportHash: B.sha })}\n\n`;
  send("Fetch.fulfillRequest", { requestId: j.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/event-stream" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(body).toString("base64") }); } } }, 20);
await ev(`document.getElementById('tab-submit').click()`); await sleep(200); await ev(`document.querySelector('input[name=demo]').click()`); await sleep(200);
await ev(`document.getElementById('submit-btn').click()`); await sleep(300); await ev(`document.getElementById('confirm-ok').click()`);
await sleep(5500); // recover() polls at 2.5 s: the new job's own record is not written until ~9 s
const mid = await ev(`document.getElementById('panel-run').textContent`); await shot("r2_B_mid.png");
const settledMid = /Bond forfeited|forfeit|Not reproduced|\$0\.25/.test(mid) && /read back from the signed verdict log/.test(mid);
console.log("B run panel at ~5.5 s (job 2's record not yet written):", mid.replace(/\s+/g, " ").slice(0, 400));
ok(!settledMid, `B: stale-page read-back at 5.5 s ${settledMid ? "SHOWED AN OUTCOME FROM THE OLD seq 0 RECORD (forfeited) while this run's own record did not exist yet" : "did not adopt the older record"}`);
await sleep(9000); const late = await ev(`document.getElementById('panel-run').textContent`); console.log("B run panel at ~15 s:", late.replace(/\s+/g, " ").slice(0, 300));
clearInterval(pump); await send("Fetch.disable"); await B.app.close();
ws.close(); chrome.kill("SIGKILL"); console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
