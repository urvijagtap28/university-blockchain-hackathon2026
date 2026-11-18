// Round 3 (4)(5)(6): Run all 5 (confirm total, Cancel, Approve, one at a time >= 11.5 s apart), then an uploaded flaky* file via the real file chooser with a 409 from a second client during the job.
// Paid: 5 (batch) + 1 (flaky upload). Run after stage2_paid on the same stack.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Browser, openPage, submits, snapshot, banned, Checks, readLog, verifyCli, SCRATCH, sleep, stableBalances, delta, saveJson } from "./r3.mjs";
const C = new Checks("stage3");
const n0 = readLog().length;
const b0 = await stableBalances(); saveJson("bal_s3_before.json", b0);
const br = await Browser.launch(9343);
try {
  const p = await openPage(br, "http://127.0.0.1:4030/");
  await sleep(1000);
  // ---- Cancel on Run all
  await p.click("#run-all"); await sleep(500);
  let s = await snapshot(p);
  console.log("--- Run all confirm ---\n" + s.confirm);
  C.ok(/Approve up to 5 payments/.test(s.confirm || ""), "Run all: confirm title");
  C.ok(/\$1\.25/.test(s.confirm) && /5 × \$0\.25/.test(s.confirm), "Run all: total $1.25 = 5 x $0.25", s.confirm);
  C.ok(/\$1\.75 left of \$2\.00/.test(s.confirm) && /\$0\.50 after/.test(s.confirm), "Run all: remaining budget and after-balance shown", s.confirm);
  C.ok(/11\.5 s/.test(s.confirm), "Run all: spacing disclosed");
  C.ok(s.stubBarInDialog.confirm === true, "Run all: stub bar inside confirm dialog");
  await p.shot("s3_runall_confirm");
  await p.click("#confirm-cancel"); await sleep(1500);
  C.ok(submits(p).length === 0 && readLog().length === n0, "Run all Cancel: no /api/submit, no new log record");
  // ---- Approve
  await p.click("#run-all"); await sleep(400); await p.click("#confirm-ok");
  const t0 = Date.now(); let maxBusy = 0, shotMid = false; const seen = [];
  while (Date.now() - t0 < 280000) {
    const info = await p.eval(`({run:document.querySelector('#panel-run .ps-t')?.innerText, btn:document.getElementById('run-all')?.innerText, title:document.querySelector('#panel-run .ot')?.innerText, msg:document.querySelector('#panel-submit .alertbox')?.innerText||null, running:[...document.querySelectorAll('#panel-submit .rep.live')].length})`);
    if (!seen.length || seen[seen.length - 1].run !== info.run || seen[seen.length - 1].title !== info.title) seen.push({ t: Math.round((Date.now() - t0) / 1000), ...info });
    maxBusy = Math.max(maxBusy, info.running);
    if (!shotMid && info.title && /Bond/.test(info.title) && submits(p).length === 2) { shotMid = true; await p.shot("s3_batch_mid"); }
    if (info.btn && /^Run all/.test(info.btn) && submits(p).length >= 5 && info.title) break;
    if (info.msg) break;
    await sleep(500);
  }
  await sleep(2500);
  console.log("batch progression:", JSON.stringify(seen));
  const sub = submits(p); console.log("submit times (s from start):", sub.map(r => ((r.t - t0) / 1000).toFixed(1)).join(", "));
  C.ok(sub.length === 5, "batch: exactly 5 /api/submit calls", sub.length);
  const gaps = sub.slice(1).map((r, i) => (r.t - sub[i].t) / 1000);
  C.ok(gaps.every(g => g >= 11.5), "batch: consecutive submits >= 11.5 s apart", gaps.join(","));
  C.ok(maxBusy <= 1, "batch: never more than one live row", maxBusy);
  const log = readLog().slice(n0); saveJson("batch_records.json", log);
  C.ok(log.length === 5, "batch: 5 new log records", log.length);
  C.ok(log.map(r => r.verdict).join(",") === "reproduced,reproduced,not_reproduced,not_reproduced,not_reproduced", "batch: verdict order reproduced x2, not_reproduced x3 (filename rule)", log.map(r => r.verdict).join(","));
  const spent = log.reduce((a, r) => a + Number(r.settledAtomic), 0);
  const cfg = await (await fetch("http://127.0.0.1:4030/api/config")).json();
  C.ok(spent === 750000 && cfg.session.spentAtomic === String(250000 + spent), "batch: UI session spent == 0.25 (R2) + sum of batch log", `${spent} ${cfg.session.spentAtomic}`);
  const b1 = await stableBalances(); saveJson("bal_s3_batch.json", b1); const d = delta(b0, b1);
  console.log("batch balance delta", JSON.stringify(d));
  C.ok(d.buyer.usdc === -spent && d.payTo.usdc === spent, "batch: buyer decrease == receiver increase == sum of settled", JSON.stringify(d));
  s = await snapshot(p);
  console.log("--- board after batch ---\n" + s.body.slice(0, 1500));
  C.ok(/7 reports/.test(s.body) && /3 reproduced/.test(s.body) && /\$1\.00 forfeited/.test(s.body), "summary after batch: 7 reports, 3 reproduced, $1.00 forfeited (R1+2 returned, R2+3 forfeited)");
  C.ok(/Rehearsal: stub verdicts follow/.test(s.body), "headline still rehearsal");
  C.ok(s.tagsNearVerdict.length === 0, "no REAL/HAND-MADE tag beside any verdict pill on the board", JSON.stringify(s.tagsNearVerdict));
  C.ok(banned({ body: s.body }).length === 0, "batch: no banned tokens", banned({ body: s.body }).join("|"));
  await p.shot("s3_batch_done");
  const cur = await p.eval(`document.querySelector('#panel-run .ocard .ot')?.innerText`);
  C.ok(/Bond forfeited/.test(cur || ""), "console ends on the last (forfeited) run", cur);
  saveJson("s3_after_batch_text.json", s);
  // ---- flaky upload with 409 from a second client
  await sleep(13000);
  const flaky = path.join(SCRATCH, "flaky_qe3.bin"); writeFileSync(flaky, "flaky qe round3 input\n");
  const b2 = await stableBalances(); const n1 = readLog().length;
  await p.pickFile(flaky); await sleep(500);
  const rowTxt = await p.eval(`[...document.querySelectorAll('#panel-submit .rep')].pop().innerText`);
  C.ok(/flaky_qe3\.bin/.test(rowTxt) && /YOURS/.test(rowTxt), "uploaded file shows as a YOURS row via the real file chooser", rowTxt);
  await p.runSelected(); await sleep(500);
  s = await snapshot(p); C.ok(/flaky_qe3\.bin \(22 bytes\)/.test(s.confirm || ""), "confirm names the uploaded file", s.confirm);
  const tok = (await (await fetch("http://127.0.0.1:4030/api/config")).json()).csrfToken;
  await p.click("#confirm-ok");
  await p.waitFor(`document.querySelector('#panel-run .st-active, #panel-run .pill.p-chk')`, 20000);
  const hd = { origin: "http://127.0.0.1:4030", "x-csrf-token": tok, "x-demo-input-id": "arvo_42482847", "content-type": "application/octet-stream" };
  const r409 = await fetch("http://127.0.0.1:4030/api/submit", { method: "POST", headers: hd, body: new Uint8Array(0) }); const j409 = await r409.json().catch(() => ({}));
  C.ok(r409.status === 409, "second client during a job gets 409 busy", `${r409.status} ${JSON.stringify(j409)}`);
  await p.waitFor(`document.querySelector('#panel-run .ocard .ot') && !document.querySelector('#panel-run .pill.p-chk')`, 120000); await sleep(1500);
  const logF = readLog().slice(n1); const recF = logF[0];
  C.ok(logF.length === 1 && recF.verdict === "inconclusive" && String(recF.settledAtomic) === "0", "flaky upload: one record, inconclusive, settled 0 (409 added no record)", JSON.stringify(logF.map(r => [r.verdict, r.settledAtomic])));
  const ct = await p.eval(`({t:document.querySelector('#panel-run .ot').innerText, sub:document.querySelector('#panel-run .os')?.innerText, hero:document.querySelector('#panel-run .ocard .amt')?.innerText, ev:document.querySelector('#panel-run .ocard .evd')?.innerText, cls:document.querySelector('#panel-run .ocard').className, links:[...document.querySelectorAll('#panel-run a')].map(a=>a.href)})`);
  console.log("flaky outcome:", JSON.stringify(ct)); await p.shot("s3_flaky");
  C.ok(/Bond returned/.test(ct.t) && /\$0\.25/.test(ct.hero) && /back to your wallet/.test(ct.hero), "flaky: Bond returned, $0.25 back", JSON.stringify(ct));
  C.ok(!/failed/i.test(ct.t + " " + ct.sub + " " + ct.hero), "flaky: never 'failed' for a returned bond");
  C.ok(ct.links.filter(h => h.includes("explorer")).length === 1 && ct.links.some(h => h.includes(recF.txSignature)), "flaky: one explorer link == log signature");
  const b3 = await stableBalances(); const d3 = delta(b2, b3);
  C.ok(d3.buyer.usdc === 0 && d3.payTo.usdc === 0, "flaky: RPC delta 0", JSON.stringify(d3));
  const cfg2 = await (await fetch("http://127.0.0.1:4030/api/config")).json();
  C.ok(cfg2.session.reservedAtomic === "0" && cfg2.session.spentAtomic === "1000000", "after 409: reserved 0, spent 1,000,000", JSON.stringify(cfg2.session));
  saveJson("bal_s3_after.json", b3);
  console.log("verify-log:", JSON.stringify(verifyCli()));
  await p.close();
} finally { br.close(); }
process.exit(C.done() ? 1 : 0);
