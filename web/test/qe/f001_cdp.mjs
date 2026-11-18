// WEB_FIXES / QE-F-001: key-free headless-Chrome test. In-process web app + fake agent (no devnet, no keys, no real money).
// The browser's SSE request for /events is intercepted with CDP Fetch and answered with a PARTIAL stream (started + sign, no done),
// so EventSource fires its native, data-less "error" event: the exact trigger of QE-F-001.
// Also checks: fixtures=1 ignored on the live server (QE-W-004), dropped fixture scenarios, error-verdict wording (QE-F-002), empty-log wording (QE-F-005).
// Usage: node web/test/qe/f001_cdp.mjs <shots-dir> [cdp-port] [web-port]
import { spawn } from "node:child_process";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const [shots, cport = "9461", wport = "4046"] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const dir = mkdtempSync(path.join(os.tmpdir(), "f001-")); const logFile = path.join(dir, "verdicts.jsonl");
const proof = path.join(dir, "real_proof.bin"); writeFileSync(proof, "f001 proof bytes"); const hash = createHash("sha256").update("f001 proof bytes").digest("hex");
const mk = async (child, port) => { const app = createApp({ mode: "stub", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: { PATH: process.env.PATH }, signerPub: base58.encode(pub), spacingMs: 0,
  agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, timing: { waitDoneMs: 8000, waitSignedMs: 8000, pollMs: 100, agentTimeoutMs: 20000 },
  extraChildEnv: { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), ...child },
  demoInputs: [{ id: "real_proof", label: "real proof", category: "real_bug", handMade: false, sizeBytes: 16, abs: proof, sha: hash }] }); await app.listen(port); return app; };
