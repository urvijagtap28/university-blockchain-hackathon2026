#!/usr/bin/env node
// One-command demo for Prove-It Bond. Devnet only. Node built-ins only (plus @scure/base borrowed from server/node_modules).
//   bash scripts/demo.sh --stub            STUB verifier (Mac-safe). Results are labeled as NOT a real sandbox run.
//   bash scripts/demo.sh --real            Real verifier (verify.py + Docker + ARVO images; amd64 host only).
//   --preflight-only                       run the preflight and exit (no processes started, no devnet txs)
//   --analyze <run-dir> [--out <file>]     re-verify and re-render an existing run directory (no processes started)
//   --manifest <file>                      default demo/manifest.json
// Secrets: keys are read from the repo .env, never printed. Only public addresses and lengths are shown.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN = path.join(ROOT, "demo", "run");
const { base58 } = createRequire(path.join(ROOT, "server", "package.json"))("@scure/base");
const CAP = 250000n;
const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SERVER_PORT = 4021, FAC_PORT = 4022;
const SPACING_MS = 11500; // server rate limit is 10 s per wallet
const MIN_FAC_SOL = 0.05;
const CATEGORIES = ["real_bug", "hand_made_fake", "flaky_or_timeout", "crash_on_both"];
const explorer = sig => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = b => createHash("sha256").update(b).digest("hex");
const usd = a => (Number(a) / 1e6).toFixed(6);

class Fail extends Error {}
const fail = m => { throw new Fail(m); };

// ---------- args ----------
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const opt = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const MODE = flag("--real") ? "real" : flag("--stub") ? "stub" : null;
const ANALYZE = opt("--analyze");
const MANIFEST = path.resolve(ROOT, opt("--manifest") ?? "demo/manifest.json");

// ---------- children (always stopped by PID / process group, never by pattern) ----------
const procs = [];
let currentAgent = null;
let aborted = false;
function killGroup(p, sig) { try { process.kill(-p.pid, sig); } catch { /* already gone */ } }
const alive = p => { try { process.kill(-p.pid, 0); return true; } catch { return false; } };
async function stopAll() {
  if (currentAgent) { try { process.kill(currentAgent.pid, "SIGKILL"); } catch { /* gone */ } currentAgent = null; }
  for (const p of [...procs].reverse()) killGroup(p, "SIGTERM");
  for (let i = 0; i < 40 && procs.some(alive); i++) await sleep(250);
  for (const p of procs) if (alive(p)) { killGroup(p, "SIGKILL"); console.error(`  (${p.name} pid ${p.pid} needed SIGKILL)`); }
}
process.on("exit", () => { for (const p of procs) if (alive(p)) killGroup(p, "SIGKILL"); });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => {
  if (aborted) return; aborted = true;
  console.error(`\n${s}: stopping children by PID and exiting non-zero`);
  await stopAll(); process.exit(130);
});

function startProc(name, cmd, args, { cwd, env, logFile }) {
  const fd = openSync(logFile, "a");
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const p = { name, pid: child.pid, exited: false, code: null };
  child.on("exit", c => { p.exited = true; p.code = c; });
  child.on("error", e => { p.exited = true; p.code = "spawn error: " + e.code; });
  procs.push(p);
  writeFileSync(path.join(RUN, "pids.json"), JSON.stringify(Object.fromEntries(procs.map(x => [x.name, x.pid]))));
  return p;
}

