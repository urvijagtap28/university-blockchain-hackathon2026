// usage: node --env-file=../.env src/cli.ts <proof-file> [<proof-file> ...]
// Env: AGENT_SVM_PRIVATE_KEY, AGENT_ALLOWED_URL (the one endpoint; also the allowlist), AGENT_PER_REPORT_CAP_USD,
// AGENT_SESSION_BUDGET_USD, AGENT_APPROVAL_THRESHOLD_USD, AGENT_AUTO_APPROVE_USD, AGENT_RETRY_BUDGET, AGENT_LOG_PATH,
// AGENT_TARGET_URL (optional, defaults to AGENT_ALLOWED_URL; only used to demonstrate refusal of other URLs),
// AGENT_TEST_FILENAME (TEST ONLY: sends x-test-filename so the stub verifier routes; server ignores it without ALLOW_STUB_VERIFIER=1),
// AGENT_PROMPT_FROM_STDIN=1 (allow scripted y/N on a non-TTY stdin; default: no TTY = no answer = no payment).
import { readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { UptoSvmScheme } from "@x402/svm/upto/client";
import { Budget, RetryBudget, atomicToUsd, loadConfig } from "./policy.ts";
import { makeLogger } from "./log.ts";
import { submitReport } from "./agent.ts";

const files = process.argv.slice(2);
const key = process.env.AGENT_SVM_PRIVATE_KEY?.trim();
if (!files.length || !key) { console.error("usage: cli.ts <proof-file>...; needs AGENT_SVM_PRIVATE_KEY and AGENT_ALLOWED_URL"); process.exit(1); }
const cfg = loadConfig(process.env);
const MAX_BYTES = Number(process.env.MAX_INPUT_BYTES) || 65536;
const log = makeLogger(process.env.AGENT_LOG_PATH?.trim() || new URL("../decisions.log", import.meta.url).pathname);

const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: `$${atomicToUsd(cfg.perReportCap)}` }); // second line of defence
client.register("solana:*", new UptoSvmScheme(await createKeyPairSignerFromBytes(base58.decode(key))));
const http = new x402HTTPClient(client);

function ask(q: string): Promise<string | null> {
  if (!process.stdin.isTTY && process.env.AGENT_PROMPT_FROM_STDIN !== "1") return Promise.resolve(null);
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    let done = false;
    rl.question(q, a => { done = true; rl.close(); res(a); });
    rl.on("close", () => { if (!done) res(null); });
  });
}

const budget = new Budget(cfg.sessionBudget);
const retries = new RetryBudget(cfg.maxRetriesPerReport, cfg.sessionRetryBudget);
const url = process.env.AGENT_TARGET_URL?.trim() || cfg.allowedUrl;
log("session_start", { allowedUrl: cfg.allowedUrl, perReportCapAtomic: cfg.perReportCap, sessionBudgetAtomic: cfg.sessionBudget, thresholdAtomic: cfg.approvalThreshold, autoApproveAtomic: cfg.autoApprove, retryBudget: cfg.sessionRetryBudget });

for (const f of files) {
  if (statSync(f).size > MAX_BYTES) { log("refuse_input", { file: f, reason: "over MAX_INPUT_BYTES" }); console.log(JSON.stringify({ file: f, status: "refused", reason: "input over size cap" })); continue; }
  const body = readFileSync(f);
  const out = await submitReport({ cfg, budget, retries, log, fetchFn: fetch, x402: http as any, prompt: ask, sleep: ms => new Promise(r => setTimeout(r, ms)), extraHeaders: process.env.AGENT_TEST_FILENAME ? { "x-test-filename": process.env.AGENT_TEST_FILENAME } : undefined }, body, url);
  console.log(JSON.stringify({ file: f, ...out }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
log("session_end", { budgetRemainingAtomic: budget.remaining });
console.error(`budget remaining ${atomicToUsd(budget.remaining)} USDC`);
