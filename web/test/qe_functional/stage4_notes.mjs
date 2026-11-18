// Round 2, stage 4 (free): Inbox notes (set, per-hash isolation, persist across reload and across a second web instance on the same notes file),
// clipboard copy of the proof hash, 500-note cap error text, 1600 px screenshots. Real clicks.
import { readFileSync, existsSync } from "node:fs"; import path from "node:path";
import { Browser, saveJson, sleep, ROOT } from "./lib.mjs"; import { startInstance } from "./inst.mjs";
const NOTES = path.join(ROOT, "web/data/notes.jsonl"); const out = {};
const br = await Browser.launch(9338); let inst = null;
const cards = p => p.eval(`[...document.querySelectorAll('#panel-inbox article.item')].map(a=>({h:a.querySelector('.hashbtn').getAttribute('aria-label').slice(-64),on:[...a.querySelectorAll('.segb.on')].map(b=>b.textContent),text:a.querySelector('input.note-in').value}))`);
try {
  const p = await br.newPage("http://127.0.0.1:4030/"); await sleep(800);
  try { await p.c.send("Browser.grantPermissions", { origin: "http://127.0.0.1:4030", permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] }); out.grant = "ok"; } catch (e) { out.grant = String(e).slice(0, 120); }
  await p.tab("inbox"); await sleep(500);
  out.cards0 = await cards(p);
  // note on card 0 (details open: need the text input; open Details via click)
  await p.eval(`document.querySelectorAll('#panel-inbox article.item')[0].setAttribute('data-qe0','1')`);
  await p.click("[data-qe0='1'] summary"); await sleep(200);
  await p.click("[data-qe0='1'] input.note-in"); await p.c.send("Input.insertText", { text: "qe2 note <b>x</b> for card 0" });
  await p.eval(`document.querySelector("[data-qe0='1'] .segb")`); await p.clickText("[data-qe0='1'] .segb", "Valid"); await sleep(700);
  out.afterNote = await cards(p); await p.shot("s4_inbox_note");
  // reload
  await p.goto("http://127.0.0.1:4030/"); await sleep(800); await p.tab("inbox"); await sleep(600); out.afterReload = await cards(p);
  // file content
  out.file = existsSync(NOTES) ? readFileSync(NOTES, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : null;
  // clipboard copy
  const want = out.cards0[0].h; await p.click("#panel-inbox article.item .hashbtn"); await sleep(400);
  out.copyBtn = await p.eval(`document.querySelector('#panel-inbox .hashbtn').textContent`);
  try { out.clip = await p.eval(`navigator.clipboard.readText()`); } catch (e) { out.clip = "readText failed: " + String(e).slice(0, 100); }
  out.clipEq = out.clip === want; out.clipDiag = { want, clip: out.clip };
  // second instance (restart-like) on the same notes file
  inst = startInstance(4032, {}, "i4032"); await sleep(2500);
  const q = await br.newPage("http://127.0.0.1:4032/"); await q.tab("inbox"); await sleep(700); out.inst2cards = await cards(q); await q.shot("s4_inbox_inst2");
  // per-hash: set a different decision on card 1 via the second instance, check card 0 unchanged
  await q.eval(`document.querySelectorAll('#panel-inbox article.item')[1].setAttribute('data-qe1','1')`);
  await q.clickText("[data-qe1='1'] .segb", "Misuse"); await sleep(700); out.inst2after = await cards(q);
  // 500-note cap via in-page fetch with the real token, then UI error
  const hash0 = out.cards0[0].h;
  out.fill = await q.eval(`(async()=>{const c=await (await fetch('/api/config')).json();let ok=0,last=null;for(let i=0;i<520;i++){const r=await fetch('/api/notes',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':c.csrfToken},body:JSON.stringify({reportHash:${JSON.stringify(hash0)},decision:'valid',text:'fill '+i})});if(r.ok)ok++;else{last={status:r.status,body:await r.json()};break}}return {ok,last}})()`);
  await q.goto("http://127.0.0.1:4032/"); await sleep(600); await q.tab("inbox"); await sleep(500);
  await q.eval(`document.querySelectorAll('#panel-inbox article.item')[1].setAttribute('data-qe2','1')`);
  await q.clickText("[data-qe2='1'] .segb", "Not a bug"); await sleep(800);
  out.capUi = await q.eval(`[...document.querySelectorAll('#panel-inbox .err-t')].map(e=>e.textContent).filter(Boolean)`); await q.shot("s4_inbox_cap");
  out.noteLines = existsSync(NOTES) ? readFileSync(NOTES, "utf8").split("\n").filter(Boolean).length : 0;
  // 1600 px screenshots of the main views
  await p.c.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const t of ["overview", "run", "results", "policy"]) { await p.tab(t); await sleep(500); await p.shot("s4_1600_" + t); }
  saveJson("stage4.json", out); console.log(JSON.stringify(out, null, 1));
} finally { br.close(); try { inst?.kill("SIGTERM"); } catch { /* gone */ } }