// ---------- helpers ----------
const portFree = port => new Promise(res => {
  const s = createServer(); s.once("error", () => res(false)); s.listen(port, () => s.close(() => res(true)));
});
async function rpc(method, params) {
  const url = process.env.SVM_RPC_URL;
  let lastErr = "";
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) { lastErr = `${method}: ${String(j.error.message).slice(0, 120)}`; await sleep(1500); continue; }
      return j.result;
    } catch (e) { lastErr = `${method}: ${e.name}`; await sleep(1500); }
  }
  throw new Error("RPC failed (" + lastErr + ")"); // never includes the URL
}
const pubOf = k => base58.encode(base58.decode(k.trim()).slice(32));
async function solBalance(addr) { return (await rpc("getBalance", [addr, { commitment: "confirmed" }])).value / 1e9; }
async function usdcBalance(addr) {
  const r = await rpc("getTokenAccountsByOwner", [addr, { mint: USDC_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]);
  return r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}
function loadManifest() {
  let m; try { m = JSON.parse(readFileSync(MANIFEST, "utf8")); } catch { fail(`cannot read manifest ${MANIFEST}`); }
  if (!Array.isArray(m.entries) || !m.entries.length) fail("manifest has no entries");
  for (const [i, e] of m.entries.entries()) {
    if (!CATEGORIES.includes(e.category)) fail(`manifest entry ${i}: category must be one of ${CATEGORIES.join(", ")}`);
    const f = path.resolve(ROOT, e.input);
    if (!existsSync(f)) fail(`manifest entry ${i}: input does not exist: ${e.input}`);
    e.abs = f; e.sha = sha256(readFileSync(f));
    if (readFileSync(f).length === 0) fail(`manifest entry ${i}: empty input (the server rejects empty bodies); pick another`);
  }
  if (!/^[0-9]{1,12}$/.test(String(m.case ?? ""))) fail("manifest.case must be a numeric case id");
  return m;
}

// ---------- preflight ----------
async function preflight(manifest) {
  const info = {};
  console.log(`== Preflight (mode: ${MODE ?? "analyze"}) ==`);
  try { process.loadEnvFile(path.join(ROOT, ".env")); } catch { fail("cannot read the repo .env (copy .env.example and fill it in)"); }
  for (const k of ["SVM_RPC_URL", "SVM_ADDRESS", "SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY", "AGENT_SVM_PRIVATE_KEY", "SVM_PRIVATE_KEY", "LOG_SIGNING_KEY", "FACILITATOR_URL"]) {
    const v = process.env[k]?.trim();
    if (!v) fail(`${k} is missing or empty in .env`);
    if (!/^[\x20-\x7e]+$/.test(v)) fail(`${k} contains non-ASCII characters (curly quotes?)`);
    console.log(`  ${k}: set (length ${v.length})`);
  }
  if (process.env.FACILITATOR_URL.trim() !== `http://localhost:${FAC_PORT}`) fail(`FACILITATOR_URL must be http://localhost:${FAC_PORT} for the demo`);
  const ce = spawnSync("node", [path.join(ROOT, "scripts", "check-env.mjs")], { env: process.env, encoding: "utf8" });
  if (ce.status !== 0) fail("scripts/check-env.mjs: " + ((ce.stderr || ce.stdout).trim() || "failed"));
  console.log("  " + ce.stdout.trim());
  try {
    info.facAddr = pubOf(process.env.SVM_PRIVATE_KEY); info.buyerAddr = pubOf(process.env.AGENT_SVM_PRIVATE_KEY);
    info.signerPub = pubOf(process.env.LOG_SIGNING_KEY);
  } catch { fail("a key in .env is not a base58 64-byte keypair"); }
  info.payTo = process.env.SVM_ADDRESS.trim();
  const n = manifest.entries.length;
  const need = BigInt(n) * CAP;
  const budget = Math.round(Number(process.env.AGENT_SESSION_BUDGET_USD || "2") * 1e6);
  if (Number(need) > budget) fail(`batch worst case ${usd(need)} USDC exceeds AGENT_SESSION_BUDGET_USD`);
  info.facSolBefore = await solBalance(info.facAddr);
  info.buyerUsdcBefore = await usdcBalance(info.buyerAddr);
  info.payToUsdcBefore = await usdcBalance(info.payTo);
  console.log(`  facilitator wallet ${info.facAddr}: ${info.facSolBefore.toFixed(4)} SOL (need >= ${MIN_FAC_SOL})`);
  console.log(`  buyer wallet       ${info.buyerAddr}: ${usd(info.buyerUsdcBefore)} USDC (need >= ${usd(need)} for ${n} reports)`);
  console.log(`  payTo wallet       ${info.payTo}: ${usd(info.payToUsdcBefore)} USDC${info.payTo === info.buyerAddr ? " (same as buyer)" : ""}`);
  console.log(`  log signer public key: ${info.signerPub}`);
  if (info.facSolBefore < MIN_FAC_SOL) fail(`facilitator wallet has ${info.facSolBefore.toFixed(4)} SOL, needs >= ${MIN_FAC_SOL} (devnet airdrop/faucet)`);
  if (info.buyerUsdcBefore < need) fail(`buyer wallet has ${usd(info.buyerUsdcBefore)} USDC, needs >= ${usd(need)} (devnet USDC faucet)`);

  if (MODE === "real") {
    if (process.env.ALLOW_STUB_VERIFIER?.trim()) fail("ALLOW_STUB_VERIFIER is set; unset it for --real");
    if (process.env.VERIFIER_PATH?.trim()) fail("VERIFIER_PATH is set; unset it for --real (must use verifier/verify.py)");
    const di = spawnSync("docker", ["info", "--format", "{{.Architecture}}"], { encoding: "utf8" });
    if (di.status !== 0) fail("docker is not available or the daemon is not running (docker info failed)");
    const arch = di.stdout.trim();
    if (!/^(x86_64|amd64)$/.test(arch)) fail(`docker architecture is "${arch}"; --real needs an amd64 host (the ARVO ASan images are amd64-only; QEMU emulation gives exit 137, see STATUS.md)`);
    const cases = JSON.parse(readFileSync(path.join(ROOT, "verifier", "cases.json"), "utf8")).cases[manifest.case];
    if (!cases) fail(`case ${manifest.case} not in verifier/cases.json`);
    for (const img of [cases.vul.image, cases.fix.image]) {
      if (spawnSync("docker", ["image", "inspect", img], { encoding: "utf8" }).status !== 0) fail(`ARVO image missing locally: ${img} (docker pull it)`);
    }
    const py = process.env.VERIFIER_PYTHON?.trim() || "python3";
    if (spawnSync(py, ["--version"], { encoding: "utf8" }).status !== 0) fail(`VERIFIER_PYTHON (${py}) not runnable`);
    console.log(`  docker ${arch}, images for case ${manifest.case} present, python ok`);
  } else if (MODE === "stub") {
    console.log("  STUB mode: verifier/verify_stub.py, ALLOW_STUB_VERIFIER=1, no VERIFIER_CASE. Verdicts are routed on filename and mean nothing about bugs.");
  }
  if (MODE) {
    for (const [name, port] of [["server", SERVER_PORT], ["facilitator", FAC_PORT]]) {
      if (!(await portFree(port))) fail(`port ${port} (${name}) is already in use; stop whatever holds it (not killing by pattern)`);
    }
    console.log(`  ports ${SERVER_PORT} and ${FAC_PORT} are free`);
  }
  console.log("  preflight OK\n");
  return info;
}

// ---------- environments ----------
const pick = (names, prefixes = []) => Object.fromEntries(Object.entries(process.env).filter(([k]) => names.includes(k) || prefixes.some(p => k.startsWith(p))));
const BASE = ["PATH", "HOME", "TMPDIR", "LANG", "USER"];
function facilitatorEnv() {
  return { ...pick(BASE, ["EVM_", "RENT_", "MAX_CHANNEL"]), ...pick(["SVM_PRIVATE_KEY", "SVM_RPC_URL", "FACILITATOR_DIR"]), FACILITATOR_PORT: String(FAC_PORT) }; // no PORT
}
function serverEnv(manifest) {
  const env = { ...process.env, SERVER_PORT: String(SERVER_PORT), LOG_PATH: path.join(RUN, "verdicts.jsonl") };
  delete env.PORT; delete env.SVM_PRIVATE_KEY; // facilitator fee-payer key and buyer key never reach the server
  for (const k of Object.keys(env)) if (k.startsWith("AGENT_")) delete env[k];
  if (MODE === "stub") { env.ALLOW_STUB_VERIFIER = "1"; env.VERIFIER_PATH = path.join(ROOT, "verifier", "verify_stub.py"); env.VERIFIER_CASE = ""; }
  else { delete env.ALLOW_STUB_VERIFIER; delete env.VERIFIER_PATH; env.VERIFIER_CASE = manifest.case; }
  return env;
}
function agentEnv(entry, idx) {
  const env = { ...pick(BASE), ...pick(["MAX_INPUT_BYTES"], ["AGENT_"]) };
  env.AGENT_ALLOWED_URL = `http://localhost:${SERVER_PORT}/report`;
  env.AGENT_AUTO_APPROVE_USD = "0.25"; // child environment only
  env.AGENT_LOG_PATH = path.join(RUN, "agent-decisions.log");
  delete env.AGENT_TEST_FILENAME;
  if (MODE === "stub") { // the stub routes on filename; real*/flaky*/anything else
    env.AGENT_TEST_FILENAME = ({ real_bug: "real_bug", flaky_or_timeout: "flaky" }[entry.category] ?? "fake") + `_${idx + 1}.bin`;
  }
  return env;
}

async function waitFor(name, p, test, secs) {
  for (let i = 0; i < secs * 2; i++) {
    if (p.exited) fail(`${name} exited early (code ${p.code}); see ${path.join("demo", "run", name + ".log")}`);
    try { if (await test()) return; } catch { /* not ready */ }
    await sleep(500);
  }
  fail(`${name} not ready after ${secs}s; see demo/run/${name}.log`);
}

// ---------- batch ----------
function runAgent(entry, idx) {
  return new Promise(resolve => {
    const child = spawn("node", ["src/cli.ts", entry.abs], { cwd: path.join(ROOT, "agent"), env: agentEnv(entry, idx), stdio: ["ignore", "pipe", "pipe"] });
    currentAgent = child;
    let out = "", err = "";
    child.stdout.on("data", d => (out += d)); child.stderr.on("data", d => (err += d));
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, 180000);
    child.on("exit", code => {
      clearTimeout(t); currentAgent = null;
      const line = out.split("\n").reverse().find(l => l.startsWith("{"));
      let parsed = null; try { parsed = JSON.parse(line); } catch { /* none */ }
      resolve({ code, result: parsed, stderrTail: err.trim().split("\n").slice(-2).join(" | ").slice(0, 300) });
    });
  });
}

