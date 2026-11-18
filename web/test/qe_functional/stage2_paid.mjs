// Round 3 (2)(3): PAID single runs through the single board with real mouse clicks. Main stack on :4030 (scripts/web.sh --stub), log empty at start.
// Paid: R1 row 1 (ARVO 42482847 -> real_bug_1.bin, expect Bond returned), R2 row 3 (hand-made near miss -> fake_3.bin, expect Bond forfeited). Cancel test before R1 (free).
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browser, openPage, submits, snapshot, banned, Checks, readLog, lastLine, verifyCli, ROOT, SCRATCH, sleep, stableBalances, delta, txInfo, saveJson, ADDR } from "./r3.mjs";
const C = new Checks("stage2");
const JOBS = path.join(ROOT, "web/run/stub/jobs");
const b0 = await stableBalances(); saveJson("bal_s2_before.json", b0);
const br = await Browser.launch(9342);
const out = {};
async function runRow(p, idx, tag) {
  const rows = await p.eval(`[...document.querySelectorAll('#panel-submit .rep')].length`);
  await p.eval(`document.querySelectorAll('[data-qe-run]').forEach(x=>x.removeAttribute('data-qe-run'));document.querySelectorAll('#panel-submit .rep')[${idx}].querySelector('button').setAttribute('data-qe-run','1')`);
  await p.click("[data-qe-run='1']"); await sleep(500);
  const dlg = await snapshot(p);
  return { rows, dlg };
}
async function approveAndWatch(p, tag) {
  const decLogs = new Map(); const sc = [];
  const n0 = submits(p).length;
  await p.click("#confirm-ok");
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    if (existsSync(JOBS)) for (const f of readdirSync(JOBS)) if (f.endsWith(".decisions.log")) { try { decLogs.set(f, readFileSync(path.join(JOBS, f), "utf8")); } catch { /* gone */ } }
    const done = await p.eval(`!!document.querySelector('#panel-run .ocard .ot') && !document.querySelector('#panel-run .pill.p-chk')`);
    if (done && Date.now() - t0 > 3000) break;
    await sleep(250);
  }
  await sleep(1500);
  return { decLogs: [...decLogs.values()], submitsSent: submits(p).length - n0 };
}
async function capture(p) {
  return p.eval(`(()=>{const q=s=>document.querySelector(s);const run=q('#panel-run');
    return {console:run.innerText, subs:[...run.querySelectorAll('.st .sub')].map(x=>x.innerText), steps:[...run.querySelectorAll('.stepper .st')].map(x=>x.getAttribute('aria-label')),
      title:q('#panel-run .ot')?.innerText, hero:q('#panel-run .ocard .amt')?.innerText, evd:q('#panel-run .ocard .evd')?.getAttribute('data-evidence'), evdText:q('#panel-run .ocard .evd')?.innerText,
      links:[...run.querySelectorAll('a')].map(a=>a.href), headline:q('#headline').innerText, evidenceStyled:/evd-(crash|clean)/.test(q('#panel-run .ocard .evd')?.className||'')}})()`);
}
try {
  const p = await openPage(br, "http://127.0.0.1:4030/");
  await sleep(1000);
  // ---- Cancel sends nothing
  let r = await runRow(p, 0, "cancel");
  C.ok(r.dlg.confirm && /Approve payment/.test(r.dlg.confirm), "confirm dialog opens on a single Run", r.dlg.confirm);
  C.ok(r.dlg.stubBarInDialog.confirm === true, "stub bar visible inside confirm dialog");
  C.ok(/\$0\.25/.test(r.dlg.confirm) && /\$2\.00 left of \$2\.00/.test(r.dlg.confirm), "confirm shows amount in dollars and budget", r.dlg.confirm);
  console.log("--- confirm dialog text ---\n" + r.dlg.confirm);
  await p.shot("s2_confirm_single");
  await p.click("#confirm-cancel"); await sleep(1500);
  C.ok(submits(p).length === 0, "Cancel: /api/submit never called", JSON.stringify(submits(p)));
  C.ok(readLog().length === 0, "Cancel: no log record");
  const cfgA = await (await fetch("http://127.0.0.1:4030/api/config")).json();
  C.ok(cfgA.session.spentAtomic === "0" && cfgA.session.reservedAtomic === "0", "Cancel: session budget untouched", JSON.stringify(cfgA.session));
  // ---- unpaid probe (decoded PAYMENT-REQUIRED)
  const pr = await fetch("http://127.0.0.1:4021/report", { method: "POST", body: "x" });
  const h402 = JSON.parse(Buffer.from(pr.headers.get("payment-required"), "base64").toString());
  out.h402 = h402; saveJson("402_r3.json", h402);
  const acc = h402.accepts?.[0] ?? {};
  console.log("402 accepts[0]:", JSON.stringify({ scheme: acc.scheme, amount: acc.amount, network: acc.network, maxTimeoutSeconds: acc.maxTimeoutSeconds, payTo: acc.payTo }));
  // ---- R1 returned
  r = await runRow(p, 0, "R1");
  const w1 = await approveAndWatch(p, "R1");
  C.ok(w1.submitsSent === 1, "R1: exactly one /api/submit after Approve", w1.submitsSent);
  const c1 = await capture(p); out.c1 = c1; out.w1 = w1;
  console.log("R1 console:\n" + c1.console); console.log("R1 subs:", JSON.stringify(c1.subs));
  await p.shot("s2_R1_returned");
  const log1 = readLog(); const rec1 = log1[0];
  C.ok(log1.length === 1, "R1: one log record", log1.length);
  C.ok(rec1?.verdict === "reproduced" && String(rec1.settledAtomic) === "0" && rec1.settlementStatus === "settled", "R1: record reproduced, settled 0", JSON.stringify(rec1 && { v: rec1.verdict, s: rec1.settledAtomic, st: rec1.settlementStatus }));
  C.ok(/Bond returned/.test(c1.title || ""), "R1: outcome title 'Bond returned'", c1.title);
  C.ok(/\$0\.25/.test(c1.hero || "") && /back to your wallet/.test(c1.hero || ""), "R1: '$0.25 back to your wallet'", c1.hero);
  C.ok(/Stub verdict \(filename rule\)/.test(c1.evdText || "") && c1.evidenceStyled === false, "R1: stub detail not styled as evidence", `${c1.evd} ${c1.evdText}`);
  const lk1 = c1.links.filter(h => h.includes("explorer.solana.com"));
  C.ok(lk1.length === 1 && lk1[0].includes(rec1?.txSignature) && lk1[0].endsWith("cluster=devnet"), "R1: one settle link equals log txSignature", lk1.join(","));
  C.ok(/Rehearsal: stub verdicts follow the filename, not a sandbox\./.test(c1.headline), "R1: headline stays rehearsal");
  // decision log vs sub-lines vs 402
  const dl = (w1.decLogs[0] || "").split("\n").filter(Boolean).map(l => JSON.parse(l));
  out.dl1 = dl; saveJson("declog_R1.json", dl);
  const reserve = dl.find(x => x.event === "reserve") || {};
  console.log("decision log events:", dl.map(x => x.event).join(","), " reserve:", JSON.stringify(reserve));
  C.ok(dl.length >= 4, "R1: per-job decision log captured while the job ran", dl.length);
  C.ok(String(reserve.askAtomic) === String(acc.amount) && String(reserve.capAtomic) === "250000" && reserve.scheme === acc.scheme && reserve.network === acc.network && reserve.maxTimeoutSeconds === acc.maxTimeoutSeconds, "R1: decision-log reserve facts equal decoded 402", JSON.stringify(reserve));
  const terms = c1.subs.find(s => /Read 402/.test(s)) || "";
  C.ok(/0\.25 USDC/.test(terms) && /upto/.test(terms) && /devnet/.test(terms) && /300 s/.test(terms), "R1: stepper 'Read 402' sub-line equals 402 terms (0.25, upto, devnet, 300 s)", terms);
  C.ok(c1.subs.some(s => /Within the \$0\.25 per-report cap/.test(s)), "R1: cap sub-line");
  const left = c1.subs.find(s => /Budget left/.test(s)) || "";
  C.ok(/\$1\.75/.test(left) && String(reserve.remainingAtomic) === "1750000", "R1: budget-left sub-line equals decision log remaining (1.75)", `${left} / ${reserve.remainingAtomic}`);
  C.ok(c1.subs.some(s => /Endpoint allowed \(localhost:4021\)/.test(s)), "R1: endpoint sub-line");
  C.ok(c1.steps.join("|") === "Policy, done|Approved, done|Signed, done|Verdict, done|Settled, done", "R1: all five steps done", c1.steps.join("|"));
  const ti1 = await txInfo(rec1.txSignature); out.ti1 = ti1;
  C.ok(ti1 && ti1.err === null && ti1.payToDelta === 0 && ti1.buyerDelta === 250000, "R1: settle tx confirmed on RPC: refund leg buyer +250000 (deposit was an earlier tx), payTo 0", JSON.stringify(ti1));
  const sn1 = await snapshot(p); C.ok(banned({ body: sn1.body }).length === 0, "R1: console/board text has no banned tokens", banned({ body: sn1.body }).join("|"));
  saveJson("text_R1.json", sn1);
  const b1 = await stableBalances(); saveJson("bal_s2_R1.json", b1);
  const d1 = delta(b0, b1); console.log("R1 balance delta", JSON.stringify(d1));
  C.ok(d1.buyer.usdc === 0 && d1.payTo.usdc === 0, "R1: RPC USDC delta 0 for buyer and receiver", JSON.stringify(d1));
  const cfg1 = await (await fetch("http://127.0.0.1:4030/api/config")).json();
  C.ok(cfg1.session.spentAtomic === "0", "R1: session spent 0", cfg1.session.spentAtomic);

  // ---- 429: immediate resubmit via API (free)
  const tok = cfg1.csrfToken, hd = { origin: "http://127.0.0.1:4030", "x-csrf-token": tok, "x-demo-input-id": "arvo_42482847", "content-type": "application/octet-stream" };
  const n429 = readLog().length;
  const r429 = await fetch("http://127.0.0.1:4030/api/submit", { method: "POST", headers: hd, body: new Uint8Array(0) });
  const j429 = await r429.json().catch(() => ({}));
  C.ok(r429.status === 429 && /\d/.test(String(j429.retryAfterSeconds)), "429: immediate resubmit rate limited", `${r429.status} ${JSON.stringify(j429)}`);
  C.ok(readLog().length === n429, "429: no new log record");
  const cfg429 = await (await fetch("http://127.0.0.1:4030/api/config")).json();
  C.ok(cfg429.session.reservedAtomic === "0" && cfg429.session.spentAtomic === "0" && !cfg429.busy, "429: budget untouched, not busy", JSON.stringify(cfg429.session));

  // ---- R2 forfeited (wait for spacing)
  await sleep(13000);
  const bBefore2 = await stableBalances();
  await p.goto("http://127.0.0.1:4030/");
  r = await runRow(p, 2, "R2");
  const w2 = await approveAndWatch(p, "R2");
  const c2 = await capture(p); out.c2 = c2; console.log("R2 console:\n" + c2.console);
  await p.shot("s2_R2_forfeited");
  const log2 = readLog(); const rec2 = log2[1];
  C.ok(log2.length === 2 && rec2?.verdict === "not_reproduced" && String(rec2.settledAtomic) === "250000", "R2: record not_reproduced, settled 250000", JSON.stringify(rec2 && { v: rec2.verdict, s: rec2.settledAtomic }));
  C.ok(/Bond forfeited/.test(c2.title || "") && /\$0\.25/.test(c2.hero || "") && /paid out/.test(c2.hero || ""), "R2: 'Bond forfeited' + $0.25 paid out", `${c2.title} / ${c2.hero}`);
  C.ok(/Stub verdict \(filename rule\)/.test(c2.evdText || "") && c2.evidenceStyled === false, "R2: stub detail not styled as evidence", `${c2.evd} ${c2.evdText}`);
  const lk2 = c2.links.filter(h => h.includes("explorer.solana.com"));
  C.ok(lk2.length === 1 && lk2[0].includes(rec2?.txSignature), "R2: one settle link equals log txSignature", lk2.join(","));
  const ti2 = await txInfo(rec2.txSignature); out.ti2 = ti2;
  C.ok(ti2 && ti2.err === null && ti2.payToDelta === 250000 && ti2.buyerDelta === 0, "R2: settle tx confirmed: payTo +250000, buyer 0 in the settle tx (deposit was an earlier tx)", JSON.stringify(ti2));
  const b2 = await stableBalances(); saveJson("bal_s2_R2.json", b2);
  const d2 = delta(bBefore2, b2); console.log("R2 balance delta", JSON.stringify(d2));
  C.ok(d2.buyer.usdc === -250000 && d2.payTo.usdc === 250000, "R2: RPC USDC delta matches (-250000 / +250000)", JSON.stringify(d2));
  const sn2 = await snapshot(p); C.ok(banned({ body: sn2.body }).length === 0, "R2: text has no banned tokens", banned({ body: sn2.body }).join("|"));
  const cfg2 = await (await fetch("http://127.0.0.1:4030/api/config")).json();
  C.ok(cfg2.session.spentAtomic === "250000", "R2: session spent 250000", cfg2.session.spentAtomic);
  C.ok(/Bond returned/.test(sn2.body) === false || !/forfeit/i.test((c2.title || "").replace(/Bond forfeited/, "")), "R2: no 'returned' wording on a forfeit (outcome card)");
  out.sn2 = sn2; saveJson("stage2_out.json", out);
  const v = verifyCli(); console.log("verify-log CLI:", JSON.stringify(v));
  C.ok(v.status === 0, "verify-log CLI OK after 2 records", v.out);
  await p.close();
} finally { br.close(); }
process.exit(C.done() ? 1 : 0);
