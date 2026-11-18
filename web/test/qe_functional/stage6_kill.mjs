// Round 2, stage 6 (1 PAID request): QE-F-001 scenario live. An extra web instance (:4033, same stack, same run dir) is SIGTERMed by PID right after "Signed, done"
// shows; then restarted on the same port. Checks: UI never says "no payment was made" for a signed payment; the outcome is read back from the signed log.
// Also checks the Agent tab decision stream and budget meter from the page that ran the job.
import path from "node:path"; import { writeFileSync, readFileSync } from "node:fs";
import { Browser, SCRATCH, ROOT, sleep, sha256, stableBalances as balances, delta, saveJson } from "./lib.mjs"; import { startInstance } from "./inst.mjs";
const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl"); const recs = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const f = path.join(SCRATCH, "inputs/real_qe2_kill_b.bin"); const bytes = "qe round 2 kill-test input B (real-prefixed)\n"; writeFileSync(f, bytes); const hash = sha256(bytes);
const out = { hash }; const br = await Browser.launch(9340); let c = startInstance(4033, {}, "ikill");
const runText = p => p.eval(`document.getElementById('panel-run').innerText`);
try {
  await sleep(2500); const b0 = await balances(); const n0 = recs().length;
  const p = await br.newPage("http://127.0.0.1:4033/"); await p.tab("submit"); await p.pickFile(f);
  await p.runSelected(); await p.waitFor(`document.getElementById('confirm').open`, 5000); await p.click("#confirm-ok");
  await p.waitFor(`[...document.querySelectorAll('#panel-run .stepper li')].some(li=>/^Signed, done/.test(li.getAttribute('aria-label')))`, 30000, 30);
  // agent tab decision stream first (the page must be able to reach the backend to open that tab), then back to Activity, then kill
  await p.tab("policy"); out.agentTab = await p.eval(`({budget:document.querySelector('.budget')?.title, text:document.getElementById('panel-policy').innerText, decisions:[...document.querySelectorAll('#panel-policy .tl-list li')].map(l=>l.innerText.replace(/\\n+/g,' | '))})`); await p.shot("s6_agent_stream");
  await p.tab("run");
  out.killedAt = new Date().toISOString(); process.kill(c.pid, "SIGTERM");
  await p.tab("run"); await sleep(1500);
  out.t1 = await runText(p); out.t1card = await p.eval(`document.querySelector('#panel-run .ocard')?.className`); await p.shot("s6_after_kill_1s");
  out.recAtKill = recs().slice(n0).find(r => r.reportHash === hash) ?? null;
  await sleep(3500); out.t5 = await runText(p); await p.shot("s6_after_kill_5s");
  out.mono = [];
  // restart ONLY the web app on the same port with the same run dir, then let the open page's bounded read-back finish
  c = startInstance(4033, {}, "ikill2"); const restartAt = Date.now();
  await p.waitFor(`/Bond (returned|forfeited)/.test(document.getElementById('panel-run').innerText)`, 60000, 400).then(() => { out.recoveredAfterMs = Date.now() - restartAt; }).catch(() => { out.recoveredAfterMs = null; });
  out.t_final = await runText(p); out.finalCard = await p.eval(`(()=>{const o=document.querySelector('#panel-run .ocard');return {cls:o?.className,title:o?.querySelector('.ot')?.innerText,hero:[...o.querySelectorAll('.amt span')].map(x=>x.textContent),link:o?.querySelector('a[href]')?.href,details:[...document.querySelectorAll('#panel-run details dl dd')].map(x=>x.textContent)}})()`);
  await p.shot("s6_recovered");
  const rec = recs().slice(n0).find(r => r.reportHash === hash) ?? null;
  out.record = rec && { seq: rec.seq, verdict: rec.verdict, settledAtomic: rec.settledAtomic, tx: rec.txSignature, status: rec.settlementStatus };
  out.everSaidNoPayment = /no payment was made/i.test(out.t1 + out.t5 + out.t_final);
  out.bal = delta(b0, await balances()); out.newRecs = recs().length - n0;
  saveJson("stage6.json", out); console.log(JSON.stringify(out, null, 1));
} catch (e) { console.error("STAGE6 ERROR", e); out.error = String(e); saveJson("stage6.json", out); process.exitCode = 1; } finally { br.close(); try { c.kill("SIGTERM"); } catch { /* gone */ } }