// ---------- analysis (from the verdict log) ----------
async function analyze({ dir, manifest, meta, agentRuns }) {
  const problems = [];
  const logPath = path.join(dir, "verdicts.jsonl");
  let records = [];
  if (!existsSync(logPath)) problems.push("verdict log file missing");
  else records = readFileSync(logPath, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { problems.push("unparseable log line"); return null; } }).filter(Boolean);

  const vl = spawnSync("node", [path.join(ROOT, "server", "scripts", "verify-log.ts"), logPath, "--pubkey", meta.signerPub], { encoding: "utf8", env: pick(BASE) });
  const vlOut = (vl.stdout + vl.stderr).trim();
  console.log("== Signed log verification (pinned public key) ==\n" + vlOut.split("\n").filter(l => !l.startsWith("Cannot prove")).join("\n"));
  if (vl.status !== 0) problems.push(`verify-log.ts exit ${vl.status} (signature/chain/pin check failed)`);

  // Match manifest entries to records by proof hash, in order.
  const used = new Set();
  const rows = manifest.entries.map((e, i) => {
    const ri = records.findIndex((r, j) => !used.has(j) && r.reportHash === e.sha);
    if (ri >= 0) used.add(ri); else problems.push(`no log record for entry ${i + 1} (${e.input})`);
    const r = ri >= 0 ? records[ri] : null;
    const a = agentRuns[i]?.result;
    if (!a || a.status !== "done") problems.push(`entry ${i + 1}: agent status ${a?.status ?? "missing"}${agentRuns[i]?.stderrTail ? " (" + agentRuns[i].stderrTail + ")" : ""}`);
    return { i, e, r, a };
  });
  if (records.length > used.size) problems.push(`${records.length - used.size} log record(s) not matched to a manifest entry`);

  // Check each tx and amount on chain.
  let sumSettled = 0n;
  for (const row of rows) {
    const r = row.r; if (!r) continue;
    const amt = (() => { try { return BigInt(r.settledAtomic); } catch { return -1n; } })();
    row.amt = amt;
    if (amt >= 0n && amt <= CAP) sumSettled += amt;
    if (amt < 0n || amt > CAP) problems.push(`entry ${row.i + 1}: settled amount ${r.settledAtomic} outside [0, ${CAP}]`);
    if (row.a && row.a.settledAtomic !== undefined && String(row.a.settledAtomic) !== String(r.settledAtomic)) problems.push(`entry ${row.i + 1}: agent saw settled ${row.a.settledAtomic} but log says ${r.settledAtomic}`);
    if (r.settlementStatus !== "settled") problems.push(`entry ${row.i + 1}: settlementStatus ${r.settlementStatus}`);
    if (!r.txSignature) { problems.push(`entry ${row.i + 1}: no tx signature`); row.chain = "no tx"; continue; }
    let tx = null;
    for (let k = 0; k < 6 && !tx; k++) { try { tx = await rpc("getTransaction", [r.txSignature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 2 }]); } catch { /* retry */ } if (!tx) await sleep(2000); }
    if (!tx) { problems.push(`entry ${row.i + 1}: tx ${r.txSignature.slice(0, 12)}... cannot be confirmed via RPC`); row.chain = "NOT CONFIRMED"; continue; }
    if (tx.meta?.err) { problems.push(`entry ${row.i + 1}: tx failed on chain`); row.chain = "TX FAILED"; continue; }
    const bal = (arr) => (arr ?? []).filter(b => b.mint === USDC_MINT && b.owner === meta.payTo).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    const delta = bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances);
    row.chainDelta = delta;
    if (meta.payTo !== meta.buyerAddr && delta !== amt) { problems.push(`entry ${row.i + 1}: on-chain payTo USDC delta ${delta} != logged settled ${amt}`); row.chain = `MISMATCH (chain ${delta})`; }
    else row.chain = "confirmed";
  }
  // Aggregate balance check (only meaningful when this run is the only activity on the wallets).
  const bal = meta.balancesAfter ?? {};
  const expBuyer = meta.payTo === meta.buyerAddr ? 0n : -sumSettled;
  const dBuyer = bal.buyerUsdc !== undefined ? BigInt(bal.buyerUsdc) - BigInt(meta.buyerUsdcBefore) : null;
  const dPayTo = bal.payToUsdc !== undefined ? BigInt(bal.payToUsdc) - BigInt(meta.payToUsdcBefore) : null;
  if (dBuyer !== null && dBuyer !== expBuyer) problems.push(`buyer USDC delta ${dBuyer} != expected ${expBuyer} from the log`);
  if (dPayTo !== null && meta.payTo !== meta.buyerAddr && dPayTo !== sumSettled) problems.push(`payTo USDC delta ${dPayTo} != sum settled in log ${sumSettled}`);

  const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  const head = lines.length ? { seq: records[records.length - 1]?.seq, hash: sha256(lines[lines.length - 1]) } : null;
  const c = { reproduced: 0, forfeited: 0, wrongForfeit: 0, inconclusive: 0, errors: 0, fakeReproduced: 0 };
  for (const { e, r, a } of rows) {
    const v = r?.verdict;
    if (v === "reproduced") { c.reproduced++; if (e.category === "hand_made_fake") c.fakeReproduced++; }
    else if (v === "not_reproduced") { c.forfeited++; if (e.category === "real_bug") c.wrongForfeit++; }
    else if (v === "inconclusive") c.inconclusive++;
    else c.errors++;
    if (r && a && a.verdict && a.verdict !== v) problems.push(`agent verdict ${a.verdict} != logged ${v}`);
  }
  return { problems, rows, records, c, head, sumSettled, dBuyer, dPayTo, expBuyer, vlOut, vlOk: vl.status === 0 };
}

