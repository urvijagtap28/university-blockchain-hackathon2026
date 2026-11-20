#!/usr/bin/env node
// Starts facilitator (once), the x402 server, and the local web app. Usage: bash scripts/web.sh --stub | --real [--preflight-only]
// Process handling is copied from demo/run.mjs (tiny helpers; see AGENTS/DECISIONS.md D-017): stop by PID/process group, never pkill by pattern,
// never restart the facilitator, refuse if a port is in use. This launcher reads the repo .env; the WEB APP child gets a filtered env
// (AGENT_* and SVM_RPC_URL only, plus public addresses): no SVM_PRIVATE_KEY, SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY or LOG_SIGNING_KEY.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { base58 } = createRequire(path.join(ROOT, "server", "package.json"))("@scure/base");
const SERVER_PORT = 4021, FAC_PORT = 4022, WEB_PORT = Number(process.env.WEB_PORT || 4030);
const argv = process.argv.slice(2);
const MODE = argv.includes("--real") ? "real" : argv.includes("--stub") ? "stub" : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Fail extends Error {}
const fail = m => { throw new Fail(m); };
const RUN = path.join(ROOT, "web", "run", MODE ?? "none");

const procs = []; let aborted = false;
const killGroup = (p, sig) => { try { process.kill(-p.pid, sig); } catch { /* gone */ } };
const alive = p => { try { process.kill(-p.pid, 0); return true; } catch { return false; } };
async function stopAll() {
  for (const p of [...procs].reverse()) killGroup(p, "SIGTERM");
  for (let i = 0; i < 40 && procs.some(alive); i++) await sleep(250);
  for (const p of procs) if (alive(p)) { killGroup(p, "SIGKILL"); console.error(`  (${p.name} pid ${p.pid} needed SIGKILL)`); }
}
process.on("exit", () => { for (const p of procs) if (alive(p)) killGroup(p, "SIGKILL"); });
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { if (aborted) return; aborted = true; console.error(`\n${s}: stopping web app, server and facilitator by PID`); await stopAll(); process.exit(0); });
function startProc(name, cmd, args, { cwd, env, logFile }) {
  const fd = openSync(logFile, "a");
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] }); closeSync(fd);
  const p = { name, pid: child.pid, exited: false, code: null };
  child.on("exit", c => { p.exited = true; p.code = c; }); child.on("error", e => { p.exited = true; p.code = "spawn error: " + e.code; });
  procs.push(p); writeFileSync(path.join(RUN, "pids.json"), JSON.stringify(Object.fromEntries(procs.map(x => [x.name, x.pid]))));
  return p;
}
const portFree = port => new Promise(res => { const s = createServer(); s.once("error", () => res(false)); s.listen(port, "127.0.0.1", () => s.close(() => res(true))); });
async function waitFor(name, p, test, secs) {
  for (let i = 0; i < secs * 2; i++) { if (p.exited) fail(`${name} exited early (code ${p.code}); see web/run/${MODE}/${name}.log`); try { if (await test()) return; } catch { /* not ready */ } await sleep(500); }
  fail(`${name} not ready after ${secs}s; see web/run/${MODE}/${name}.log`);
}
const pubOf = k => base58.encode(base58.decode(k.trim()).slice(32));
const pick = (names, prefixes = []) => Object.fromEntries(Object.entries(process.env).filter(([k]) => names.includes(k) || prefixes.some(p => k.startsWith(p))));
const BASE = ["PATH", "HOME", "TMPDIR", "LANG", "USER"];

function preflight() {
  console.log(`== Web preflight (mode: ${MODE}) ==`);
  try { process.loadEnvFile(path.join(ROOT, ".env")); } catch { fail("cannot read the repo .env"); }
  for (const k of ["SVM_RPC_URL", "SVM_ADDRESS", "SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY", "AGENT_SVM_PRIVATE_KEY", "SVM_PRIVATE_KEY", "LOG_SIGNING_KEY", "FACILITATOR_URL"]) {
    const v = process.env[k]?.trim(); if (!v) fail(`${k} is missing or empty in .env`);
    if (!/^[\x20-\x7e]+$/.test(v)) fail(`${k} contains non-ASCII characters`);
    console.log(`  ${k}: set (length ${v.length})`);
  }
  if (process.env.FACILITATOR_URL.trim() !== `http://localhost:${FAC_PORT}`) fail(`FACILITATOR_URL must be http://localhost:${FAC_PORT}`);
  const ce = spawnSync("node", [path.join(ROOT, "scripts", "check-env.mjs")], { env: process.env, encoding: "utf8" });
  if (ce.status !== 0) fail("scripts/check-env.mjs: " + ((ce.stderr || ce.stdout).trim() || "failed"));
  console.log("  " + ce.stdout.trim());
  const info = {};
  try { info.signerPub = pubOf(process.env.LOG_SIGNING_KEY); info.buyerAddr = pubOf(process.env.AGENT_SVM_PRIVATE_KEY); } catch { fail("a key in .env is not a base58 64-byte keypair"); }
  info.payTo = process.env.SVM_ADDRESS.trim();
  if (MODE === "real") {
    if (process.env.ALLOW_STUB_VERIFIER?.trim()) fail("ALLOW_STUB_VERIFIER is set; unset it for --real");
    if (process.env.VERIFIER_PATH?.trim()) fail("VERIFIER_PATH is set; unset it for --real");
    const di = spawnSync("docker", ["info", "--format", "{{.Architecture}}"], { encoding: "utf8" });
    if (di.status !== 0) fail("docker is not available (docker info failed)");
    if (!/^(x86_64|amd64)$/.test(di.stdout.trim())) fail(`docker architecture is "${di.stdout.trim()}"; --real needs an amd64 host`);
    const m = JSON.parse(readFileSync(path.join(ROOT, "demo", "manifest.json"), "utf8")); info.caseId = String(m.case);
    const c = JSON.parse(readFileSync(path.join(ROOT, "verifier", "cases.json"), "utf8")).cases[info.caseId]; if (!c) fail(`case ${info.caseId} not in verifier/cases.json`);
    for (const img of [c.vul.image, c.fix.image]) if (spawnSync("docker", ["image", "inspect", img], { encoding: "utf8" }).status !== 0) fail(`ARVO image missing locally: ${img}`);
    console.log(`  docker ${di.stdout.trim()}, images for case ${info.caseId} present`);
  } else console.log("  STUB mode: verifier/verify_stub.py, ALLOW_STUB_VERIFIER=1. Verdicts come from the filename and mean nothing about bugs.");
  return info;
}

