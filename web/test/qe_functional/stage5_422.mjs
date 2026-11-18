// Round 2, stage 5 (free, no payment possible): 422 session_budget_exhausted through the UI on an extra instance (:4031, AGENT_SESSION_BUDGET_USD=0.10).
import { readFileSync } from "node:fs"; import path from "node:path";
import { Browser, SCRATCH, ROOT, sleep, stableBalances as balances, delta, saveJson } from "./lib.mjs"; import { startInstance } from "./inst.mjs"; import { activeTab } from "./ui.mjs";
const nLog = () => readFileSync(path.join(ROOT, "web/run/stub/verdicts.jsonl"), "utf8").split("\n").filter(Boolean).length;
const c = startInstance(4031, { AGENT_SESSION_BUDGET_USD: "0.10" }, "i422"); const br = await Browser.launch(9339); const out = {};
try {
  await sleep(2500); const b0 = await balances(); const n0 = nLog();
  const p = await br.newPage("http://127.0.0.1:4031/"); await p.tab("submit"); await p.chip("Hand made fake near miss");
  await p.runSelected(); await p.waitFor(`document.getElementById('confirm').open`, 5000); await p.click("#confirm-ok"); await sleep(1500);
  out.submitText = await p.text("#panel-submit"); out.activeTab = await activeTab(p); await p.shot("s5_422");
  out.meter = await p.eval(`document.querySelector('.budget').title`); out.runPanel = await p.text("#panel-run");
  await p.tab("policy"); out.agent = await p.text("#panel-policy"); await p.shot("s5_422_agent");
  out.bal = delta(b0, await balances()); out.logDelta = nLog() - n0; saveJson("stage5.json", out); console.log(JSON.stringify(out, null, 1));
} finally { br.close(); try { c.kill("SIGTERM"); } catch { /* gone */ } }
