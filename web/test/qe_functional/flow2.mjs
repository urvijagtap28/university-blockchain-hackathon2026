// QE_FUNCTIONAL flow 2 (STUB mode, devnet, 4030), continues flow1 (evidence1.json): flaky inconclusive + REAL UI-click 409 from an armed second tab,
// non-demo upload of a manifest real_bug file under a non-real name (forfeit, 'wrongly forfeited' = 1, labeled), demo input real_bug via radio at 500 px width.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Browser, SCRATCH, ROOT, sleep, stableBalances as balances, delta, saveJson, loadJson } from "./lib.mjs";
const BASE = "http://127.0.0.1:4030/";
const IN = path.join(SCRATCH, "inputs");
const F = { flaky: path.join(IN, "flaky_qe_c.bin"), poc: path.join(IN, "arvo_42482847.poc") };
const ev = loadJson("evidence1.json");
const save = () => saveJson("evidence1.json", ev);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const br = await Browser.launch(9334);
let lastEnd = Number(process.env.LAST_END || 0);
async function spacing() { const w = lastEnd + 12500 - Date.now(); if (w > 0) { log("spacing wait", w, "ms"); await sleep(w); } }
const jobId = p => p.eval(`(document.getElementById('panel-run').innerText.match(/job ([0-9a-f-]{36})/)||[])[1]||null`);
async function waitNewDone(p, oldId) { await p.waitFor(`(()=>{const t=document.getElementById('panel-run').innerText;const m=t.match(/job ([0-9a-f-]{36})/);return m&&m[1]!==${JSON.stringify(oldId)}&&[...document.querySelectorAll('#panel-run button')].some(b=>b.textContent==='Submit another')})()`, 120000, 250); lastEnd = Date.now(); }
async function confirmOpen(p) { await p.click("#submit-btn"); await p.waitFor(`document.getElementById('confirm').open`, 5000); }
async function capture(p, name, b0, extra = {}) {
  await sleep(400);
  const run = await p.text("#panel-run"); const links = await p.eval(`[...document.querySelectorAll('#panel-run a[href]')].map(a=>a.href)`);
  await p.shot(name); const b1 = await balances();
  const s = { name, run, links, bal: delta(b0, b1), b0, b1, ...extra }; ev.steps.push(s); save(); log(name, "links", links.length, JSON.stringify(s.bal.buyer), JSON.stringify(s.bal.payTo)); return s;
}
try {
  const p = await br.newPage(BASE);
  // ---- paid 3: flaky, with a REAL UI-click 409 from tab 2 while the job runs ----
  {
    await p.tab("submit"); await p.pickFile(F.flaky); 
    const p2 = await br.newPage(BASE); await p2.tab("submit"); await p2.pickFile(F.flaky); await confirmOpen(p2);
    await confirmOpen(p); const b0 = await balances();
    const old = await jobId(p);
    await p.click("#confirm-ok");
    await p.waitFor(`/job [0-9a-f-]{36}/.test(document.getElementById('panel-run').innerText)`, 8000, 50);
    await p2.click("#confirm-ok"); await sleep(900);
    const t409 = await p2.text("#panel-submit"); await p2.shot("04_409_tab2");
    ev.t409 = t409.split("\n").filter(x => /409|Busy|busy/.test(x)); save(); log("409 lines:", JSON.stringify(ev.t409));
    await waitNewDone(p, old); await capture(p, "p3_flaky_inconclusive", b0, { t409: ev.t409 }); await p2.close();
  }
  // ---- paid 4: manifest real_bug bytes uploaded under a NON-real name -> forfeited; labeled in Results; wrongly forfeited 1 ----
  {
    await spacing(); await p.tab("submit"); await p.pickFile(F.poc); await confirmOpen(p); const b0 = await balances(); const old = await jobId(p);
    await p.click("#confirm-ok"); await waitNewDone(p, old); await capture(p, "p4_poc_upload_forfeited", b0);
  }
  // ---- paid 5: demo input (radio) real_bug, confirm dialog at 500 px width ----
  {
    await spacing(); await p.tab("submit");
    const val = await p.eval(`document.querySelector('input[name=demo]').value`);
    await p.click(`input[name=demo][value="${val}"]`); await sleep(300);
    await confirmOpen(p);
    await p.resize(500, 900); await sleep(500);
    const dlg = await p.eval(`(()=>{const d=document.getElementById('confirm');const r=d.getBoundingClientRect();const o=document.getElementById('confirm-ok'), c=document.getElementById('confirm-cancel');const rb=x=>{const b=x.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,topHit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===x}};return {vw:innerWidth,vh:innerHeight,sw:document.documentElement.scrollWidth,dlg:{x:r.x,y:r.y,w:r.width,h:r.height},ok:rb(o),cancel:rb(c),text:d.innerText}})()`);
    ev.narrow = dlg; save(); await p.shot("05_confirm_500px"); log("narrow", JSON.stringify(dlg).slice(0, 300));
    const b0 = await balances(); const old = await jobId(p);
    await p.click("#confirm-ok");     // click at 500 px: usable?
    await waitNewDone(p, old); await p.shot("05_run_500px");
    ev.narrowRunSw = await p.eval(`document.documentElement.scrollWidth`);
    await p.resize(1100, 900); await capture(p, "p5_demo_real_returned", b0, { demoValue: val });
  }
  ev.bal2 = await balances(); ev.lastEnd = lastEnd; save(); log("flow2 done");
} catch (e) { console.error("FLOW2 ERROR", e); ev.error2 = String(e); save(); process.exitCode = 1; }
finally { br.close(); }
