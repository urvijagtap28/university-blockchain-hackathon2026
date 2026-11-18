// Round 2, stage 3 (free): Overview, Ledger, trust drawer, Inbox, Agent tab, popovers, links, text sanity after the paid runs. Real clicks.
import { Browser, saveJson, sleep } from "./lib.mjs"; import { dumpAll, activeTab } from "./ui.mjs";
const br = await Browser.launch(9337); const out = {};
try {
  const p = await br.newPage("http://127.0.0.1:4030/"); await sleep(1500);
  out.defaultTab = await activeTab(p);
  out.overview = await p.eval(`(()=>({text:document.getElementById('panel-overview').innerText,
    cards:[...document.querySelectorAll('#panel-overview .ovc')].map(c=>({kind:c.getAttribute('data-kind'),cls:c.className,text:c.innerText,links:[...c.querySelectorAll('a[href]')].map(a=>a.href),evd:c.querySelector('[data-evidence]')?.getAttribute('data-evidence')})),
    tiles:[...document.querySelectorAll('#panel-overview .tile')].map(t=>t.innerText.replace(/\\n+/g,' ')),
    trust:document.querySelector('#panel-overview .trustbtn')?.innerText}))()`);
  await p.shot("s3_overview_1280");
  // wrongly-forfeited popover (hover/click the info button in the Not reproduced tile)
  await p.click("#panel-overview .tile.t-forf .info"); await sleep(400);
  out.wrongPop = await p.eval(`[...document.querySelectorAll('.pop')].filter(x=>!x.hidden).map(x=>x.innerText).join(' | ')`); await p.shot("s3_overview_wrongpop"); await p.eval(`document.body.click()`);
  // Ledger
  await p.tab("results"); await sleep(600);
  out.ledger = await p.eval(`(()=>({trust:document.querySelector('#panel-results .trustbtn').innerText, tiles:[...document.querySelectorAll('#panel-results .tile')].map(t=>t.innerText.replace(/\\n+/g,' ')),
    rows:[...document.querySelectorAll('#panel-results tbody tr:not(.drow)')].map(r=>({text:r.innerText.replace(/\\n+/g,' | '),link:r.querySelector('a[href]')?.href||null}))}))()`);
  await p.shot("s3_ledger_collapsed");
  // expand every row with real clicks
  const n = await p.eval(`document.querySelectorAll('#panel-results .exp').length`);
  out.expanded = [];
  for (let i = 0; i < n; i++) { await p.eval(`document.querySelectorAll('#panel-results .exp')[${i}].setAttribute('data-qe','1')`); await p.click("[data-qe='1']"); await p.eval(`document.querySelector('[data-qe]').removeAttribute('data-qe')`); await sleep(150); }
  out.expanded = await p.eval(`[...document.querySelectorAll('#panel-results .drow')].map(r=>({hidden:r.hidden,text:r.innerText.replace(/\\n+/g,' | '),evd:r.querySelector('[data-evidence]')?.getAttribute('data-evidence')}))`);
  await p.shot("s3_ledger_expanded");
  // trust drawer
  await p.click("#trust-btn"); await sleep(500);
  out.trust = await p.text("#trust"); await p.shot("s3_trust_drawer");
  await p.click("#trust-close"); await sleep(300);
  // Inbox
  await p.tab("inbox"); await sleep(600);
  out.inbox = await p.eval(`[...document.querySelectorAll('#panel-inbox article.item')].map(a=>({text:a.innerText.replace(/\\n+/g,' | '),hashTitle:a.querySelector('.hashbtn')?.getAttribute('aria-label'),textFull:a.textContent.slice(0,600)}))`);
  await p.shot("s3_inbox");
  // Agent tab
  await p.tab("policy"); await sleep(500);
  out.agent = await p.eval(`({text:document.getElementById('panel-policy').innerText, chip:document.querySelector('.hostchip')?.innerText, chipTitle:document.querySelector('.hostchip')?.title, meter:document.querySelector('#panel-policy .meter')?.getAttribute('aria-label'), decisions:[...document.querySelectorAll('#panel-policy .tl-list li')].map(l=>l.innerText.replace(/\\n+/g,' | '))})`);
  await p.shot("s3_agent");
  // all explorer links on every tab
  out.links = {};
  for (const t of ["overview", "submit", "run", "results", "inbox", "policy"]) { await p.tab(t); await sleep(300); out.links[t] = await p.eval(`[...document.querySelectorAll('#panel-${t} a[href]')].map(a=>a.href)`); }
  out.dump = await dumpAll(p, "s3_full", false);
  // header popovers: mode and wallet
  await p.click("header .pillbtn"); await sleep(300); out.modePop = await p.eval(`[...document.querySelectorAll('.pop')].filter(x=>!x.hidden).map(x=>x.innerText).join(' | ')`); await p.shot("s3_mode_pop"); await p.eval(`document.body.click()`);
  await p.shot("s3_overview_1280b");
  saveJson("stage3.json", out);
  console.log("default", out.defaultTab); console.log(JSON.stringify(out.overview, null, 1)); console.log("wrongPop", out.wrongPop);
  console.log(JSON.stringify(out.ledger, null, 1)); console.log("expanded", JSON.stringify(out.expanded, null, 1)); console.log("TRUST", out.trust);
  console.log("inbox", JSON.stringify(out.inbox, null, 1)); console.log("agent", JSON.stringify(out.agent, null, 1)); console.log("modePop", out.modePop); console.log("BAD", JSON.stringify(out.dump.bad));
} finally { br.close(); }
