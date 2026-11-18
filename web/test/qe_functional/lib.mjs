// QE_FUNCTIONAL helpers (key-free: reads .env only to get SVM_RPC_URL and to DERIVE public addresses; never prints or sends key material).
// Headless Chrome over the DevTools Protocol (node global WebSocket), RPC reads, balance snapshots.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SCRATCH = process.env.QE_SCRATCH || "/private/tmp/claude-501/-Users-liezeil-university-blockchain-hackathon2026/e452d3df-a6f8-484f-b1ba-ed7167e32680/scratchpad/qe_functional";
mkdirSync(path.join(SCRATCH, "shots"), { recursive: true });
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const sha256 = b => createHash("sha256").update(b).digest("hex");
const { base58 } = createRequire(path.join(ROOT, "server", "package.json"))("@scure/base");
process.loadEnvFile(path.join(ROOT, ".env"));
const pub = k => base58.encode(base58.decode(k.trim()).slice(32));
export const ADDR = { buyer: pub(process.env.AGENT_SVM_PRIVATE_KEY), payTo: process.env.SVM_ADDRESS.trim(), facilitator: pub(process.env.SVM_PRIVATE_KEY), signer: pub(process.env.LOG_SIGNING_KEY) };
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const rpc = async (m, p) => { const j = await (await fetch(process.env.SVM_RPC_URL.trim(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (j.error) throw new Error(m + ": " + JSON.stringify(j.error)); return j.result; };
export async function balances() {
  const out = {};
  for (const [n, a] of Object.entries({ buyer: ADDR.buyer, payTo: ADDR.payTo, facilitator: ADDR.facilitator })) {
    const lamports = (await rpc("getBalance", [a, { commitment: "confirmed" }])).value;
    const t = await rpc("getTokenAccountsByOwner", [a, { mint: MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]);
    out[n] = { lamports, usdc: t.value.reduce((s, x) => s + Number(x.account.data.parsed.info.tokenAmount.amount), 0) };
  }
  return out;
}
export const delta = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, { lamports: b[k].lamports - a[k].lamports, usdc: b[k].usdc - a[k].usdc }]));
export async function txInfo(sig) {
  for (let i = 0; i < 10; i++) { const r = await rpc("getTransaction", [sig, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]); if (r) {
    const pre = r.meta.preTokenBalances ?? [], post = r.meta.postTokenBalances ?? [];
    const by = (arr, owner) => arr.filter(x => x.owner === owner && x.mint === MINT).reduce((s, x) => s + Number(x.uiTokenAmount.amount), 0);
    return { err: r.meta.err, slot: r.slot, payToDelta: by(post, ADDR.payTo) - by(pre, ADDR.payTo), buyerDelta: by(post, ADDR.buyer) - by(pre, ADDR.buyer) }; }
    await sleep(1500); }
  return null;
}

export class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = []; ws.addEventListener("message", m => { const j = JSON.parse(m.data); if (j.id && this.pending.has(j.id)) { const { res, rej } = this.pending.get(j.id); this.pending.delete(j.id); j.error ? rej(new Error(JSON.stringify(j.error))) : res(j.result); } else if (j.method) this.handlers.forEach(h => h(j)); }); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
  on(h) { this.handlers.push(h); }
}
export class Browser {
  static async launch(port = 9333, w = 1100, h = 900) {
    const b = new Browser(); b.port = port;
    b.proc = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(SCRATCH, "chrome-profile-" + port)}`, `--window-size=${w},${h}`, "--no-first-run", "--disable-gpu", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
    for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(250); } }
    return b;
  }
  async newPage(url, w = 1100, h = 900) {
    const t = await (await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const p = new Page(new Cdp(ws), t.id); await p.init(w, h); if (url) await p.goto(url); return p;
  }
  close() { try { this.proc.kill("SIGTERM"); } catch { /* gone */ } }
}
export class Page {
  constructor(cdp, id) { this.c = cdp; this.id = id; this.chooser = null; this.dialogs = []; }
  async init(w, h) {
    await this.c.send("Page.enable"); await this.c.send("Runtime.enable"); await this.c.send("DOM.enable");
    await this.c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await this.c.send("Page.setInterceptFileChooserDialog", { enabled: true });
    this.c.on(m => { if (m.method === "Page.fileChooserOpened") this.chooser = m.params; if (m.method === "Page.javascriptDialogOpening") { this.dialogs.push(m.params); this.c.send("Page.handleJavaScriptDialog", { accept: true }); } });
  }
  async resize(w, h = 900) { await this.c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); }
  async goto(url) { await this.c.send("Page.navigate", { url }); await sleep(300); await this.waitFor(`document.readyState==='complete'`, 15000); await sleep(600); }
  async eval(expr) { const r = await this.c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)); return r.result.value; }
  async waitFor(expr, ms = 20000, step = 150) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await this.eval(expr)) return true; } catch { /* retry */ } await sleep(step); } throw new Error("timeout waiting for: " + expr.slice(0, 120)); }
  async rect(sel) { return this.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height}})()`); }
  async clickXY(x, y) { for (const [type, extra] of [["mouseMoved", {}], ["mousePressed", { button: "left", clickCount: 1 }], ["mouseReleased", { button: "left", clickCount: 1 }]]) await this.c.send("Input.dispatchMouseEvent", { type, x, y, ...extra }); }
  async click(sel) { const r = await this.rect(sel); if (!r) throw new Error("no element " + sel); await this.clickXY(r.x, r.y); }
  /** click the first element matching css whose text includes `text` */
  async clickText(css, text) { const i = await this.eval(`(()=>{const l=[...document.querySelectorAll(${JSON.stringify(css)})];const e=l.find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)return null;e.setAttribute('data-qe','1');return 1})()`); if (!i) throw new Error(`no ${css} with text ${text}`); await this.click("[data-qe='1']"); await this.eval(`document.querySelector("[data-qe='1']")?.removeAttribute('data-qe')`); }
  async pickFile(filePath) { this.chooser = null; await this.click("#file-input"); await this.waitFor("true", 100); for (let i = 0; i < 40 && !this.chooser; i++) await sleep(100); if (!this.chooser) throw new Error("file chooser did not open"); await this.c.send("DOM.setFileInputFiles", { files: [filePath], backendNodeId: this.chooser.backendNodeId }); await sleep(400); }
  async shot(name) { const r = await this.c.send("Page.captureScreenshot", { format: "png" }); const f = path.join(SCRATCH, "shots", name + ".png"); writeFileSync(f, Buffer.from(r.data, "base64")); return f; }
  async tab(name) { await this.click("#tab-" + name); await sleep(700); }
  text(sel) { return this.eval(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`); }
  async close() { try { await this.c.send("Page.close"); } catch { /* ok */ } try { this.c.ws.close(); } catch { /* ok */ } }
}
export const saveJson = (name, o) => writeFileSync(path.join(SCRATCH, name), JSON.stringify(o, null, 2));
export const loadJson = name => JSON.parse(readFileSync(path.join(SCRATCH, name), "utf8"));
/** balances read until two consecutive reads agree (RPC nodes lag at 'confirmed'). */
export async function stableBalances(maxMs = 20000) {
  let prev = JSON.stringify(await balances()); const end = Date.now() + maxMs;
  for (;;) { await sleep(2500); const cur = JSON.stringify(await balances()); if (cur === prev || Date.now() > end) return JSON.parse(cur); prev = cur; }
}
