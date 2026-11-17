// Pure safety policy for the submitter agent. No I/O, so every rule is unit-testable.
// All money is integer atomic USDC (6 decimals). Never floats.

export const USDC_DECIMALS = 6;

/** "0.25" / "2" / "2.00" -> atomic bigint. Throws on anything else (fail closed). */
export function usdToAtomic(s: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) throw new Error(`bad USD amount: ${JSON.stringify(s)}`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(USDC_DECIMALS, "0"));
}
export function atomicToUsd(a: bigint): string {
  const w = a / 1_000_000n, f = (a % 1_000_000n).toString().padStart(6, "0");
  return `${w}.${f}`;
}

export interface PolicyConfig {
  perReportCap: bigint;       // AGENT_PER_REPORT_CAP_USD
  sessionBudget: bigint;      // AGENT_SESSION_BUDGET_USD
  approvalThreshold: bigint;  // AGENT_APPROVAL_THRESHOLD_USD: amounts ABOVE this need a human
  autoApprove: bigint;        // AGENT_AUTO_APPROVE_USD: non-interactive approval up to this (0 = never)
  allowedUrl: string;         // AGENT_ALLOWED_URL, exact origin + path
  maxRetriesPerReport: number; // fixed 1 (spec)
  sessionRetryBudget: number;  // AGENT_RETRY_BUDGET: total retries per session
  maxWaitMs: number;          // longest we will sleep before a retry
}

export function loadConfig(env: Record<string, string | undefined>): PolicyConfig {
  const get = (k: string, d?: string) => { const v = env[k]?.trim(); return v ? v : d; };
  const allowedUrl = get("AGENT_ALLOWED_URL");
  if (!allowedUrl) throw new Error("AGENT_ALLOWED_URL is required (the one endpoint this agent may pay)");
  const cfg: PolicyConfig = {
    perReportCap: usdToAtomic(get("AGENT_PER_REPORT_CAP_USD", "0.25")!),
    sessionBudget: usdToAtomic(get("AGENT_SESSION_BUDGET_USD", "2.00")!),
    approvalThreshold: usdToAtomic(get("AGENT_APPROVAL_THRESHOLD_USD", "0.10")!),
    autoApprove: usdToAtomic(get("AGENT_AUTO_APPROVE_USD", "0")!),
    allowedUrl: normalizeUrl(allowedUrl),
    maxRetriesPerReport: 1,
    sessionRetryBudget: Number(get("AGENT_RETRY_BUDGET", "3")),
    maxWaitMs: 30_000,
  };
  // Auto-approve may never exceed the per-report cap (spec: never auto-approve above the cap).
  if (cfg.autoApprove > cfg.perReportCap) cfg.autoApprove = cfg.perReportCap;
  return cfg;
}

export function normalizeUrl(u: string): string {
  const x = new URL(u);
  return `${x.origin}${x.pathname}`;
}

/** Exact origin+path match against the allowlist. Query/fragment/userinfo are not allowed. */
export function checkAllowed(url: string, cfg: Pick<PolicyConfig, "allowedUrl">): { ok: true } | { ok: false; reason: string } {
  let x: URL;
  try { x = new URL(url); } catch { return { ok: false, reason: "unparseable URL" }; }
  if (x.username || x.password) return { ok: false, reason: "userinfo in URL" };
  if (x.search || x.hash) return { ok: false, reason: "query or fragment in URL" };
  if (`${x.origin}${x.pathname}` !== cfg.allowedUrl) return { ok: false, reason: `not the allowlisted endpoint (${cfg.allowedUrl})` };
  return { ok: true };
}

export function checkCap(askAtomic: bigint, cfg: Pick<PolicyConfig, "perReportCap">): { ok: true } | { ok: false; reason: string } {
  if (askAtomic <= 0n) return { ok: false, reason: "non-positive amount in 402" };
  if (askAtomic > cfg.perReportCap) return { ok: false, reason: `402 asks ${atomicToUsd(askAtomic)} USDC, above per-report cap ${atomicToUsd(cfg.perReportCap)}` };
  return { ok: true };
}

/**
 * Session budget. DECISION: the budget counts the WORST CASE (the cap asked for in the 402) per report. It is
 * reserved before signing and released down to the actual settled amount once the server reports it, so a
 * reproduced/inconclusive report ($0 settled) gives its reservation back. If the outcome is unknown
 * (network error, settle_failed, settlement_pending) the reservation is KEPT: the bond may still be escrowed.
 */
export class Budget {
  private reserved = 0n; // in flight or unknown
  private spent = 0n;    // confirmed settled
  readonly total: bigint;
  constructor(total: bigint) { this.total = total; }
  get committed(): bigint { return this.reserved + this.spent; }
  get remaining(): bigint { return this.total - this.committed; }
  /** Returns false (and reserves nothing) if the worst case does not fit. */
  tryReserve(worst: bigint): boolean {
    if (worst <= 0n || this.committed + worst > this.total) return false;
    this.reserved += worst;
    return true;
  }
  /** Outcome known: server settled `actual` of the `worst` reserved. actual is clamped to worst. */
  settle(worst: bigint, actual: bigint): void {
    const a = actual < 0n ? 0n : actual > worst ? worst : actual;
    this.reserved -= worst;
    this.spent += a;
  }
  /** Nothing was charged (e.g. 429 before any escrow): release the whole reservation. */
  release(worst: bigint): void { this.settle(worst, 0n); }
}

export type ApprovalDecision =
  | { kind: "below_threshold" }
  | { kind: "auto_approved" }
  | { kind: "needs_prompt" };

/** Amounts <= threshold pass; above it, auto-approve only if <= autoApprove (itself <= cap); else ask a human. */
export function approvalRoute(ask: bigint, cfg: Pick<PolicyConfig, "approvalThreshold" | "autoApprove" | "perReportCap">): ApprovalDecision {
  if (ask <= cfg.approvalThreshold) return { kind: "below_threshold" };
  if (cfg.autoApprove > 0n && ask <= cfg.autoApprove && ask <= cfg.perReportCap) return { kind: "auto_approved" };
  return { kind: "needs_prompt" };
}

/** Only a clear "y"/"yes" approves. Anything else, including empty, EOF, or no TTY, is a rejection. */
export function parseYesNo(answer: string | null | undefined): boolean {
  return /^\s*(y|yes)\s*$/i.test(answer ?? "");
}

/** Retry budget: one retry per report, and a session-wide cap so rejections cannot loop. */
export class RetryBudget {
  private used = 0;
  private readonly perReport: number;
  private readonly session: number;
  constructor(perReport: number, session: number) { this.perReport = perReport; this.session = session; }
  tryRetry(retriesThisReport: number): boolean {
    if (retriesThisReport >= this.perReport || this.used >= this.session) return false;
    this.used++;
    return true;
  }
  get usedTotal(): number { return this.used; }
}

/** Seconds from Retry-After (integer form only), clamped to [1, maxWait]; fallback 11 s (server window is 10 s). */
export function retryDelayMs(retryAfter: string | null | undefined, cfg: Pick<PolicyConfig, "maxWaitMs">): number {
  const n = retryAfter && /^\d{1,5}$/.test(retryAfter.trim()) ? Number(retryAfter) : 11;
  return Math.min(Math.max(n, 1) * 1000 + 500, cfg.maxWaitMs);
}
