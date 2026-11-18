// Round 2, stage 2: PAID runs through the new UI with real mouse clicks (confirm dialog, file chooser). Main stack on :4030 (scripts/web.sh --stub).
// Paid: R1 demo chip real bug (reproduced/returned), [429 free], R2 demo chip hand-made fake (forfeited) with a second armed tab (409 free),
//       R3 upload flaky_* (inconclusive), R4 upload of manifest bytes under a non-real name (forfeited, labeled from the manifest hash).
// Captures per run: agent per-job decision log (copied while the job runs: the web app deletes it at done), Activity text, stepper sub-lines, outcome card, evidence block, links, balances.
import { writeFileSync, readFileSync, readdirSync, existsSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import { Browser, SCRATCH, ROOT, sleep, stableBalances as balances, delta, saveJson } from "./lib.mjs";
const BASE = "http://127.0.0.1:4030/";
const IN = path.join(SCRATCH, "inputs"); import { mkdirSync } from "node:fs"; mkdirSync(IN, { recursive: true });
writeFileSync(path.join(IN, "flaky_qe2.bin"), "qe round2 flaky upload\n");
copyFileSync(path.join(ROOT, "targets/libucl/inputs/arvo_42482847.poc"), path.join(IN, "plain_poc_qe2.bin"));
const JOBS = path.join(ROOT, "web/run/stub/jobs");
const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl");
const nLog = () => existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).length : 0;
const ev = { runs: [], agentLogMtime0: statSync(path.join(ROOT, "agent/decisions.log")).mtimeMs };
const save = () => saveJson("stage2.json", ev);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// poller: keep the last non-empty content of each per-job decision log
const seen = new Map(); const poll = setInterval(() => { try { for (const f of readdirSync(JOBS)) if (f.endsWith(".decisions.log")) { const t = readFileSync(path.join(JOBS, f), "utf8"); if (t) seen.set(f.replace(".decisions.log", ""), t); } } catch { /* dir may not exist yet */ } }, 40);
const br = await Browser.launch(9336);
await br.constructor; 
let lastEnd = 0;
async function spacing() { const w = lastEnd + 12500 - Date.now(); if (w > 0) { log("spacing wait", w); await sleep(w); } }
const jobIdOf = p => p.eval(`(document.getElementById('panel-run').textContent.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)||[])[0]||null`);
async function openConfirm(p) { await p.click("#submit-btn"); await p.waitFor(`document.getElementById('confirm').open`, 5000); return p.text("#confirm"); }
async function waitDone(p, oldId) { await p.waitFor(`(()=>{const t=document.getElementById('panel-run').textContent;const m=t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);return m&&m[0]!==${JSON.stringify(oldId)}&&[...document.querySelectorAll('#panel-run button')].some(b=>b.textContent==='Submit another')})()`, 150000, 250); lastEnd = Date.now(); }
const snapRun = p => p.eval(`(()=>{const q=s=>[...document.querySelectorAll(s)];
  const steps=q('#panel-run .stepper li').map(li=>({name:li.querySelector('.nm')?.textContent,label:li.getAttribute('aria-label'),subs:[...li.querySelectorAll('.sub')].map(s=>({t:s.textContent,no:s.classList.contains('no')}))}));
  const oc=document.querySelector('#panel-run .ocard');
  const evd=document.querySelector('#panel-run .ocard .evd');
  const cs=evd?getComputedStyle(evd):null;
  return {text:document.getElementById('panel-run').innerText, textFull:document.getElementById('panel-run').textContent, steps, ocardClass:oc?.className, ocardTitle:oc?.querySelector('.ot')?.innerText, ocardSub:oc?.querySelector('.os')?.innerText, hero:[...(oc?.querySelectorAll('.amt .num, .amt .mute')||[])].map(x=>x.textContent),
   evd:evd?{kind:evd.getAttribute('data-evidence'),cls:evd.className,text:evd.innerText,color:cs.color,border:cs.borderLeftColor+'/'+cs.borderLeftWidth,bg:cs.backgroundColor}:null,
   links:q('#panel-run a[href]').map(a=>a.href), details:q('#panel-run details dl dt,#panel-run details dl dd').map(x=>x.textContent)}})()`);
