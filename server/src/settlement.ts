// settlement_pending recovery (money-path rule 3: "settlement_pending means check on-chain state, not failure").
//
// What the status looks like (READ in @x402/core 2.31.0 dist/esm/chunk-PVRH2E6N.mjs and @x402/svm facilitator,
// not guessed): when the facilitator broadcast the settle tx but could not confirm it in time it answers
// {success:false, errorReason:"settlement_pending", transaction:<broadcast signature>}. x402ResourceServer.settlePayment
// retries the settle exactly ONCE (settleWithPendingRetry); if that is still pending, the failure goes to the
// onSettleFailure hooks, and a hook may return {recovered:true, result} to turn it into a success.
// Without a hook the express middleware answers 402 "settlement failed" even though the settle may have landed.
//
// This module is that hook: poll the dedicated RPC (getSignatureStatuses) for the pending signature, bounded.
// confirmed/finalized with err null -> recovered success; err non-null or timeout -> NOT recovered (reported as failure).
import type { SettleResponse } from "@x402/core/types";

export type SigState = "confirmed" | "failed" | "unknown";

export interface PollOptions {
  timeoutMs: number;
  intervalMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** One getSignatureStatuses call. Never throws: RPC errors (e.g. 429) count as "unknown" so the caller keeps polling. */
export async function sigStatusOnce(rpcUrl: string, signature: string, fetchImpl: typeof fetch = fetch): Promise<SigState> {
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getSignatureStatuses",
        params: [[signature], { searchTransactionHistory: true }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "unknown";
    const json = (await res.json()) as { result?: { value?: Array<null | { err: unknown; confirmationStatus?: string }> } };
    const st = json.result?.value?.[0];
    if (!st) return "unknown";
    if (st.err !== null && st.err !== undefined) return "failed";
    return st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" ? "confirmed" : "unknown";
  } catch {
    return "unknown";
  }
}

/** Polls until confirmed/failed or the bounded timeout. Returns "unknown" on timeout. Always terminates. */
export async function pollSignature(rpcUrl: string, signature: string, opt: PollOptions): Promise<SigState> {
  const now = opt.now ?? Date.now;
  const sleep = opt.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const deadline = now() + opt.timeoutMs;
  for (;;) {
    const s = await sigStatusOnce(rpcUrl, signature, opt.fetchImpl);
    if (s !== "unknown") return s;
    if (now() + opt.intervalMs >= deadline) return "unknown";
    await sleep(opt.intervalMs);
  }
}

type ErrLike = { errorReason?: string; transaction?: string; payer?: string; network?: string };

export function isPendingError(e: unknown): e is ErrLike & { transaction: string } {
  const x = e as ErrLike | null;
  return !!x && x.errorReason === "settlement_pending" && typeof x.transaction === "string" && x.transaction !== "";
}

export interface RecoveryConfig extends Omit<PollOptions, "now" | "sleep"> {
  rpcUrl: string;
  log?: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Builds the onSettleFailure hook. Non-pending failures are ignored (not recovered). */
export function makeSettlementRecovery(cfg: RecoveryConfig) {
  const log = cfg.log ?? ((l: string) => console.log(l));
  return async (ctx: { error: Error; requirements?: { network?: string } }): Promise<void | { recovered: true; result: SettleResponse }> => {
    const err = ctx.error;
    if (!isPendingError(err)) return;
    const sig = err.transaction;
    log(`[settle] settlement_pending tx=${sig}; polling RPC up to ${Math.round(cfg.timeoutMs / 1000)}s`);
    const state = await pollSignature(cfg.rpcUrl, sig, cfg);
    log(`[settle] pending tx=${sig} -> ${state}`);
    if (state !== "confirmed") return; // failed or still unknown after the bound: report failure, do not claim success
    return {
      recovered: true,
      result: {
        success: true,
        transaction: sig,
        network: (err.network ?? ctx.requirements?.network) as SettleResponse["network"],
        payer: err.payer,
        extra: { recoveredFromPending: true },
      },
    };
  };
}