function printTable(rows) {
  console.log("\n== Verdicts (from the signed log) ==");
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${w("#", 2)} ${w("input", 34)} ${w("category", 15)} ${w("verdict", 14)} ${w("settled", 9)} chain`);
  for (const { i, e, r, chain, amt } of rows) {
    console.log(`${w(i + 1, 2)} ${w(path.basename(e.input), 34)} ${w(e.category, 15)} ${w(r?.verdict ?? "MISSING", 14)} ${w(r ? usd(amt ?? 0n) : "-", 9)} ${chain ?? "-"}`);
    if (r?.txSignature) console.log(`   tx ${r.txSignature}\n   ${explorer(r.txSignature)}`);
  }
}

function writeResults(file, { manifest, meta, res }) {
  const { c, rows, head, problems } = res;
  const stub = meta.mode === "stub";
  const r0 = res.records[0] ?? {};
  const L = [];
  if (stub) L.push("# STUB VERIFIER: not a real sandbox run", "",
    "> **These verdicts came from `verifier/verify_stub.py`, which routes on a filename chosen by the test harness. They say nothing about whether any input reproduces any bug.** Only the payment, settlement, agent and signed-log plumbing was exercised. Do not quote these verdicts or counts as results.", "");
  else L.push("# Demo results: REAL verifier run", "",
    "> Mode `--real`: verdicts from `verifier/verify.py` (Docker, AddressSanitizer, ARVO libucl images). Generated by `demo/run.mjs` from the signed verdict log, not from the agent's console output.", "");
  L.push(`- Mode: **${stub ? "STUB (not a real sandbox run)" : "REAL verifier"}**`);
  L.push(`- Generated: ${meta.finishedAt} (UTC) by \`demo/run.mjs\`; network: Solana devnet; per-report cap 0.25 USDC`);
  L.push(`- Result of the run's own checks: **${problems.length ? "FAILED" : "all passed"}**${problems.length ? "\n" + problems.map(p => `  - ${p}`).join("\n") : ""}`);
  L.push("", "## Counts", "",
    "| Outcome | Count |", "|---|---|",
    `| Reproduced (bond returned) | ${c.reproduced} |`,
    `| Not reproduced (bond forfeited) | ${c.forfeited} |`,
    `| Wrongly forfeited real bugs (category real_bug but not_reproduced) | ${c.wrongForfeit} |`,
    `| Hand-made fakes judged reproduced | ${c.fakeReproduced} |`,
    `| Inconclusive (bond returned) | ${c.inconclusive} |`,
    `| Errors or failures (no valid verdict, unsettled, missing record) | ${c.errors} |`,
    "", `Ground truth for "wrongly forfeited" is the manifest category (\`${path.relative(ROOT, MANIFEST)}\`). ${rows.length} reports in this run.`);
  if (stub) L.push("", "_Stub counts only show that the routing and money paths work; the stub decides the verdict from the filename._");
  L.push("", "## Reports", "", "| # | Input | Label | Category | Verdict | Settled (USDC) | Tx | On-chain |", "|---|---|---|---|---|---|---|---|");
  for (const { i, e, r, chain, amt } of rows) {
    L.push(`| ${i + 1} | \`${e.input}\` | ${e.label} | ${e.category} | ${r?.verdict ?? "MISSING"} | ${r ? usd(amt ?? 0n) : "-"} | ${r?.txSignature ? `[${r.txSignature.slice(0, 12)}...](${explorer(r.txSignature)})` : "-"} | ${chain ?? "-"} |`);
  }
  L.push("", "Hand-made fakes are labeled HAND-MADE in the labels above; they are our own inputs, not real-world spam.");
  const nReal = manifest.entries.filter(e => e.category === "real_bug").length;
  const nFake = manifest.entries.filter(e => e.category === "hand_made_fake").length;
  L.push("", "## Demo set composition", "",
    `- This demo batch contains ${nReal} real bugs and ${nFake} hand-made fakes (${rows.length} reports). Hand-picked, tiny; not a sample of real-world reports.`,
    "- **The proof is an input file only.** No report text is part of the protocol, so the fakes are inputs, not written reports. The random-bytes fake is a HAND-MADE robustness check and is NOT representative of LLM-written slop reports.",
    "- Other hand-made fakes exist in `test-inputs/fake/` and were NOT part of this demo batch:",
    "  - `hand_made_fake_empty.bin`: the server rejects empty bodies, so it never reaches the verifier; kept as a server test.",
    "  - `hand_made_fake_config.ucl`, `hand_made_fake_deep_nesting.ucl`, `hand_made_fake_large_config.ucl`: redundant clean inputs exercising the same path as the fakes above.",
    "- All seven hand-made fakes (including these four) are in `backtest/RESULTS.md` set B, where each was run through the real verifier and forfeited (`not_reproduced`). See that file for the table.");
  L.push("", "## Provenance of this file", "",
    `- Signer public key (ed25519, pinned from \`LOG_SIGNING_KEY\`): \`${meta.signerPub}\``,
    `- Log: ${res.records.length} records, verification: **${res.vlOk ? "OK, pinned key" : "FAILED"}** (\`node server/scripts/verify-log.ts <log> --pubkey <signer>\`)`,
    `- Log head: seq ${head?.seq ?? "-"}, sha256 of last line \`${head?.hash ?? "-"}\``,
    "  - Tail truncation is undetectable from the log alone: dropping the last N records leaves a valid chain. Publish this head hash and seq somewhere else (README, Devpost) to make truncation detectable. Records are server-signed, so they are not independent proof that the server told the truth either.",
    `- Settled total per log: ${usd(res.sumSettled)} USDC; buyer USDC delta ${res.dBuyer === null ? "n/a" : usd(res.dBuyer)} (expected ${usd(res.expBuyer)}); payTo USDC delta ${res.dPayTo === null ? "n/a" : usd(res.dPayTo)}`,
    `- Buyer wallet ${meta.buyerAddr}; payTo ${meta.payTo}${meta.payTo === meta.buyerAddr ? " (SAME wallet: a forfeit is a self-payment)" : " (both wallets are ours: a forfeit is a transfer between our own wallets, not a payment to a third party)"}`);
  L.push("", "## Target", "");
  if (stub) L.push("No target: the stub verifier does not run any library. (`caseId`, commits and images are null in the log in stub mode.)");
  else L.push(`- Case \`${r0.caseId}\`; libucl vulnerable commit \`${r0.targetCommit}\`; fixed-control commit \`${r0.fixCommit}\``,
    `- Images: \`${r0.vulImage}\` (vulnerable), \`${r0.fixImage}\` (fixed)`,
    `- cases.json sha256 \`${r0.casesSha256}\`; verifier sha256 \`${r0.verifierSha256}\``,
    "- **Caveat (libucl/ARVO):** the \"fixed\" image is a later libucl version, not the per-bug fix commit (see `docs/DECISIONS.md` and `backtest/RESULTS.md`). So `reproduced` means: the input triggers the expected ASan error in libucl code on the pinned vulnerable build, and the crash is gone in a later libucl.");
  L.push("", "## Not demonstrated", "");
  const have = new Set(manifest.entries.map(e => e.category));
  for (const cat of ["flaky_or_timeout", "crash_on_both"]) if (!have.has(cat)) L.push(`- \`${cat}\`: NOT demonstrated. The backtest found no genuine example and we do not fake one.`);
  L.push("- The deep-nesting input (`hand_made_fake_deep_nesting.ucl`) was run through the real verifier in the backtest (`backtest/RESULTS.md` set B) and returned `not_reproduced`, so it is NOT a flaky/timeout or crash-on-both example.");
  L.push("", "## What this does and does not show", "",
    "- The sandbox is a filter, not a judge: a human triages `reproduced` reports, and a `not_reproduced` verdict only means this pinned build ran the input clean.",
    "- This demo does not prove that spam is stopped. It is a small, hand-picked batch.",
    "- Buyer, seller and facilitator wallets belong to the demo operator; devnet only.",
    stub ? "- Everything about the real verifier, Docker and ASan is UNEXERCISED in this file." : "- Real-mode run: see BUILD_LOG.md for the host and date it was run on.", "");
  writeFileSync(file, L.join("\n"));
}