async function run(p, name, selectFn) {
  await spacing(); await p.tab("submit"); await selectFn(p);
  const conf = await openConfirm(p); const b0 = await balances(); const n0 = nLog(); const old = await jobIdOf(p);
  await p.click("#confirm-ok");
  await p.waitFor(`/[0-9a-f]{8}-[0-9a-f]{4}-/.test(document.getElementById('panel-run').textContent)`, 8000, 50);
  const t0 = Date.now();
  // mid-run snapshot once "Signed" step is done
  let mid = null; try { await p.waitFor(`[...document.querySelectorAll('#panel-run .stepper li')].some(li=>/^Signed, done/.test(li.getAttribute('aria-label')))`, 40000, 60); mid = await snapRun(p); await p.shot(`s2_${name}_mid`); } catch { /* maybe skipped */ }
  await waitDone(p, old); await sleep(500);
  const fin = await snapRun(p); await p.shot(`s2_${name}_done`);
  const jobId = fin.textFull.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  const b1 = await balances();
  const recs = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).slice(n0);
  const r = { name, confirm: conf, jobId, seconds: (Date.now() - t0) / 1000, mid, fin, bal: delta(b0, b1), b0, b1, newRecords: recs, agentLog: seen.get(jobId) ?? null };
  ev.runs.push(r); save(); log(name, "title:", fin.ocardTitle, "| hero:", fin.hero.join(" "), "| links", fin.links.length, "| buyer", r.bal.buyer.usdc, "payTo", r.bal.payTo.usdc, "| new recs", recs.length, "| agentLog lines", (r.agentLog ?? "").split("\n").filter(Boolean).length);
  return r;
}
const chip = label => async p => { await p.clickText("label.chip", label); await sleep(300); };
try {
  const p = await br.newPage(BASE);
  // R1
  await run(p, "R1_demo_real", chip("ARVO 42482847"));
  // 429: submit again immediately (free)
  {
    await p.tab("submit"); await chip("Hand made fake near miss")(p); const b0 = await balances(); const n0 = nLog();
    await openConfirm(p); await p.click("#confirm-ok"); await sleep(1200);
    ev.t429 = { text: await p.text("#panel-submit"), shot: await p.shot("s2_429"), logDelta: nLog() - n0, bal: delta(b0, await balances()), activeTab: await p.eval(`document.querySelector('[role=tab][aria-selected=true]').id`) };
    save(); log("429:", JSON.stringify(ev.t429.text.split("\n").filter(x => /429|Rate/.test(x))), "logDelta", ev.t429.logDelta);
  }
  // R2 with an armed second tab (409)
  {
    await spacing(); await p.tab("submit"); await chip("Hand made fake near miss")(p);
    const p2 = await br.newPage(BASE); await p2.tab("submit"); await chip("Hand made fake random")(p2); await openConfirm(p2);
    const conf = await openConfirm(p); const b0 = await balances(); const n0 = nLog(); const old = await jobIdOf(p);
    await p.click("#confirm-ok");
    await p.waitFor(`/[0-9a-f]{8}-[0-9a-f]{4}-/.test(document.getElementById('panel-run').textContent)`, 8000, 40);
    const t0 = Date.now();
    await p2.click("#confirm-ok"); await sleep(900);
    ev.t409 = { text: await p2.text("#panel-submit"), shot: await p2.shot("s2_409_tab2"), at: Date.now() - t0 };
    await p2.close();
    let mid = null; try { await p.waitFor(`[...document.querySelectorAll('#panel-run .stepper li')].some(li=>/^Signed, done/.test(li.getAttribute('aria-label')))`, 40000, 60); mid = await snapRun(p); } catch { /* */ }
    await waitDone(p, old); await sleep(500);
    const fin = await snapRun(p); await p.shot("s2_R2_demo_fake_done");
    const jobId = fin.textFull.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
    const b1 = await balances(); const recs = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).slice(n0);
    const r = { name: "R2_demo_fake", confirm: conf, jobId, mid, fin, bal: delta(b0, b1), b0, b1, newRecords: recs, agentLog: seen.get(jobId) ?? null };
    ev.runs.push(r); save(); log("R2 title:", fin.ocardTitle, "| hero:", fin.hero.join(" "), "| buyer", r.bal.buyer.usdc, "payTo", r.bal.payTo.usdc, "| new recs", recs.length);
    log("409 text:", JSON.stringify(ev.t409.text.split("\n").filter(x => /409|Busy|busy/.test(x))), "new recs", recs.length);
  }
  // R3 flaky upload via file chooser
  await run(p, "R3_flaky_upload", async q => { await q.pickFile(path.join(IN, "flaky_qe2.bin")); });
  // R4 poc bytes under a non-real name
  await run(p, "R4_poc_plainname", async q => { await q.pickFile(path.join(IN, "plain_poc_qe2.bin")); });
  ev.final = await balances(); ev.agentLogMtime1 = statSync(path.join(ROOT, "agent/decisions.log")).mtimeMs; save(); log("stage2 done");
} catch (e) { console.error("STAGE2 ERROR", e); ev.error = String(e); save(); process.exitCode = 1; }
finally { clearInterval(poll); br.close(); }
