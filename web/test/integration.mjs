// Devnet integration client for the web API (STUB verifier). Usage (web app already running via scripts/web.sh --stub):
//   AGENT_SESSION_BUDGET_USD=0.25 bash scripts/web.sh --stub     # in another terminal
//   node web/test/integration.mjs [--kill]
// Uses only SVM_RPC_URL (read-only RPC) from .env and the public addresses from /api/config. Spends devnet USDC through the web app (about 3 paid requests).
import http from "node:http";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.loadEnvFile(path.join(ROOT, ".env"));
const RPC = process.env.SVM_RPC_URL, PORT = Number(process.env.WEB_PORT || 4030), USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let csrf;
function req(method, p, { body, headers = {}, origin = `http://127.0.0.1:${PORT}`, host = `127.0.0.1:${PORT}`, onChunk } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...headers }; if (method === "POST") { h.origin = origin; if (csrf) h["x-csrf-token"] = csrf; }
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path: p, headers: h }, res => { let t = ""; res.on("data", d => { t += d; onChunk?.(t); }); res.on("end", () => resolve({ status: res.statusCode, text: t })); });
    r.on("error", reject); if (body !== undefined) r.write(body); r.end();
  });
}
async function rpc(method, params) { const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(method + ": " + j.error.message); return j.result; }
const usdc = async a => (await rpc("getTokenAccountsByOwner", [a, { mint: USDC }, { encoding: "jsonParsed", commitment: "confirmed" }])).value.reduce((s, x) => s + BigInt(x.account.data.parsed.info.tokenAmount.amount), 0n);
async function job(name, filename, { killOnSign = false } = {}) {
  console.log(`\n=== ${name} (x-filename: ${filename}) ===`);
  const s = await req("POST", "/api/submit", { body: Buffer.from(`integration proof ${name} ${Date.now()}`), headers: { "x-filename": filename } });
  console.log("POST /api/submit ->", s.status, s.text);
  if (s.status !== 202) return null;
  const id = JSON.parse(s.text).jobId; let killed = false;
  const ev = await req("GET", `/api/jobs/${id}/events`, { onChunk: t => {
    if (killOnSign && !killed && t.includes("event: decision") && t.includes('"action":"sign"')) {
      killed = true; const web = JSON.parse(readFileSync(path.join(ROOT, "web/run/stub/pids.json"), "utf8")).web;
      const kids = spawnSync("pgrep", ["-P", String(web)], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
      for (const k of kids) { try { process.kill(Number(k), "SIGKILL"); console.log(`(killed agent child pid ${k} with SIGKILL after the sign event)`); } catch { /* gone */ } }
    } } });
  console.log("SSE transcript:\n" + ev.text.trim());
  return ev.text;
}
const cfg0 = JSON.parse((await req("GET", "/api/config")).text); csrf = cfg0.csrfToken;
const { buyerAddress, payTo } = cfg0.wallet;
console.log("mode:", cfg0.mode, "| session:", JSON.stringify(cfg0.session), "| busy:", cfg0.busy);
const before = { buyer: await usdc(buyerAddress), payTo: await usdc(payTo) }; console.log("balances before (atomic USDC):", before);

// refusals that cost nothing
console.log("\n=== spoofed Host ===", (await req("GET", "/api/config", { host: "evil.example" })).status);
console.log("=== wrong Origin ===", (await req("POST", "/api/submit", { body: "x", origin: "http://evil.example" })).status);
console.log("=== oversize (65537 B) ===", (await req("POST", "/api/submit", { body: Buffer.alloc(65537, 65) })).status);

await job("1 reproduced -> bond returned", "real_integration_1.bin"); 
const early = await req("POST", "/api/submit", { body: Buffer.from("too soon") }); console.log("\n=== immediate resubmit ===", early.status, early.text);
if (process.argv.includes("--kill")) { await sleep(12000); await job("2 killed child", "real_integration_killed.bin", { killOnSign: true }); await sleep(8000); }
await sleep(12000);
await job("3 not_reproduced -> bond forfeited", "fake_integration_3.bin");
await sleep(12000);
const over = await req("POST", "/api/submit", { body: Buffer.from("over budget"), headers: { "x-filename": "fake_over.bin" } }); console.log("\n=== over-budget submit ===", over.status, over.text);

await sleep(3000);
const log = JSON.parse((await req("GET", "/api/log")).text);
console.log("\n=== /api/log ===\nverify:", JSON.stringify(log.verify), "\nhead:", JSON.stringify(log.head), "\nsigner:", log.signer);
let sum = 0n, bad = 0;
for (const r of log.records) {
  console.log(`seq ${r.seq} ${r.verdict} settled=${r.settledAtomic} status=${r.settlementStatus} sigOk=${r.sigOk} tx=${r.txSignature}`);
  sum += BigInt(r.settledAtomic);
  if (r.txSignature) {
    const tx = await rpc("getTransaction", [r.txSignature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 2 }]);
    const bal = a => (a ?? []).filter(b => b.mint === USDC && b.owner === payTo).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const d = bal(tx?.meta?.postTokenBalances) - bal(tx?.meta?.preTokenBalances);
    const ok = tx && !tx.meta.err && d === BigInt(r.settledAtomic); if (!ok) bad++;
    console.log(`   chain: ${tx ? (tx.meta.err ? "TX FAILED" : "confirmed") : "NOT FOUND"}, payTo USDC delta ${d} ${ok ? "== logged" : "!= LOGGED"}`);
  }
}
const after = { buyer: await usdc(buyerAddress), payTo: await usdc(payTo) };
console.log("balances after:", after, "| buyer delta", after.buyer - before.buyer, "| payTo delta", after.payTo - before.payTo, "| sum settled in log", sum);
const cfg1 = JSON.parse((await req("GET", "/api/config")).text); console.log("session now:", JSON.stringify(cfg1.session), "busy:", cfg1.busy);
const consistent = after.buyer - before.buyer === -sum && after.payTo - before.payTo === sum && bad === 0 && log.verify.ok;
console.log(consistent ? "\nINTEGRATION CHECKS PASSED" : "\nINTEGRATION CHECKS FAILED"); process.exit(consistent ? 0 : 1);
