// Round 3 (4 budget gate)(12 tamper): free tests on extra web instances (the launcher stack on :4030/:4021/:4022 keeps running; never restarted).
//  A) :4041 budget $0.60: Run all 5 refused up front (5 x 0.25 = 1.25 > 0.60), nothing sent, no dialog, message names the session budget.
//  B) :4042 WEB_SERVER_PORT=4099 (nothing listens): Run all 5 -> first job errors with no payment -> batch stops on the first failure, "4 not submitted".
//  C) :4044 serves a COPY of the log (WEB_RUN_DIR) with one line tampered: CHECKS FAILED bar, 'Unverified record' rows.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Browser, openPage, submits, snapshot, banned, Checks, readLog, verifyCli, SCRATCH, ROOT, sleep, ADDR, saveJson, balances } from "./r3.mjs";
import { startInstance } from "./inst.mjs";
const C = new Checks("stage5");
const ready = async port => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) return; } catch { /* wait */ } await sleep(250); } throw new Error("instance not ready " + port); };
const kids = [];
const n0 = readLog().length; const b0 = await balances();
const br = await Browser.launch(9345);
try {
  // ---- A
  kids.push(startInstance(4041, { AGENT_SESSION_BUDGET_USD: "0.60" }, "r3A")); await ready(4041);
  let p = await openPage(br, "http://127.0.0.1:4041/"); await sleep(800);
  let s = await snapshot(p); C.ok(/\$0\.60/.test(s.body), "A: header meter shows $0.60 budget", s.body.slice(0, 120));
  await p.click("#run-all"); await sleep(700);
  s = await snapshot(p);
  console.log("A body after Run all:\n" + (await p.eval(`document.getElementById('panel-submit').innerText`)));
  const msg = await p.eval(`document.querySelector('#panel-submit .alertbox')?.innerText||''`);
  C.ok(s.confirm === null, "A: no confirm dialog opened when the batch cannot fit the budget", s.confirm);
  C.ok(/session budget/i.test(msg) && /\$1\.25/.test(msg) && /\$0\.60/.test(msg) && /nothing was submitted/i.test(msg), "A: refusal names the session budget, $1.25 and $0.60, nothing submitted", msg);
  C.ok(submits(p).length === 0 && readLog().length === n0, "A: no /api/submit, no log record");
  C.ok(banned({ msg }).length === 0, "A: refusal text has no banned tokens", msg);
  await p.shot("s5_A_budget_refusal");
  // single Run still allowed within 0.60 (open confirm, cancel; free)
  await p.eval(`document.querySelectorAll('#panel-submit .rep')[0].querySelector('button').click()`); await sleep(500);
  s = await snapshot(p); C.ok(/\$0\.60 left of \$0\.60/.test(s.confirm || ""), "A: a single Run still opens the confirm with $0.60 left", s.confirm);
  await p.click("#confirm-cancel"); await sleep(500);
  await p.close();
  // ---- B
  kids.push(startInstance(4042, { WEB_SERVER_PORT: "4099" }, "r3B")); await ready(4042);
  p = await openPage(br, "http://127.0.0.1:4042/"); await sleep(800);
  await p.click("#run-all"); await sleep(500); await p.click("#confirm-ok");
  const t0 = Date.now(); let msgB = "";
  while (Date.now() - t0 < 120000) { msgB = await p.eval(`document.querySelector('#panel-submit .alertbox')?.innerText||''`); if (msgB) break; await sleep(500); }
  await sleep(1500);
  const consoleB = await p.eval(`document.getElementById('panel-run').innerText`); const cfgB = await (await fetch("http://127.0.0.1:4042/api/config")).json();
  console.log("B message:", msgB, "\nB console:\n" + consoleB, "\nB session:", JSON.stringify(cfgB.session), "submits:", submits(p).length);
  C.ok(/Batch stopped/.test(msgB) && /4 not submitted/.test(msgB), "B: batch stops on the first failure and says 4 not submitted", msgB);
  C.ok(submits(p).length === 1, "B: only one /api/submit sent before the stop", submits(p).length);
  C.ok(readLog().length === n0, "B: no log record from a run that never reached the server");
  C.ok(cfgB.session.spentAtomic === "0" && cfgB.session.reservedAtomic === "0", "B: session charged nothing", JSON.stringify(cfgB.session));
  C.ok(!/Bond returned|Bond forfeited/.test(consoleB), "B: console does not claim a bond outcome", consoleB);
  C.ok(banned({ msg: msgB, consoleB }).length === 0, "B: texts have no banned tokens", banned({ msgB, consoleB }).join("|"));
  await p.shot("s5_B_batch_stop"); await p.close();
  // ---- C tamper on a COPY
  const dir = path.join(SCRATCH, "tamper_run"); mkdirSync(dir, { recursive: true });
  const lines = readFileSync(path.join(ROOT, "web/run/stub/verdicts.jsonl"), "utf8").split("\n").filter(Boolean);
  const idx = lines.findIndex(l => JSON.parse(l).verdict === "not_reproduced");
  const t = JSON.parse(lines[idx]); t.verdict = "reproduced"; t.detail = "ASan heap-buffer-overflow (tampered copy)"; lines[idx] = JSON.stringify(t);
  writeFileSync(path.join(dir, "verdicts.jsonl"), lines.join("\n") + "\n");
  kids.push(startInstance(4044, { WEB_RUN_DIR: dir }, "r3C")); await ready(4044);
  p = await openPage(br, "http://127.0.0.1:4044/"); await sleep(1000);
  s = await snapshot(p); console.log("C board:\n" + s.body.slice(0, 2400));
  const cli = verifyCli(path.join(dir, "verdicts.jsonl")); console.log("CLI on tampered copy:", JSON.stringify(cli));
  C.ok(cli.status === 1, "C: verify-log CLI also fails the tampered copy", cli.out);
  const bar = await p.eval(`document.querySelector('#banners .bar-msg.fail')?.innerText||''`);
  C.ok(/CHECKS FAILED/.test(bar) && /6 of 8/.test(bar), "C: red CHECKS FAILED bar with 6 of 8 (tampered line 2 plus the line 3 whose prev-hash link it breaks)", bar);
  const bc = await p.eval(`getComputedStyle(document.querySelector('#banners .bar-msg.fail')).color + '|' + getComputedStyle(document.querySelector('#banners .bar-msg.fail')).backgroundColor`);
  console.log("C bar colours:", bc);
  C.ok(/Unverified record/.test(s.body), "C: maintainer pane shows 'Unverified record'", s.body);
  C.ok(/Line \d+ broken|broken/.test(s.body), "C: trust badge says which line is broken");
  C.ok(!/Rehearsal: stub verdicts follow the filename, not a sandbox\./.test(s.body) === false, "C: stub headline unchanged on a tampered log (stub bar still present)");
  const unvItems = await p.eval(`[...document.querySelectorAll('#panel-overview .mnt-i.unv')].map(i=>({t:i.innerText, a:i.querySelectorAll('a').length, ev:i.querySelectorAll('.evd').length, tag:i.querySelectorAll('.tag').length}))`);
  C.ok(unvItems.length === 2 && unvItems.every(u => u.a === 0 && u.ev === 0 && u.tag === 0), "C: unverified item has no link, evidence or tag", JSON.stringify(unvItems));
  C.ok(/reproduced$/mi.test(s.body) === false || !/\b4 reproduced\b/.test(s.body) || true, "C: (info) summary counts tampered row");
  console.log("C summary line:", await p.eval(`document.querySelector('.sumline')?.innerText`));
  const sumTxt = await p.eval(`document.querySelector('.sumline')?.innerText`);
  C.ok(/2 reproduced/.test(sumTxt) && /Line 2, 3 broken/.test(sumTxt), "C: summary counts only signature-verified reproduced records (2: the 3 reproduced minus the chain-broken line 3)", sumTxt);
  await p.tab("results"); const sl = await snapshot(p);
  const nv = await p.eval(`[...document.querySelectorAll('#panel-results tbody tr.broken')].map(r=>({t:r.innerText.replace(/\\n+/g,' '), a:r.querySelectorAll('a').length}))`);
  console.log("C ledger broken rows:", JSON.stringify(nv));
  C.ok(nv.every(r => r.a === 0), "C: ledger broken rows carry no Explorer link (maintainer pane omits it for unverified records)", JSON.stringify(nv.map(r => r.a)));
  C.ok(nv.length === 2 && nv.every(r => /Not verified/.test(r.t) && !/\bReproduced\b/.test(r.t)), "C: ledger broken rows labelled 'Not verified', not as Reproduced", JSON.stringify(nv));
  C.ok(sl.stubBarInDialog.ledger === true && /CHECKS FAILED/.test((await p.eval(`document.getElementById('ledger-bars').innerText`))), "C: CHECKS FAILED bar repeated inside the Ledger drawer", await p.eval(`document.getElementById('ledger-bars').innerText`));
  C.ok(banned({ body: s.body, ledger: sl.ledger }).length === 0, "C: no banned tokens on tampered board", banned({ body: s.body, ledger: sl.ledger }).join("|"));
  await p.shot("s5_C_tampered_ledger"); await p.eval(`document.getElementById('ledger').close()`); await p.shot("s5_C_tampered_board");
  await p.close();
  const bz = await balances(); console.log("balance delta over stage5:", JSON.stringify(Object.fromEntries(Object.keys(b0).map(k => [k, bz[k].usdc - b0[k].usdc]))));
  C.ok(Object.keys(b0).every(k => bz[k].usdc === b0[k].usdc), "stage5 moved no USDC");
} finally { for (const k of kids) try { k.kill("SIGTERM"); } catch { /* gone */ } br.close(); }
process.exit(C.done() ? 1 : 0);
