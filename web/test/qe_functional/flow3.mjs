// QE_FUNCTIONAL flow 3 (no payments): read every screen of the running STUB app (port from argv, default 4030) and compare to the log file computed independently.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Browser, SCRATCH, ROOT, sleep, saveJson, loadJson } from "./lib.mjs";
const PORT = process.argv[2] || "4030", TAG = process.argv[3] || "f3";
const BASE = `http://127.0.0.1:${PORT}/`;
const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl");
const br = await Browser.launch(9335);
const out = { tag: TAG };
try {
  const p = await br.newPage(BASE);
  // banners + REAL scan on every tab
  out.tabs = {};
  for (const t of ["submit", "run", "results", "inbox", "policy"]) {
    await p.tab(t);
    out.tabs[t] = await p.eval(`(()=>{const b=document.getElementById('banners');const vis=e=>!!(e&&e.offsetParent!==null||e&&getComputedStyle(e).position==='fixed');const stub=[...b.querySelectorAll('.banner.stub')];return {bannersVisible:vis(b),stubBanner:stub.map(s=>({text:s.textContent,visible:s.getBoundingClientRect().height>0,closeBtn:!!s.querySelector('button')})),bannersInViewport:b.getBoundingClientRect().height>0,panelText:document.getElementById('panel-${t}').innerText,fullBodyReal:[...document.body.innerText.matchAll(/.{0,25}\\bREAL\\b.{0,25}/g)].map(m=>m[0])}})()`);
    await p.shot(`${TAG}_${t}`);
  }
  await p.tab("results");
  out.counts = await p.eval(`[...document.querySelectorAll('#panel-results .count')].map(c=>({n:c.querySelector('.n').innerText,l:c.querySelector('.l').innerText,x:c.querySelector('.x')?.innerText}))`);
  out.cards = await p.eval(`[...document.querySelectorAll('#panel-results .card')].map(c=>({text:c.innerText,links:[...c.querySelectorAll('a[href]')].map(a=>a.href),tag:c.querySelector('.tag')?.innerText}))`);
  out.trust = await p.eval(`(()=>{const hs=[...document.querySelectorAll('#panel-results h2')];const th=hs.find(h=>h.textContent==='Trust');return th.nextElementSibling.innerText})()`);
  out.verifiedLine = await p.eval(`document.querySelector('#panel-results .outcome')?.innerText`);
  out.resultsLinks = await p.eval(`[...document.querySelectorAll('#panel-results a[href]')].map(a=>a.href)`);
  out.allLinks = {}; for (const t of ["submit", "run", "results", "inbox", "policy"]) out.allLinks[t] = await p.eval(`[...document.querySelectorAll('#panel-${t} a[href]')].map(a=>a.href)`);
  await p.tab("inbox");
  out.inbox = await p.eval(`[...document.querySelectorAll('#panel-inbox .panel')].map(c=>({text:c.innerText,hash:(c.innerText.match(/proof hash\\s*([0-9a-f]{64})/)||[])[1]||null}))`);
  out.api = { log: await p.eval(`fetch('/api/log').then(r=>r.json())`), inbox: await p.eval(`fetch('/api/inbox').then(r=>r.json())`), config: await p.eval(`fetch('/api/config').then(r=>r.json()).then(c=>({mode:c.mode,session:c.session,busy:c.busy}))`) };
  await p.tab("policy"); out.policy = await p.text("#panel-policy");
  saveJson(`flow3_${TAG}.json`, out); console.log("saved", TAG, JSON.stringify(out.counts?.map(c => c.n)), out.verifiedLine);
} catch (e) { console.error("FLOW3 ERROR", e); process.exitCode = 1; } finally { br.close(); }
