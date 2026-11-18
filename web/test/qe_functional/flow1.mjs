// QE_FUNCTIONAL flow 1 (STUB mode, devnet, 4030): empty state, real* returned, 429, forfeited + 409 from a second armed tab, flaky inconclusive.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Browser, SCRATCH, ROOT, sleep, balances, delta, saveJson, loadJson } from "./lib.mjs";
import { existsSync } from "node:fs";
const BASE = "http://127.0.0.1:4030/";
const IN = path.join(SCRATCH, "inputs"); mkdirSync(IN, { recursive: true });
const mk = (n, s) => { const f = path.join(IN, n); writeFileSync(f, s); return f; };
const F = { real: mk("real_qe_a.bin", "qe functional real-prefixed input A\n"), fake: mk("fake_qe_b.txt", "qe functional non-real input B\n"), flaky: mk("flaky_qe_c.bin", "qe functional flaky input C\n"),
  poc: path.join(IN, "arvo_42482847.poc") };
writeFileSync(F.poc, (await import("node:fs")).readFileSync(path.join(ROOT, "targets/libucl/inputs/arvo_42482847.poc")));
const ev = existsSync(path.join(SCRATCH, "evidence1.json")) ? loadJson("evidence1.json") : { steps: [] };
const save = () => saveJson("evidence1.json", ev);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const br = await Browser.launch(9333);
let lastEnd = 0;
async function spacing() { const w = lastEnd + 12500 - Date.now(); if (w > 0) { log("spacing wait", w, "ms"); await sleep(w); } }
const panelsText = async p => { const o = {}; for (const t of ["submit", "run", "results", "inbox", "policy"]) o[t] = await p.eval(`document.getElementById('panel-${t}').innerText`); o.banners = await p.eval(`document.getElementById('banners').innerText`); return o; };
async function waitRunDone(p) { await p.waitFor(`[...document.querySelectorAll('#panel-run button')].some(b=>b.textContent==='Submit another')`, 120000, 250); lastEnd = Date.now(); }
async function selectFile(p, f) { await p.tab("submit"); await p.pickFile(f); }
async function confirmAndGo(p) { await p.click("#submit-btn"); await p.waitFor(`document.getElementById('confirm').open`, 5000); }
try {
  const p = await br.newPage(BASE);
  // ---- (1) empty state ----
  const empty = {};
  for (const t of ["submit", "run", "results", "inbox", "policy"]) { await p.tab(t); empty[t] = await p.text("#panel-" + t); empty[t + "_banner"] = await p.text("#banners"); await p.shot("01_empty_" + t); }
  empty.config = await p.eval(`fetch('/api/config').then(r=>r.json()).then(c=>({mode:c.mode,session:c.session,demo:c.demoInputs.length}))`);
  empty.log = await p.eval(`fetch('/api/log').then(r=>r.json())`); empty.inbox = await p.eval(`fetch('/api/inbox').then(r=>r.json())`);
  ev.empty = empty; save(); log("empty state captured", JSON.stringify(empty.log.verify), JSON.stringify(empty.inbox));

  const bal0 = await balances(); ev.bal0 = bal0;
  // ---- paid 1: real* returned, via real click path ----
  async function paid(name, file, extra = {}) {
    await spacing();
    const b0 = await balances();
    await selectFile(p, file); await p.shot(`02_${name}_selected`);
    await confirmAndGo(p); await p.shot(`02_${name}_confirm`);
    const ctext = await p.text("#confirm");
    await p.click("#confirm-ok");
    await sleep(800); const mid = await p.text("#panel-run"); await p.shot(`02_${name}_midrun`);
    await waitRunDone(p); await sleep(500);
    const run = await p.text("#panel-run");
    const links = await p.eval(`[...document.querySelectorAll('#panel-run a[href]')].map(a=>a.href)`);
    const bank = await p.text("#banners");
    await p.shot(`02_${name}_done`);
    const b1 = await balances();
    const s = { name, file: path.basename(file), confirmText: ctext, mid, run, links, banners: bank, bal: delta(b0, b1), b0, b1 }; ev.steps.push(s); save();
    log(name, "links", links.length, JSON.stringify(s.bal));
    return s;
  }
  await paid("p1_real_returned", F.real);

  // ---- 429 via the UI click path, immediately after ----
  {
    const b0 = await balances();
    await p.tab("submit"); await confirmAndGo(p); await p.click("#confirm-ok"); await sleep(1200);
    const t = await p.text("#panel-submit"); await p.shot("03_429_ui");
    const log1 = await p.eval(`fetch('/api/log').then(r=>r.json()).then(l=>l.records.length)`);
    const b1 = await balances();
    ev.r429 = { text: t, records: log1, bal: delta(b0, b1) }; save(); log("429", t.split("\n").filter(x => /429|Rate/.test(x)).join(" | "), "records", log1, JSON.stringify(ev.r429.bal));
  }

  // ---- paid 2: fake (forfeited) + 409 from second armed tab ----
  {
    await spacing();
    const p2 = await br.newPage(BASE); await p2.tab("submit"); await p2.pickFile(F.fake); await p2.click("#submit-btn"); await p2.waitFor(`document.getElementById('confirm').open`, 5000);
    const b0 = await balances();
    await selectFile(p, F.fake); await confirmAndGo(p);
    await p.click("#confirm-ok");           // job starts
    await p2.click("#confirm-ok");           // second tab, same instant: should be 409
    await sleep(700);
    const t409 = await p2.text("#panel-submit"); await p2.shot("04_409_tab2");
    const cfgBusy = await p2.eval(`fetch('/api/config').then(r=>r.json()).then(c=>c.busy)`);
    await waitRunDone(p); await sleep(500);
    const run = await p.text("#panel-run"); const links = await p.eval(`[...document.querySelectorAll('#panel-run a[href]')].map(a=>a.href)`);
    await p.shot("04_p2_fake_done");
    const b1 = await balances();
    ev.steps.push({ name: "p2_fake_forfeited", file: "fake_qe_b.txt", run, links, bal: delta(b0, b1), t409, cfgBusyDuring: cfgBusy }); save(); log("p2 done", JSON.stringify(delta(b0, b1)), "409 text:", t409.split("\n").filter(x => /409|Busy/.test(x)).join("|"));
    await p2.close();
  }
  // ---- paid 3: flaky inconclusive ----
  await paid("p3_flaky_inconclusive", F.flaky);
  ev.bal1 = await balances(); save();
  log("flow1 done");
} catch (e) { console.error("FLOW1 ERROR", e); ev.error = String(e); save(); process.exitCode = 1; }
finally { br.close(); }