const app = await mk({ FAKE_SLEEP_MS: "1500", FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0" }, Number(wport));
const base = `http://127.0.0.1:${wport}`;

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(dir, "prof")}`, "--window-size=1100,1000", "--no-first-run", "--disable-gpu", "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
let tgt; for (let i = 0; i < 60 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch(`http://127.0.0.1:${cport}/json`)).json()).find(x => x.type === "page"); } catch {} }
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pend = new Map(), handlers = [];
ws.addEventListener("message", m => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } else handlers.push(j); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async n => writeFileSync(path.join(shots, n), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
const text = id => ev(`document.getElementById('${id}').innerText`);
await send("Page.enable"); await send("Runtime.enable");

// ---- A: live instance, dropped stream after "Payment signed" ----
await send("Fetch.enable", { patterns: [{ urlPattern: "*/events", requestStage: "Request" }] });
let intercepted = 0;
const pump = setInterval(async () => {
  while (handlers.length) { const j = handlers.shift();
    if (j.method === "Fetch.requestPaused") { intercepted++; const jobId = /jobs\/([0-9a-f-]+)\/events/.exec(j.params.request.url)[1];
      const body = `id: 1\nevent: started\ndata: ${JSON.stringify({ jobId, reportHash: hash })}\n\nid: 2\nevent: decision\ndata: ${JSON.stringify({ ts: new Date().toISOString(), action: "sign", detail: "x402 upto authorization signed for 250000 atomic to PayToPub" })}\n\n`;
      send("Fetch.fulfillRequest", { requestId: j.params.requestId, responseCode: 200, responseHeaders: [{ name: "content-type", value: "text/event-stream" }, { name: "cache-control", value: "no-store" }], body: Buffer.from(body).toString("base64") }); }
    else if (j.method === "Fetch.requestPaused") {} } }, 20);
await send("Page.navigate", { url: base + "/" }); await sleep(1500);
// single-board layout: the demo input's own "Run" button (was radio + #submit-btn) opens the confirm dialog
await ev(`document.querySelector('#panel-submit .rep button').click()`); await sleep(300);
const confirmOpen = await ev(`document.getElementById('confirm').open`); ok(confirmOpen === true, "Run opens the confirm dialog (no payment before Approve)");
await ev(`document.getElementById('confirm-ok').click()`); await sleep(1200);
// M8 (adapted to the single board; the tabs are gone): on the LIVE path submitting moves focus to the Console pane, which shows the run, and no drawer opened.
const navState = JSON.parse(await ev(`JSON.stringify({ focus: document.activeElement && document.activeElement.id, drawers: ['ledger','agent','trust'].filter(i => document.getElementById(i).open), steps: document.querySelectorAll('#panel-run .stepper li').length })`));
ok(navState.focus === "panel-run" && navState.drawers.length === 0 && navState.steps === 5, "M8: live submit focuses the Console pane, shows the 5-step stepper, opens no drawer: " + JSON.stringify(navState));
let t1 = await text("panel-run"); await shot("f001_1_after_drop.png");
console.log("--- run panel right after the drop ---\n" + t1.replace(/\n+/g, " | "));
ok(intercepted >= 1, "SSE request was intercepted (partial stream served)");
ok(/Lost the live connection/.test(t1) && /UNKNOWN/.test(t1), "drop shows the 'Lost the live connection ... UNKNOWN' text");
ok(!/no payment was made/i.test(t1), "drop does NOT claim 'no payment was made'");
ok(!/Settled amount: none/.test(t1), "no fabricated 'Settled amount: none'");
ok(/Checking the chain/.test(t1), "shows 'Checking the chain' while waiting");
await sleep(5500); let t2 = await ev(`document.getElementById('panel-run').textContent`); /* redesign: the read-back note lives in the Details block */ await shot("f001_2_recovered.png");
console.log("--- run panel after recovery polling ---\n" + t2.replace(/\n+/g, " | "));
ok(/read back from the signed verdict log/.test(t2) && /Bond returned/.test(t2), "UI re-fetched /api/log, showed the matched record: bond returned ($0 settled)");
ok(!/no payment was made/i.test(t2), "recovered view still never says 'no payment was made'");
clearInterval(pump); await send("Fetch.disable");

// ---- B: fixtures switch is ignored on the live server (QE-W-004) ----
await send("Page.navigate", { url: base + "/?fixtures=1&mode=real&xss=1" }); await sleep(1500);
const fb = await ev(`JSON.stringify({ fixbarHidden: document.getElementById('fixbar').hidden, hasApp: typeof window.__app, body: document.body.innerText.slice(0, 160) })`);
console.log("fixtures=1 on live server:", fb);
ok(JSON.parse(fb).fixbarHidden === true && JSON.parse(fb).hasApp === "undefined", "live server ignores ?fixtures=1 (no fixture bar, no __app hook)");
ok(!/verified|REAL verifier/i.test(JSON.parse(fb).body) || /STUB/.test(JSON.parse(fb).body), "no fabricated 'real' banner on the live server with ?fixtures=1");

// ---- C: fixture scenarios over file:// ----
const fx = (q) => "file://" + path.resolve(HERE, "../../public/index.html") + "?fixtures=1&delay=150&" + q;
const run = async (q, wait) => { await send("Page.navigate", { url: fx(q) }); await sleep(900); await ev(`window.__app.pick(0); window.__app.doSubmit()`); await sleep(wait); return text("panel-run"); };
let r = await run("scenario=dropped", 5000); await shot("f001_3_fixture_dropped.png"); r = await ev(`document.getElementById('panel-run').textContent`); /* read-back note is in Details */
ok(/read back from the signed verdict log/.test(r) && /Bond returned/.test(r) && !/no payment was made/i.test(r), "fixture dropped (record exists): recovers from the log, no 'no payment' claim");
r = await run("scenario=dropped_norecord", 6000);
ok(/UNKNOWN/.test(r) && /Checking the chain|No signed record/.test(r) && !/no payment was made/i.test(r) && !/Bond returned/.test(r), "fixture dropped (no record): stays UNKNOWN, no invented outcome");
r = await run("scenario=error", 3500); await shot("f001_4_error_verdict.png");
console.log("--- error scenario ---\n" + r.replace(/\n+/g, " | "));
ok(!/FAILED/.test(r) && /error: \$0 settled, bond returned/.test(r), "QE-F-002: error verdict says '$0 settled, bond returned', no FAILED label");
r = await run("scenario=refused", 3000); ok(/no payment was made/i.test(r), "refused by policy still says no payment was made (server said so)");
await send("Page.navigate", { url: fx("log=empty&tab=results") }); await sleep(1200);
const em = await text("panel-results"); ok(/No entries to verify yet/.test(em) && !/0 of 0/.test(em), "QE-F-005: empty log wording is neutral");
await send("Page.navigate", { url: fx("tab=results") }); await sleep(1200);
const st = await ev(`document.getElementById('panel-results').textContent`); /* UI redesign: the note now lives in a (hidden) info popover, so read textContent, not innerText */ ok(/not meaningful in stub mode/.test(st), "QE-F-004: stub mode footnotes the wrongly-forfeited tile");

ws.close(); chrome.kill("SIGKILL"); await app.close();
console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
