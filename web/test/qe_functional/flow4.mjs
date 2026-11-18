// QE_FUNCTIONAL flow 4 (no payments): maintainer inbox notes via real clicks/typing on :4030; reload persistence; fixture-mode text for states that cannot be forced live.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Browser, ROOT, sleep, saveJson } from "./lib.mjs";
const PORT = process.argv[2] || "4030"; const BASE = `http://127.0.0.1:${PORT}/`;
const br = await Browser.launch(9336); const out = {};
const items = p => p.eval(`[...document.querySelectorAll('#panel-inbox .panel')].map(c=>({hash:(c.innerText.match(/proof hash\\s*([0-9a-f]{64})/)||[])[1],triage:c.querySelector('p.fn:not(:last-child)')?.innerText,text:c.innerText}))`);
try {
  const p = await br.newPage(BASE); await p.tab("inbox");
  out.before = (await items(p)).map(i => ({ h: i.hash?.slice(0, 8), triage: (i.text.match(/(Not triaged yet\.|Triage: [^\n]*)/) || [])[1] }));
  async function note(idx, btn, txt) {
    await p.eval(`(()=>{const c=[...document.querySelectorAll('#panel-inbox .panel')][${idx}];const i=c.querySelector('input[type=text]');i.focus();i.value='';})()`);
    const r = await p.eval(`(()=>{const c=[...document.querySelectorAll('#panel-inbox .panel')][${idx}];const i=c.querySelector('input[type=text]');const b=i.getBoundingClientRect();i.scrollIntoView({block:'center'});const bb=i.getBoundingClientRect();return {x:bb.x+10,y:bb.y+bb.height/2}})()`);
    await p.clickXY(r.x, r.y); await p.c.send("Input.insertText", { text: txt });
    await p.eval(`(()=>{const c=[...document.querySelectorAll('#panel-inbox .panel')][${idx}];[...c.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(btn)}).setAttribute('data-qe','1')})()`); await p.click("[data-qe='1']"); await sleep(800);
  }
  await note(0, "Valid", "qe note on newest <b>x</b>"); await note(2, "Misuse", "qe note on oldest");
  out.afterClick = (await items(p)).map(i => ({ h: i.hash?.slice(0, 8), triage: (i.text.match(/(Not triaged yet\.|Triage: [^\n]*)/) || [])[1] }));
  await p.shot("f4_inbox_after_notes");
  await p.goto(BASE + "?tab=inbox"); await sleep(800);
  out.afterReload = (await items(p)).map(i => ({ h: i.hash?.slice(0, 8), triage: (i.text.match(/(Not triaged yet\.|Triage: [^\n]*)/) || [])[1] }));
  out.bold = await p.eval(`document.querySelectorAll('#panel-inbox b').length`);
  out.api = await p.eval(`fetch('/api/inbox').then(r=>r.json()).then(j=>j.items.map(i=>({h:i.reportHash.slice(0,8),v:i.verdict,note:i.note&&i.note.decision})))`);
  out.notesFile = existsSync(path.join(ROOT, "web/data/notes.jsonl")) ? readFileSync(path.join(ROOT, "web/data/notes.jsonl"), "utf8").split("\n").filter(Boolean).map(l => { const j = JSON.parse(l); return { h: j.reportHash.slice(0, 8), d: j.decision, t: j.text }; }) : null;
  saveJson('flow4_notes.json', out);
  // fixtures (no backend, no money): text for states we cannot force live
  out.fixtures = {};
  for (const sc of ["success_returned", "success_forfeited", "refused", "settlement_pending", "error", "busy", "budget_exhausted", "rate_limited", "too_large"]) {
    const f = await br.newPage(`file://${ROOT}/web/public/index.html?fixtures=1&scenario=${sc}&delay=60&tab=submit`); await f.tab("submit");
    await f.eval(`window.__app.pick(${sc === "success_forfeited" ? 2 : 0})`); await sleep(200);
    await f.click("#submit-btn"); await f.waitFor(`document.getElementById('confirm').open`, 4000); await f.click("#confirm-ok"); await sleep(2500);
    out.fixtures[sc] = { run: await f.text("#panel-run"), submit: await f.text("#panel-submit") }; await f.shot("f4_fixture_" + sc); await f.close();
  }
  saveJson("flow4.json", out); console.log(JSON.stringify({ before: out.before, afterClick: out.afterClick, afterReload: out.afterReload, bold: out.bold, notesFile: out.notesFile }, null, 1));
} catch (e) { console.error("FLOW4 ERROR", e); process.exitCode = 1; } finally { br.close(); }
