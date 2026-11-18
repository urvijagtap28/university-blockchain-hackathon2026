// QE_FUNCTIONAL flow 5 (NO payment possible): 422 session_budget_exhausted through the UI click path, on an extra instance (:4031) with AGENT_SESSION_BUDGET_USD=0.10.
import path from "node:path";
import { Browser, SCRATCH, sleep, stableBalances as balances, delta, saveJson } from "./lib.mjs";
import { startInstance } from "./inst.mjs";
import { readFileSync } from "node:fs";
import { ROOT } from "./lib.mjs";
const countLog = () => readFileSync(path.join(ROOT, "web/run/stub/verdicts.jsonl"), "utf8").split("\n").filter(Boolean).length;
const c = startInstance(4031, { AGENT_SESSION_BUDGET_USD: "0.10" }, "i422"); const br = await Browser.launch(9337); const out = {};
try {
  await sleep(2500); const b0 = await balances(); const n0 = countLog();
  const p = await br.newPage("http://127.0.0.1:4031/"); await p.tab("submit"); await p.pickFile(path.join(SCRATCH, "inputs/real_qe_a.bin"));
  await p.click("#submit-btn"); await p.waitFor(`document.getElementById('confirm').open`, 5000); await p.click("#confirm-ok"); await sleep(1500);
  out.submitText = (await p.text("#panel-submit")).split("\n").filter(x => /422|Refused|budget/i.test(x)); await p.shot("06_422_ui");
  out.policy = await (async () => { await p.tab("policy"); return p.text("#panel-policy"); })();
  const b1 = await balances(); out.bal = delta(b0, b1); out.logLines = [n0, countLog()]; saveJson("flow5.json", out); console.log(JSON.stringify(out, null, 1));
} catch (e) { console.error("FLOW5 ERROR", e); process.exitCode = 1; } finally { br.close(); try { c.kill("SIGTERM"); } catch { /* gone */ } }
