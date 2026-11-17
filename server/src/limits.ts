// Abuse limits for POST /report (money-path rule 9): concurrency gate + per-wallet rate limiter.
// Pure and clock-injectable so they are unit-testable. Rejections are decided by the caller, who MUST still settle $0.

/** At most `max` holders at once. tryAcquire never blocks (reject-with-$0, no queue; see AGENTS/DECISIONS.md D-009). */
export class ConcurrencyGate {
  private active = 0;
  readonly max: number;
  constructor(max: number) { this.max = max; }
  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active++;
    return true;
  }
  release(): void { if (this.active > 0) this.active--; }
  get inFlight(): number { return this.active; }
}

/** The configured cap: default 2, never above 2 (CLAUDE.md rule 9), never below 1. */
export function parseMaxConcurrent(v: string | undefined): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(n, 2);
}

/** One request per `windowMs` per key. check() is read-only; record() starts the window. */
export class RateLimiter {
  private last = new Map<string, number>();
  readonly windowMs: number;
  private now: () => number;
  private maxKeys: number;
  constructor(windowMs: number, now: () => number = Date.now, maxKeys = 10_000) { this.windowMs = windowMs; this.now = now; this.maxKeys = maxKeys; }
  /** ok=false => retryAfterMs is how long until this key may submit again. */
  check(key: string): { ok: boolean; retryAfterMs: number } {
    const t = this.last.get(key);
    if (t === undefined) return { ok: true, retryAfterMs: 0 };
    const wait = t + this.windowMs - this.now();
    return wait > 0 ? { ok: false, retryAfterMs: wait } : { ok: true, retryAfterMs: 0 };
  }
  /** Atomic check-and-record (JS is single-threaded, so concurrent handlers cannot both pass). */
  hit(key: string): { ok: boolean; retryAfterMs: number } {
    const r = this.check(key);
    if (r.ok) { this.prune(); this.last.set(key, this.now()); }
    return r;
  }
  private prune(): void {
    if (this.last.size < this.maxKeys) return;
    const cutoff = this.now() - this.windowMs;
    for (const [k, t] of this.last) if (t <= cutoff) this.last.delete(k);
    if (this.last.size >= this.maxKeys) this.last.clear(); // bounded memory beats a perfect limiter
  }
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Payer wallet from the x402 `payment-signature` header (upto/svm: payload.payload.from). Null if absent or malformed.
 *  UNVERIFIED before the payment middleware has run: use only for a best-effort pre-check, never to record. */
export function payerFromHeader(h: string | undefined): string | null {
  if (!h) return null;
  try {
    const from = JSON.parse(Buffer.from(h, "base64").toString("utf8"))?.payload?.from;
    return typeof from === "string" && B58.test(from) ? from : null;
  } catch { return null; }
}
