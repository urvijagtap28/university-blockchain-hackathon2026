// QE_FUNCTIONAL flow 6 (1 paid request): SIGTERM the web app process (extra instance :4031, by PID only) right after "Payment signed" shows in the UI, then restart it.
import path from "node:path";
import { writeFileSync, readFileSync } from "node:fs";
import { Browser, SCRATCH, ROOT, sleep, sha256, stableBalances as balances, delta, saveJson } from "./lib.mjs";
import { startInstance } from "./inst.mjs";
const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl");
const recs = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const f = path.join(SCRATCH, "inputs/real_qe_kill.bin"); const bytes = "qe functional kill-test input (real-prefixed)\n"; writeFileSync(f, bytes); const hash = sha256(bytes);
const out = { hash }; const br = await Browser.launch(9338);
let c = startInstance(4031, {}, "ikill");
try {
  await sleep(2500); const b0 = await balances(); const n0 = recs().length; out.before = { n: n0 };
  const p = await br.newPage("http://127.0.0.1:4031/"); await p.tab("submit"); await p.pickFile(f);
  await p.click("#submit-btn"); await p.waitFor(`document.getElementById('confirm').open`, 5000); await p.click("#confirm-ok");
  await p.waitFor(`/Payment signed\\s*\\n?\\s*x402/i.test(document.getElementById('panel-run').innerText)`, 30000, 40);
  out.killedAt = new Date().toISOString(); out.pid = c.pid; process.kill(c.pid, "SIGTERM");   // the web app process only
  await sleep(4000);
  out.uiAfterKill = await p.text("#panel-run"); await p.shot("07_kill_ui");
  let rec = null; for (let i = 0; i < 40 && !rec; i++) { rec = recs().slice(n0).find(r => r.reportHash === hash) ?? null; if (!rec) await sleep(1500); }
  out.record = rec && { seq: rec.seq, verdict: rec.verdict, settledAtomic: rec.settledAtomic, status: rec.settlementStatus, tx: rec.txSignature, ts: rec.timestamp, recAt: new Date().toISOString() };
  out.bal = delta(b0, await balances());
  // restart the web app alone
  c = startInstance(4031, {}, "ikill2"); await sleep(2500);
  const q = await br.newPage("http://127.0.0.1:4031/");
  out.restartedConfig = await q.eval(`fetch('/api/config').then(r=>r.json()).then(c=>({busy:c.busy,session:c.session}))`);
  out.restartedLog = await q.eval(`fetch('/api/log').then(r=>r.json()).then(l=>({verify:l.verify,n:l.records.length,head:l.head,hasRec:l.records.some(r=>r.reportHash===${JSON.stringify(hash)})}))`);
  out.restartedInbox = await q.eval(`fetch('/api/inbox').then(r=>r.json()).then(j=>j.items.map(i=>({h:i.reportHash.slice(0,8),v:i.verdict,note:i.note&&i.note.decision})))`);
  await q.tab("results"); out.resultsHead = (await q.text("#panel-results")).split("\n").filter(x => /log entries verified|Reports \(/i.test(x)); await q.shot("07_restart_results");
  await q.tab("policy"); out.policyAfter = (await q.text("#panel-policy")).split("\n").filter(x => /spent|remaining/.test(x));
  await q.tab("inbox"); await q.shot("07_restart_inbox");
  // old job id after restart
  out.oldJobEvents = await q.eval(`fetch('/api/jobs/00000000-0000-0000-0000-000000000000/events').then(r=>r.status)`);
  saveJson("flow6.json", out); console.log(JSON.stringify(out, null, 1));
} catch (e) { console.error("FLOW6 ERROR", e); out.error = String(e); saveJson("flow6.json", out); process.exitCode = 1; } finally { br.close(); try { c.kill("SIGTERM"); } catch { /* gone */ } }
