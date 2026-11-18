// QE_WEB_SECURITY: drive headless Chrome (CDP over loopback) against the xss_server instance and check payloads render as text.
// Usage: node web/test/qe/xss_cdp.mjs <base-url> <chrome-path> <cdp-port> <profile-dir>
import { spawn } from "node:child_process";
const [base, chrome, cport, prof] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ch = spawn(chrome, ["--headless=new", `--remote-debugging-port=${cport}`, "--remote-debugging-address=127.0.0.1", `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
let tgt; for (let i = 0; i < 50 && !tgt; i++) { await sleep(200); try { const l = await (await fetch(`http://127.0.0.1:${cport}/json`)).json(); tgt = l.find(x => x.type === "page"); } catch {} }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pend = new Map(), logs = [];
ws.addEventListener("message", m => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else if (j.method === "Runtime.consoleAPICalled" || j.method === "Log.entryAdded" || j.method === "Runtime.exceptionThrown") logs.push(j.method + " " + JSON.stringify(j.params).slice(0, 220)); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
const out = [];
async function check(label, setup) {
  await send("Page.navigate", { url: base + (label.url || "/") }); await sleep(1200);
  if (setup) await setup();
  const r = await ev(`(() => { const t = document.body.innerText; return JSON.stringify({ xss: window.__xss ?? null, bad: document.querySelectorAll('img,svg,script:not([src]),#injected,a[href^="javascript"],[onerror],[onload]').length, injectedId: !!document.getElementById('injected'), textHasPayload: t.includes('<img src=x') , textHasScriptTag: t.includes('<script>'), len: t.length }); })()`);
  out.push([label.name ?? label, r]); console.log(label.name ?? label, r);
}
const tabs = ["submit", "run", "results", "inbox", "policy"];
for (const t of tabs) await check({ name: "tab:" + t }, async () => { await ev(`document.getElementById('tab-${t}').click()`); await sleep(500); });
await check({ name: "run (demo submit through the UI)" }, async () => {
  await ev(`document.getElementById('tab-submit').click()`); await sleep(300);
  await ev(`document.querySelector('input[name=demo]').click()`); await sleep(200);
  await ev(`document.getElementById('submit-btn').click()`); await sleep(300);
  await ev(`document.getElementById('confirm-ok').click()`); await sleep(2500);
  console.log("run panel text sample:", (await ev(`document.getElementById('panel-run').innerText.slice(0,400)`)).replace(/\n/g, " | "));
});
await check({ name: "results after run" }, async () => { await ev(`document.getElementById('tab-results').click()`); await sleep(500); });
await check({ name: "inbox after run" }, async () => { await ev(`document.getElementById('tab-inbox').click()`); await sleep(500); console.log("inbox sample:", (await ev(`document.getElementById('panel-inbox').innerText.slice(0,500)`)).replace(/\n/g, " | ")); });
await check({ url: "/?fixtures=1&mode=real&xss=1", name: "fixtures=1 on live server" }, async () => { console.log("fixtures-mode page text:", (await ev(`document.body.innerText.slice(0,200)`)).replace(/\n/g, " | ")); });
await check({ url: "/?<img src=x onerror=window.__xss=1>#<img src=x onerror=window.__xss=1>", name: "payload in query+hash" });
console.log("console/log events:", logs.length); logs.slice(0, 8).forEach(l => console.log("  ", l));
ws.close(); ch.kill("SIGKILL"); process.exit(0);
