// (1) empty state, (13) stub bar, (16) text sanity on an empty log. Key-free, no payment.
import { Browser, saveJson } from "./lib.mjs"; import { dumpAll, activeTab } from "./ui.mjs";
const br = await Browser.launch(9335);
try {
  const p = await br.newPage("http://127.0.0.1:4030/");
  await new Promise(r => setTimeout(r, 1200));
  const first = await activeTab(p);
  const ovBtns = await p.eval(`[...document.querySelectorAll('#panel-overview button, #panel-overview a')].map(b=>b.innerText.trim())`);
  const ovText = await p.eval(`document.getElementById('panel-overview').innerText`);
  const d = await dumpAll(p, "s1_empty");
  const r = { defaultTab: first, ovBtns, ovText, dump: d };
  saveJson("stage1.json", r);
  console.log("default tab:", first); console.log("overview buttons:", JSON.stringify(ovBtns), "text:", JSON.stringify(ovText));
  for (const t of Object.keys(d.tabs)) console.log("--", t, JSON.stringify(d.tabs[t].text.slice(0, 260)), "stubBar", JSON.stringify(d.tabs[t].stubBar));
  console.log("top:", JSON.stringify(d.top)); console.log("BAD:", JSON.stringify(d.bad));
} finally { br.close(); }