async function main() {
  if (!MODE) fail("usage: scripts/web.sh --stub | --real [--preflight-only]");
  mkdirSync(RUN, { recursive: true });
  const info = preflight();
  if (argv.includes("--preflight-only")) { console.log("  (preflight only; the port check is skipped)"); return 0; }
  for (const [name, port] of [["web app", WEB_PORT], ["server", SERVER_PORT], ["facilitator", FAC_PORT]]) if (!(await portFree(port))) fail(`port ${port} (${name}) is already in use; stop whatever holds it (not killing by pattern)`);
  console.log(`  ports ${WEB_PORT}, ${SERVER_PORT}, ${FAC_PORT} are free\n`);

  const facEnv = { ...pick(BASE, ["EVM_", "RENT_", "MAX_CHANNEL"]), ...pick(["SVM_PRIVATE_KEY", "SVM_RPC_URL", "FACILITATOR_DIR"]), FACILITATOR_PORT: String(FAC_PORT) };
  const srvEnv = { ...process.env, SERVER_PORT: String(SERVER_PORT), LOG_PATH: path.join(RUN, "verdicts.jsonl") };
  delete srvEnv.PORT; delete srvEnv.SVM_PRIVATE_KEY; for (const k of Object.keys(srvEnv)) if (k.startsWith("AGENT_") || k.startsWith("WEB_")) delete srvEnv[k];
  if (MODE === "stub") { srvEnv.ALLOW_STUB_VERIFIER = "1"; srvEnv.VERIFIER_PATH = path.join(ROOT, "verifier", "verify_stub.py"); srvEnv.VERIFIER_CASE = ""; }
  else { delete srvEnv.ALLOW_STUB_VERIFIER; delete srvEnv.VERIFIER_PATH; srvEnv.VERIFIER_CASE = info.caseId; }
  const webEnv = { ...pick(BASE, ["AGENT_"]), ...pick(["SVM_RPC_URL", "MAX_INPUT_BYTES"]),
    WEB_MODE: MODE, WEB_PORT: String(WEB_PORT), WEB_SERVER_PORT: String(SERVER_PORT), WEB_RUN_DIR: RUN, WEB_SIGNER_PUB: info.signerPub, WEB_BUYER_ADDR: info.buyerAddr, WEB_PAY_TO: info.payTo, ...(info.caseId ? { WEB_CASE_ID: info.caseId } : {}) };

  console.log("== Starting services (facilitator once; never restarted) ==");
  const fac = startProc("facilitator", "sh", [path.join(ROOT, "server", "scripts", "start-facilitator.sh")], { cwd: ROOT, env: facEnv, logFile: path.join(RUN, "facilitator.log") });
  await waitFor("facilitator", fac, async () => (await fetch(`http://127.0.0.1:${FAC_PORT}/supported`, { signal: AbortSignal.timeout(3000) })).ok, 90);
  console.log(`  facilitator pid ${fac.pid} ready on ${FAC_PORT}`);
  const srv = startProc("server", "node", ["src/index.ts"], { cwd: path.join(ROOT, "server"), env: srvEnv, logFile: path.join(RUN, "server.log") });
  await waitFor("server", srv, async () => (await fetch(`http://127.0.0.1:${SERVER_PORT}/report`, { method: "POST", body: "", signal: AbortSignal.timeout(3000) })).status === 402, 60);
  console.log(`  server pid ${srv.pid} ready on ${SERVER_PORT} (unpaid probe got 402)`);
  const web = startProc("web", "node", [path.join(ROOT, "web", "server.mjs")], { cwd: ROOT, env: webEnv, logFile: path.join(RUN, "web.log") });
  await waitFor("web", web, async () => (await fetch(`http://127.0.0.1:${WEB_PORT}/api/config`, { signal: AbortSignal.timeout(3000) })).ok, 30);
  console.log(`  web pid ${web.pid} ready\n`);
  console.log(`BugBond web app (${MODE === "stub" ? "STUB verifier: verdicts are NOT real" : "REAL verifier"}):\n\n    http://127.0.0.1:${WEB_PORT}/\n\nLocal-only. The demo wallet pays on your behalf (devnet). Ctrl-C stops everything by PID.`);
  console.log(`Logs and the signed verdict log: web/run/${MODE}/`);
  // stay up until a child dies or we are signalled
  for (;;) { await sleep(2000); const dead = procs.find(p => p.exited); if (dead) fail(`${dead.name} exited (code ${dead.code}); stopping everything`); }
}
try { process.exitCode = await main(); }
catch (e) { await stopAll(); if (e instanceof Fail) { console.error(`\nWEB LAUNCH FAILED: ${e.message}`); process.exitCode = 2; } else { console.error(`\nWEB ERROR: ${e?.message ?? e}`); process.exitCode = 1; } }
