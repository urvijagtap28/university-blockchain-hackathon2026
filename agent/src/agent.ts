// Submitter agent core. Flow: allowlist -> unpaid POST -> 402 -> cap check -> budget reserve -> approval ->
// sign upto -> paid POST -> settle result -> release/settle reservation. Every decision goes to the log.
// Dependencies are injected so the safety rules are unit-testable with mocks (see test/unit.ts).
import { createHash } from "node:crypto";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { Budget, RetryBudget, approvalRoute, atomicToUsd, checkAllowed, checkCap, parseYesNo, retryDelayMs, type PolicyConfig } from "./policy.ts";
import type { LogFn } from "./log.ts";

export interface X402Like {
  getPaymentRequiredResponse(getHeader: (n: string) => string | null | undefined, body?: unknown): any;
  createPaymentPayload(pr: any): Promise<any>;
  encodePaymentSignatureHeader(payload: any): Record<string, string>;
}

export interface Deps {
  cfg: PolicyConfig;
  budget: Budget;
  retries: RetryBudget;
  log: LogFn;
  fetchFn: typeof fetch;
  x402: X402Like;
  prompt: (question: string) => Promise<string | null>; // null = no answer / no TTY
  sleep: (ms: number) => Promise<void>;
  extraHeaders?: Record<string, string>; // TEST ONLY (x-test-filename; the server honors it only with ALLOW_STUB_VERIFIER=1)
}

export type Outcome =
  | { status: "done"; verdict: string; detail: string; settledAtomic: bigint; tx?: string }
  | { status: "refused"; reason: string }        // refused by policy before signing; no payment authorized
  | { status: "rejected"; reason: string }       // human said no / no answer; no payment authorized
  | { status: "unpaid_limited"; reason: string } // server 429 before escrow; nothing charged
  | { status: "unknown"; reason: string; tx?: string }; // payment may be in flight; reservation KEPT

type Attempt = { out: Outcome; retry?: { delayMs: number; why: string } };

export async function submitReport(d: Deps, body: Uint8Array, url: string): Promise<Outcome> {
  const reportHash = createHash("sha256").update(body).digest("hex").slice(0, 16);
  let retriesUsed = 0;
  for (;;) {
    const a = await attempt(d, body, url, reportHash);
    if (!a.retry) return a.out;
    if (!d.retries.tryRetry(retriesUsed)) {
      d.log("retry_denied", { reportHash, why: a.retry.why, retriesThisReport: retriesUsed, sessionRetriesUsed: d.retries.usedTotal });
      return a.out;
    }
    retriesUsed++;
    d.log("retry", { reportHash, why: a.retry.why, waitMs: a.retry.delayMs, retriesThisReport: retriesUsed });
    await d.sleep(a.retry.delayMs);
  }
}

