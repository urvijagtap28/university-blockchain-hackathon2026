// One submission = one agent child process. Events come from (1) the agent's per-job decision log (policy steps only)
// and (2) the signed verdict-log record matched by proof hash (verdict, amount, tx). Never from agent console output.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { countLines, findRecord, B58_SIG } from "./records.mjs";

const BASE = ["PATH", "HOME", "TMPDIR", "LANG", "USER"];
export const SECRET_ENV_NAMES = ["SVM_PRIVATE_KEY", "SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY", "LOG_SIGNING_KEY"];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Child agent env: only AGENT_* and SVM_RPC_URL (plus a few harmless basics). Reuses the demo runner's convention. */
export function childEnv(src, { allowedUrl, logPath, testFilename }) {
  const env = {};
  for (const [k, v] of Object.entries(src)) if (BASE.includes(k) || k.startsWith("AGENT_") || k === "SVM_RPC_URL" || k === "MAX_INPUT_BYTES") env[k] = v;
  delete env.AGENT_TARGET_URL; delete env.AGENT_PROMPT_FROM_STDIN; delete env.AGENT_TEST_FILENAME;
  env.AGENT_ALLOWED_URL = allowedUrl;
  env.AGENT_AUTO_APPROVE_USD = "0.25"; // the user's confirmation happened in the UI; set for the child only
  env.AGENT_LOG_PATH = logPath;
  if (testFilename) env.AGENT_TEST_FILENAME = testFilename;
  return env;
}

const clip = s => String(s ?? "").slice(0, 300);

// D-019/D-020: optional `facts` on decision events. Built ONLY from fields the agent's decision log lines carry, per event, with strict
// types: atomic amounts as digit strings (<= 15 digits), enums, a bounded CAIP-2 network id, a base58 public address (32-50 chars, so a
// 64-byte secret key cannot match), a bounded integer. Anything else (unknown fields, wrong types, hostile strings) is dropped.
const ATOMIC = /^\d{1,15}$/;
export const KNOWN_NETWORKS = ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"]; // devnet, mainnet
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
/** QE-W2-005: a decision line's ts is forwarded only if it is a short ISO-8601 string; else the caller uses server time. */
export const validTs = v => typeof v === "string" && v.length <= 40 && ISO_TS.test(v);
const FACT_SPEC = {
  askAtomic: v => atomicOf(v), capAtomic: v => atomicOf(v), remainingAtomic: v => atomicOf(v), thresholdAtomic: v => atomicOf(v), autoApproveAtomic: v => atomicOf(v),
  scheme: v => (v === "upto" || v === "exact") ? v : null,
  // QE-W2-006: network must be a known CAIP-2 id (Solana devnet or mainnet); payTo must equal the demo's known payTo (ctx.payTo), else omitted.
  network: v => KNOWN_NETWORKS.includes(v) ? v : null,
  payTo: (v, ctx) => (typeof v === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(v) && typeof ctx?.payTo === "string" && v === ctx.payTo) ? v : null,
  maxTimeoutSeconds: v => (Number.isSafeInteger(v) && v >= 1 && v <= 86400) ? v : null,
};
function atomicOf(v) { const s = typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? String(v) : v; return typeof s === "string" && ATOMIC.test(s) ? s : null; }
// which agent log fields each event may contribute (anything else on the line is ignored)
const FACT_FIELDS = {
  reserve: ["askAtomic", "capAtomic", "remainingAtomic", "scheme", "network", "maxTimeoutSeconds"],
  approval_auto: ["askAtomic", "thresholdAtomic", "autoApproveAtomic"], approval_not_needed: ["askAtomic", "thresholdAtomic", "autoApproveAtomic"], approval_granted: ["askAtomic"],
  payment_signed: ["askAtomic", "network", "payTo"],
  refuse_cap: ["askAtomic", "capAtomic"], refuse_budget: ["askAtomic", "remainingAtomic"],
};
const ROUTE = { approval_auto: "auto", approval_not_needed: "below_threshold", approval_granted: "human" };
export function sanitizeFacts(event, o, ctx) {
  const f = {};
  for (const k of FACT_FIELDS[event] ?? []) { const v = FACT_SPEC[k](o?.[k], ctx); if (v !== null) f[k] = v; }
  if (ROUTE[event]) f.route = ROUTE[event];
  return Object.keys(f).length ? f : null;
}