// Machine-readable twin of RESULTS.md for demo/web/build.mjs. Same `res`, so the two cannot disagree. Public data only.
// Per-record status is derived from the PROBLEM lines of server/scripts/verify-log.ts (verifyLogText): a record is "verified" if no problem names its line.
function writeResultsJson(file, { manifest, meta, res }) {
  const broken = new Map();
  for (const m of res.vlOut.matchAll(/^PROBLEM line (\d+): (.*)$/gm)) { const k = Number(m[1]) - 1; broken.set(k, [...(broken.get(k) ?? []), m[2]]); }
  const j = {
    schema: 1, mode: meta.mode, generatedAt: new Date().toISOString(),
    meta: { startedAt: meta.startedAt, finishedAt: meta.finishedAt, signerPub: meta.signerPub, buyerAddr: meta.buyerAddr, payTo: meta.payTo, facAddr: meta.facAddr,
      buyerUsdcBefore: meta.buyerUsdcBefore, payToUsdcBefore: meta.payToUsdcBefore, balancesAfter: meta.balancesAfter ?? null },
    log: { records: res.records.length, verifiedCount: res.records.length - [...broken.keys()].filter(k => k >= 0 && k < res.records.length).length, brokenLines: Object.fromEntries([...broken].map(([k, v]) => [k + 1, v])),
      verifyOk: res.vlOk, head: res.head ?? null, depositTxRecorded: false },
    counts: res.c, problems: res.problems,
    rows: res.rows.map(({ i, e, r, a, chain, amt }) => ({
      entry: i + 1, label: e.label, category: e.category, file: path.basename(e.input),
      seq: r?.seq ?? null, verdict: r?.verdict ?? null, detail: r?.detail ?? null,
      settledAtomic: r ? String(r.settledAtomic) : null, settlementStatus: r?.settlementStatus ?? null,
      txSignature: r?.txSignature ?? null, chain: chain ?? null, agentStatus: a?.status ?? null,
      recordVerified: r ? !broken.has(r.seq) : false })),
    notDemonstrated: ["flaky_or_timeout", "crash_on_both"].filter(c => !manifest.entries.some(e => e.category === c)),
    target: res.records[0] ? { caseId: res.records[0].caseId, targetCommit: res.records[0].targetCommit, fixCommit: res.records[0].fixCommit, vulImage: res.records[0].vulImage, fixImage: res.records[0].fixImage } : null,
  };
  writeFileSync(file, JSON.stringify(j, null, 1));
}

