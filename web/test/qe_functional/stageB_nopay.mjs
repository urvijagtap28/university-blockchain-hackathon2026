// Round 3 (4b): error path with NO payment (web instance whose x402 server port 4099 is closed): what does a single Run show? Free.
import { Browser, openPage, snapshot, Checks, readLog, sleep } from "./r3.mjs";
import { startInstance } from "./inst.mjs";
const C = new Checks("stageB");
const k = startInstance(4046, { WEB_SERVER_PORT: "4099" }, "r3B2");
for (let i = 0; i < 60; i++) { try { if ((await fetch("http://127.0.0.1:4046/api/config")).ok) break; } catch { /* wait */ } await sleep(250); }
const br = await Browser.launch(9346); const n0 = readLog().length;
try {
  const p = await openPage(br, "http://127.0.0.1:4046/"); await sleep(800);
  await p.eval(`document.querySelectorAll('#panel-submit .rep')[0].querySelector('button').click()`); await sleep(500); await p.click("#confirm-ok");
  await p.waitFor(`document.querySelector('#panel-run .ocard .ot') && !document.querySelector('#panel-run .pill.p-chk')`, 60000); await sleep(1500);
  await p.eval(`document.querySelector('#panel-run details').open=true`);
  const t = await p.eval(`document.getElementById('panel-run').innerText`); console.log(t);
  const sub = await p.eval(`document.querySelector('#panel-submit').innerText`); console.log("--- submit pane ---\n" + sub);
  await p.shot("sB_nopay");
  await sleep(6000); const live = await p.eval(`({running:[...document.querySelectorAll("#panel-submit .rep.live")].length, runBadge:!!document.querySelector("#panel-run .pill.p-chk"), btnDisabled:[...document.querySelectorAll("#panel-submit .rep button")].map(b=>b.disabled), cfgBusy:null})`); console.log("6 s later:", JSON.stringify(live), "api busy:", (await (await fetch("http://127.0.0.1:4046/api/config")).json()).busy);
  C.ok(live.running === 0, "after the error the row is not left in Running", JSON.stringify(live));
  C.ok(readLog().length === n0, "no log record, no payment");
  C.ok(/Not paid|No payment/i.test(t), "console tells the user that nothing was paid", t);
  C.ok(!/lost the live connection/i.test(t + sub), "does not blame a lost connection when the agent ended before any payment", "");
} finally { k.kill("SIGTERM"); br.close(); }
process.exit(C.done() ? 1 : 0);