export function mapDecision(o, ctx) {
  const e = String(o.event ?? "");
  const withFacts = m => { const f = sanitizeFacts(e, o, ctx); return f ? { ...m, facts: f } : m; };
  if (e === "allow_url") return { action: "allow", detail: `allowlist: ${clip(o.url)}` };
  if (e === "reserve") return withFacts({ action: "allow", detail: "budget reserved for the 402 ask" });
  if (e.startsWith("refuse_")) return withFacts({ action: "refuse", detail: clip(o.reason ?? e) });
  if (e === "approval_auto" || e === "approval_granted" || e === "approval_not_needed") return withFacts({ action: "approve", detail: e === "approval_granted" ? "approved" : "approved (confirmed in the web UI, up to the per-report cap)" });
  if (e === "approval_rejected") return { action: "reject", detail: "approval rejected: nothing paid" };
  if (e === "payment_signed") return withFacts({ action: "sign", detail: "x402 upto authorization signed (maximum is the per-report cap)" });
  if (e === "server_429" || e === "retry") return { action: "retry", detail: `retry: ${clip(o.why ?? "server rate limit")}` };
  if (e === "retry_denied") return { action: "refuse", detail: `retry denied: ${clip(o.why)}` };
  if (e === "payment_unknown") return { action: "settle", detail: "payment outcome not confirmed by the agent; checking the signed log" };
  if (e === "settle_result") return { action: "settle", detail: "settle response received; the amount shown comes from the signed log" };
  return null;
}

/** Map a verdict-log record to the SSE shape. Pure. */
export function outcomeOf(rec, cap) {
  const v = ["reproduced", "not_reproduced", "inconclusive"].includes(rec.verdict) ? rec.verdict : "error";
  const detail = v === "error" && rec.verdict !== "error" ? `(${rec.verdict}) ${rec.detail ?? ""}` : String(rec.detail ?? "");
  let amt = null; try { amt = BigInt(rec.settledAtomic); } catch { /* leave null */ }
  let bond = "unknown";
  if (rec.settlementStatus === "settled" && amt !== null) bond = amt === 0n ? "returned" : amt === BigInt(cap) ? "forfeited" : "unknown";
  const tx = typeof rec.txSignature === "string" && B58_SIG.test(rec.txSignature) ? rec.txSignature : null;
  const charge = rec.settlementStatus === "settled" && amt !== null && amt >= 0n && amt <= BigInt(cap) ? amt : BigInt(cap); // unsure => charge the cap
  return { verdict: v, detail, settledAtomic: String(rec.settledAtomic), txSignature: tx, bondOutcome: bond, charge };
}

export class Job {
  constructor(id, hash) { this.id = id; this.hash = hash; this.events = []; this.subs = new Set(); this.done = false; }
  emit(type, data) {
    const ev = { n: this.events.length, type, data }; this.events.push(ev);
    for (const s of this.subs) { try { s(ev); } catch { /* one bad subscriber must not break the job */ } }
  }
}