// ---------- main ----------
async function main() {
  if (!MODE && !ANALYZE) fail("usage: scripts/demo.sh --stub | --real [--preflight-only]  |  --analyze <run-dir> [--out file]");
  const manifest = loadManifest();

  if (ANALYZE) {
    process.loadEnvFile(path.join(ROOT, ".env"));
    const dir = path.resolve(ANALYZE);
    const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
    const agentRuns = JSON.parse(readFileSync(path.join(dir, "agent-results.json"), "utf8"));
    const res = await analyze({ dir, manifest, meta, agentRuns });
    printTable(res.rows);
    const out = path.resolve(opt("--out") ?? path.join(dir, "RESULTS.md"));
    writeResults(out, { manifest, meta: { ...meta, finishedAt: new Date().toISOString() }, res });
    writeResultsJson(path.join(dir, "results.json"), { manifest, meta: { ...meta, finishedAt: meta.finishedAt ?? new Date().toISOString() }, res });
    console.log(`\nwrote ${out}`);
    console.log(res.problems.length ? `\nFAILED:\n${res.problems.map(p => "  - " + p).join("\n")}` : "\nALL CHECKS PASSED");
    return res.problems.length ? 1 : 0;
  }

  const info = await preflight(manifest);
  if (flag("--preflight-only")) return 0;

  rmSync(RUN, { recursive: true, force: true }); mkdirSync(RUN, { recursive: true });
  const meta = { mode: MODE, startedAt: new Date().toISOString(), signerPub: info.signerPub, buyerAddr: info.buyerAddr, payTo: info.payTo, facAddr: info.facAddr,
    buyerUsdcBefore: info.buyerUsdcBefore.toString(), payToUsdcBefore: info.payToUsdcBefore.toString(), facSolBefore: info.facSolBefore };
  const agentRuns = [];
  try {
    console.log("== Starting services (facilitator once; never restarted) ==");
    const fac = startProc("facilitator", "sh", [path.join(ROOT, "server", "scripts", "start-facilitator.sh")], { cwd: ROOT, env: facilitatorEnv(), logFile: path.join(RUN, "facilitator.log") });
    await waitFor("facilitator", fac, async () => (await fetch(`http://127.0.0.1:${FAC_PORT}/supported`, { signal: AbortSignal.timeout(3000) })).ok, 90);
    console.log(`  facilitator pid ${fac.pid} ready on ${FAC_PORT}`);
    const srv = startProc("server", "node", ["src/index.ts"], { cwd: path.join(ROOT, "server"), env: serverEnv(manifest), logFile: path.join(RUN, "server.log") });
    await waitFor("server", srv, async () => (await fetch(`http://127.0.0.1:${SERVER_PORT}/report`, { method: "POST", body: "", signal: AbortSignal.timeout(3000) })).status === 402, 60);
    console.log(`  server pid ${srv.pid} ready on ${SERVER_PORT} (unpaid probe got 402)\n`);

    console.log(`== Batch: ${manifest.entries.length} reports through the submitter agent (mode ${MODE}) ==`);
    for (const [i, e] of manifest.entries.entries()) {
      if (aborted) break;
      if (i > 0) await sleep(SPACING_MS);
      process.stdout.write(`  [${i + 1}/${manifest.entries.length}] ${path.basename(e.input)} (${e.category}) ... `);
      const run = await runAgent(e, i);
      agentRuns.push(run);
      console.log(run.result ? `${run.result.status} ${run.result.verdict ?? ""} settled=${run.result.settledAtomic ?? "?"}` : `agent exit ${run.code}, no result line`);
    }
    // Let the server's recorder flush, then stop services before reading the log.
    await sleep(2000);
  } finally {
    await stopAll();
  }
  for (const [name, port] of [["server", SERVER_PORT], ["facilitator", FAC_PORT]]) console.log(`  ${name} stopped; port ${port} ${(await portFree(port)) ? "free" : "STILL IN USE"}`);

  meta.finishedAt = new Date().toISOString();
  meta.balancesAfter = { buyerUsdc: (await usdcBalance(info.buyerAddr)).toString(), payToUsdc: (await usdcBalance(info.payTo)).toString(), facSol: await solBalance(info.facAddr) };
  writeFileSync(path.join(RUN, "meta.json"), JSON.stringify(meta, null, 1));
  writeFileSync(path.join(RUN, "agent-results.json"), JSON.stringify(agentRuns, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1));
  console.log(`  balances after: facilitator ${meta.balancesAfter.facSol.toFixed(4)} SOL, buyer ${usd(meta.balancesAfter.buyerUsdc)} USDC, payTo ${usd(meta.balancesAfter.payToUsdc)} USDC\n`);

  const res = await analyze({ dir: RUN, manifest, meta, agentRuns });
  printTable(res.rows);
  const out = path.join(ROOT, "RESULTS.md");
  writeResults(out, { manifest, meta, res });
  writeResultsJson(path.join(RUN, "results.json"), { manifest, meta, res });
  console.log(`\nwrote ${out}   (mode: ${MODE === "stub" ? "STUB VERIFIER: not a real sandbox run" : "REAL"})`);
  console.log(`counts: reproduced ${res.c.reproduced}, forfeited ${res.c.forfeited}, wrongly forfeited real bugs ${res.c.wrongForfeit}, inconclusive ${res.c.inconclusive}, errors ${res.c.errors}`);
  console.log(`log head: seq ${res.head?.seq} sha256(last line) ${res.head?.hash}`);
  console.log(res.problems.length ? `\nFAILED:\n${res.problems.map(p => "  - " + p).join("\n")}` : "\nALL CHECKS PASSED");
  return res.problems.length ? 1 : 0;
}

try { process.exitCode = await main(); }
catch (e) {
  await stopAll();
  if (e instanceof Fail) { console.error(`\nDEMO FAILED: ${e.message}`); process.exitCode = 2; }
  else { console.error(`\nDEMO ERROR: ${e?.message ?? e}`); process.exitCode = 1; }
}
