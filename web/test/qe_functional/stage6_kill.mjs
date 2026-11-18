// Round 3 (11) QE-F-001 / QE-W2-002 live: separate web instance :4043 (NOT launcher-managed), page submits ARVO 42482847 (same bytes already in the log at seq 0 from stage2),
// the instance is SIGTERMed right after the Signed step, then the page is sampled until the NEW record appears. 1 paid request.
import { Browser, openPage, submits, snapshot, banned, Checks, readLog, sleep, stableBalances, delta, saveJson, txInfo } from "./r3.mjs";
import { startInstance } from "./inst.mjs";
const C = new Checks("stage6");
const n0 = readLog().length; const oldRec = readLog().find(r => true); const b0 = await stableBalances();
const k = startInstance(4043, {}, "r3kill");
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:4043/api/config")).ok) break; } catch { /* wait */ } await sleep(250); }
const br = await Browser.launch(9347);
try {
  const p = await openPage(br, "http://127.0.0.1:4043/"); await sleep(900);
  await p.eval(`document.querySelectorAll('#panel-submit .rep')[0].querySelector('button').click()`); await sleep(500); await p.click("#confirm-ok");
  await p.waitFor(`[...document.querySelectorAll('#panel-run .stepper .st')].some(l=>/^Signed, done/.test(l.getAttribute('aria-label')))`, 60000, 50);
  const tk = Date.now(); k.kill("SIGTERM");
  // the page can only read the log back through a web server: bring a fresh instance up on the same port (same run dir) ~2 s after the kill, before the page gives up (12 tries x 2.5 s)
  await sleep(2000); const k2 = startInstance(4043, {}, "r3kill2"); globalThis.k2 = k2;
  const samples = [];
  const end = Date.now() + 70000;
  while (Date.now() < end) {
    const t = await p.eval(`document.getElementById('panel-run').innerText`); const lc = readLog().length;
    samples.push({ ms: Date.now() - tk, lines: lc, t });
    if (lc > n0 && /Bond/.test(t) && !/Checking the chain/.test(t)) break;
    await sleep(400);
  }
  await sleep(1500);
  const last = await p.eval(`({t:document.getElementById('panel-run').innerText, title:document.querySelector('#panel-run .ot')?.innerText, links:[...document.querySelectorAll('#panel-run a')].map(a=>a.href), src:document.querySelector('#panel-run details')?.innerText})`);
  await p.eval(`document.querySelector('#panel-run details').open=true`); const det = await p.eval(`document.getElementById('panel-run').innerText`);
  await p.shot("s6_after_kill");
  console.log("first sample:", JSON.stringify(samples[0]).slice(0, 500)); console.log("last console:\n" + det);
  const all = samples.map(s => s.t).join("\n");
  C.ok(samples.some(s => /Lost the live connection/.test(s.t) && /Checking the chain/.test(s.t)), "page says 'Lost the live connection · Checking the chain'", samples[0].t);
  C.ok(!/no payment was made/i.test(all + last.t + det), "page never says 'no payment was made' after the kill");
  const early = samples.filter(s => s.lines === n0);
  C.ok(early.every(s => !/Bond (returned|forfeited)/.test(s.t)), "before the new record exists (if the window is observable; the stub settles in ~3 s so it may not be), no outcome is shown; the old same-hash seq-0 record is never adopted (see tx check)", `${early.length} early samples`);
  const recs = readLog(); const nw = recs[n0];
  console.log("new record:", nw ? JSON.stringify({ seq: nw.seq, verdict: nw.verdict, settled: nw.settledAtomic, tx: nw.txSignature.slice(0, 12) }) : "NONE", " old seq0 tx:", recs[0].txSignature.slice(0, 12));
  if (nw) {
    C.ok(nw.reportHash === recs[0].reportHash && nw.seq >= n0, "new record has the same hash as the earlier one but a later seq");
    C.ok(/Bond returned/.test(last.title || "") && last.links.some(h => h.includes(nw.txSignature)) && !last.links.some(h => h.includes(recs[0].txSignature)), "outcome read back from the log is the NEW record (tx equals new record, not seq 0)", JSON.stringify(last.links));
    C.ok(/read back from the signed verdict log/i.test(det), "page says the outcome was read back from the signed verdict log");
    const ti = await txInfo(nw.txSignature); C.ok(ti && ti.err === null, "new settle tx confirmed on RPC", JSON.stringify(ti));
  } else C.ok(/UNKNOWN|Still/i.test(last.t), "no new record: page stays UNKNOWN, never invents an outcome", last.t);
  C.ok(banned({ all }).length === 0, "samples have no banned tokens", banned({ all }).join("|"));
  const b1 = await stableBalances(); const d = delta(b0, b1); console.log("kill-test balance delta", JSON.stringify(d));
  C.ok(d.buyer.usdc === 0 && d.payTo.usdc === 0, "kill test: net USDC delta 0 (reproduced stub verdict returns the bond)", JSON.stringify(d));
  saveJson("stage6_samples.json", samples.map(s => ({ ms: s.ms, lines: s.lines, t: s.t.slice(0, 200) })));
  await p.close();
} finally { try { k.kill("SIGKILL"); } catch { /* gone */ } try { globalThis.k2?.kill("SIGTERM"); } catch { /* gone */ } br.close(); }
process.exit(C.done() ? 1 : 0);