/** Runs the agent and emits events up to (not including) `done`; the caller settles the budget, then emits done. Returns {charge (BigInt), recordSeq|null}. Never throws. */
export async function runJob(job, o) {
  // o: {scratchFile, logFile, jobLogPath, env, agentCmd, agentCwd, cap, waitDoneMs, waitSignedMs, pollMs, agentTimeoutMs, baseline, onChild}
  const cap = BigInt(o.cap);
  let signed = false, charge = cap;
  let linesSeen = 0;
  let tailFailed = false; // QE-W2-001: any unexpected failure while reading the decision log means the outcome is unknown
  const tail = () => {
    try {
      let t = ""; try { t = existsSync(o.jobLogPath) ? readFileSync(o.jobLogPath, "utf8") : ""; } catch { return; }
      const lines = t.split("\n").filter(Boolean);
      for (; linesSeen < lines.length; linesSeen++) {
        let x; try { x = JSON.parse(lines[linesSeen]); } catch { continue; }
        if (x === null || typeof x !== "object" || Array.isArray(x)) continue; // null, numbers, strings, booleans, arrays: ignored
        if (x.event === "payment_signed") signed = true;
        const m = mapDecision(x, { payTo: o.knownPayTo });
        if (m) job.emit("decision", { ts: validTs(x.ts) ? x.ts : new Date().toISOString(), ...m });
      }
    } catch { tailFailed = true; } // never let an exception escape a timer callback
  };
  try {
    job.emit("started", { jobId: job.id, reportHash: job.hash });
    mkdirSync(path.dirname(o.jobLogPath), { recursive: true });
    let out = "", exit;
    const child = spawn(o.agentCmd[0], [...o.agentCmd.slice(1), o.scratchFile], { cwd: o.agentCwd, env: o.env, stdio: ["ignore", "pipe", "ignore"] }); // argument array, no shell
    o.onChild?.(child);
    child.stdout.on("data", d => { if (out.length < 65536) out += d; });
    const exited = new Promise(r => { child.on("exit", (code, sig) => r({ code, sig })); child.on("error", e => r({ code: null, sig: "spawn error" })); });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, o.agentTimeoutMs);
    const iv = setInterval(tail, 200);
    exit = await exited; clearTimeout(timer); clearInterval(iv); tail();
    if (tailFailed) signed = true; // unknown outcome: treat as possibly signed, so a missing record still charges the cap

    const line = out.split("\n").reverse().find(l => l.startsWith("{"));
    let res = null; try { res = JSON.parse(line); } catch { /* none */ }
    const status = res?.status ?? null;

    if (!tailFailed && (["refused", "rejected", "unpaid_limited"].includes(status) || (!status && !signed))) {
      const why = status ? `${status}: ${clip(res.reason)}` : `agent ended without a result (${exit.sig ?? "exit " + exit.code}) before any payment was signed`;
      charge = 0n; // no payment authorized; the agent says nothing was escrowed
      job.emit("error", { message: status === "refused" ? `Refused by agent policy: ${clip(res.reason)}` : `Not paid. ${why}`, settledAtomic: null });
      return { charge, recordSeq: null };
    }

    // A payment was (or may have been) signed. The signed log decides the money.
    let rec = findRecord(o.logFile, job.hash, o.baseline);
    if (!rec || status !== "done") job.emit("checking", { message: "checking the chain" });
    const deadline = Date.now() + (status === "done" ? o.waitDoneMs : o.waitSignedMs);
    while (!rec && Date.now() < deadline) { await sleep(o.pollMs); rec = findRecord(o.logFile, job.hash, o.baseline); }
    if (!rec) {
      charge = cap; // unknown: keep the reservation counted as spent
      job.emit("error", { message: `No signed verdict-log record appeared for this proof within ${Math.round((status === "done" ? o.waitDoneMs : o.waitSignedMs) / 1000)} s${status ? "" : " (agent process ended abnormally)"}. The outcome is unknown; the bond may still be in escrow. Nothing is reported as settled.`, settledAtomic: null });
      return { charge, recordSeq: null };
    }
    const oc = outcomeOf(rec, cap);
    charge = oc.charge;
    job.emit("verdict", { verdict: oc.verdict, detail: oc.detail });
    job.emit("settled", { settledAtomic: oc.settledAtomic, txSignature: oc.txSignature, bondOutcome: oc.bondOutcome });
    return { charge, recordSeq: rec.seq };
  } catch (e) {
    try { job.emit("error", { message: `internal error while running the job: ${clip(e?.message)}`, settledAtomic: null }); } catch { /* keep going: the charge below is what matters */ }
    return { charge: cap, recordSeq: null }; // unexpected failure: outcome unknown, charge the full reservation
  } finally {
    try { rmSync(o.scratchFile, { force: true }); } catch { /* ignore */ }
  }
}