async function attempt(d: Deps, body: Uint8Array, url: string, reportHash: string): Promise<Attempt> {
  const { cfg, budget, log } = d;
  const refuse = (event: string, reason: string, extra: Record<string, unknown> = {}): Attempt => {
    log(event, { reportHash, reason, ...extra });
    return { out: { status: "refused", reason } };
  };

  // 1. allowlist (before any network I/O)
  const allowed = checkAllowed(url, cfg);
  if (!allowed.ok) return refuse("refuse_url", allowed.reason, { url: safeUrl(url) });
  log("allow_url", { reportHash, url });

  const post = (headers: Record<string, string>) =>
    d.fetchFn(url, { method: "POST", redirect: "manual", headers: { "content-type": "application/octet-stream", ...(d.extraHeaders ?? {}), ...headers }, body });

  // 2. unpaid request -> expect 402
  const r1 = await post({});
  if (r1.status >= 300 && r1.status < 400) {
    await r1.arrayBuffer().catch(() => {});
    return refuse("refuse_redirect", "server redirected; redirects are never followed", { status: r1.status, location: safeUrl(r1.headers.get("location") ?? "") });
  }
  if (r1.status === 429) {
    await r1.arrayBuffer().catch(() => {});
    const delayMs = retryDelayMs(r1.headers.get("retry-after"), cfg);
    log("server_429", { reportHash, stage: "unpaid", delayMs });
    return { out: { status: "unpaid_limited", reason: "429 before 402" }, retry: { delayMs, why: "429" } };
  }
  if (r1.status !== 402) {
    const t = await r1.text().catch(() => "");
    return refuse("refuse_unexpected", `expected 402, got ${r1.status}`, { body: t.slice(0, 200) });
  }

  // 3. parse requirements
  let pr: any;
  try {
    let parsed: unknown;
    const txt = await r1.text();
    try { parsed = txt ? JSON.parse(txt) : undefined; } catch { /* x402 v2 carries it in the header */ }
    pr = d.x402.getPaymentRequiredResponse(n => r1.headers.get(n), parsed);
  } catch (e) { return refuse("refuse_402_unparseable", `cannot parse 402: ${msg(e)}`); }
  const accepts: any[] = Array.isArray(pr?.accepts) ? pr.accepts : [];
  const chosen = accepts.find(a => a?.scheme === "upto" && typeof a?.network === "string" && a.network.startsWith("solana:"));
  if (!chosen) return refuse("refuse_402_scheme", "no upto/solana option in 402");
  let ask: bigint;
  try { ask = BigInt(String(chosen.amount)); } catch { return refuse("refuse_402_amount", "unreadable amount in 402"); }

  // 4. per-report cap, BEFORE signing
  const cap = checkCap(ask, cfg);
  if (!cap.ok) return refuse("refuse_cap", cap.reason, { askAtomic: ask, capAtomic: cfg.perReportCap });

  // 5. session budget: reserve the worst case (= the cap asked for) BEFORE signing
  if (!budget.tryReserve(ask)) {
    return refuse("refuse_budget", `session budget exhausted: need ${atomicToUsd(ask)}, remaining ${atomicToUsd(budget.remaining)}`, { askAtomic: ask, remainingAtomic: budget.remaining });
  }
  // D-020: additive log fields only (402 terms from the parsed option and the cap already checked above); no logic depends on them.
  log("reserve", { reportHash, askAtomic: ask, remainingAtomic: budget.remaining, capAtomic: cfg.perReportCap, scheme: chosen.scheme, network: chosen.network, ...(Number.isSafeInteger(chosen.maxTimeoutSeconds) ? { maxTimeoutSeconds: chosen.maxTimeoutSeconds } : {}) });

  // 6. human approval above threshold
  const route = approvalRoute(ask, cfg);
  if (route.kind === "needs_prompt") {
    const ans = await d.prompt(`Pay up to ${atomicToUsd(ask)} USDC (bond; refunded unless the bug does not reproduce) to ${cfg.allowedUrl} for report ${reportHash}? [y/N] `);
    if (!parseYesNo(ans)) {
      budget.release(ask);
      log("approval_rejected", { reportHash, askAtomic: ask, answered: ans === null ? "no answer" : "no" });
      return { out: { status: "rejected", reason: ans === null ? "no answer (no TTY): nothing paid" : "human declined: nothing paid" } };
    }
    log("approval_granted", { reportHash, askAtomic: ask, by: "human" });
  } else {
    log(route.kind === "auto_approved" ? "approval_auto" : "approval_not_needed", { reportHash, askAtomic: ask, thresholdAtomic: cfg.approvalThreshold, autoApproveAtomic: cfg.autoApprove });
  }

  // 7. sign (only the chosen option is offered to the signer) and pay
  let headers: Record<string, string>;
  try {
    const payload = await d.x402.createPaymentPayload({ ...pr, accepts: [chosen] });
    headers = d.x402.encodePaymentSignatureHeader(payload);
  } catch (e) {
    budget.release(ask); // nothing left the machine
    return refuse("refuse_sign", `signing failed: ${msg(e)}`);
  }
  log("payment_signed", { reportHash, askAtomic: ask, payTo: chosen.payTo, network: chosen.network });
  let r2: Response;
  try { r2 = await post({ ...headers, "Access-Control-Expose-Headers": "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE" }); }
  catch (e) {
    log("payment_unknown", { reportHash, reason: `network error after signing: ${msg(e)}`, reservedAtomic: ask });
    return { out: { status: "unknown", reason: `network error after signing (reservation kept): ${msg(e)}` } };
  }

  // 8. result
  if (r2.status >= 300 && r2.status < 400) {
    await r2.arrayBuffer().catch(() => {});
    log("payment_unknown", { reportHash, reason: "redirect after payment, not followed", status: r2.status, reservedAtomic: ask });
    return { out: { status: "unknown", reason: "redirect after payment, not followed (reservation kept)" } };
  }
  if (r2.status === 429) {
    await r2.arrayBuffer().catch(() => {});
    budget.release(ask); // server's pre-payment check: nothing escrowed
    const delayMs = retryDelayMs(r2.headers.get("retry-after"), cfg);
    log("server_429", { reportHash, stage: "paid", delayMs, releasedAtomic: ask });
    return { out: { status: "unpaid_limited", reason: "429: server took no payment" }, retry: { delayMs, why: "429" } };
  }
  const tx = txFrom(r2);
  if (r2.status !== 200) {
    const t = await r2.text().catch(() => "");
    log("payment_unknown", { reportHash, status: r2.status, tx, body: t.slice(0, 200), reservedAtomic: ask });
    return { out: { status: "unknown", reason: `HTTP ${r2.status} after payment (settlement may be pending; reservation kept)`, tx } };
  }
  let j: any;
  try { j = await r2.json(); } catch {
    log("payment_unknown", { reportHash, reason: "unreadable 200 body", tx, reservedAtomic: ask });
    return { out: { status: "unknown", reason: "unreadable response body (reservation kept)", tx } };
  }
  let settled: bigint;
  try { settled = BigInt(String(j.settledAtomic)); } catch {
    log("payment_unknown", { reportHash, reason: "no settledAtomic", tx, reservedAtomic: ask });
    return { out: { status: "unknown", reason: "no settledAtomic in response (reservation kept)", tx } };
  }
  budget.settle(ask, settled);
  log("settle_result", { reportHash, verdict: j.verdict, settledAtomic: settled, reservedAtomic: ask, tx, budgetRemainingAtomic: budget.remaining });
  const out: Outcome = { status: "done", verdict: String(j.verdict), detail: String(j.detail ?? ""), settledAtomic: settled, tx };
  if (j.verdict === "busy" || j.verdict === "rate_limited") return { out, retry: { delayMs: retryDelayMs(null, cfg), why: String(j.verdict) } };
  return { out };
}

function txFrom(r: Response): string | undefined {
  const h = r.headers.get("payment-response") ?? r.headers.get("x-payment-response");
  if (!h) return undefined;
  try { const s: any = decodePaymentResponseHeader(h); return typeof s?.transaction === "string" && s.transaction ? s.transaction : undefined; } catch { return undefined; }
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
const safeUrl = (u: string) => { try { const x = new URL(u); return `${x.origin}${x.pathname}`; } catch { return "(unparseable)"; } };
