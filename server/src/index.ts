// POST /report skeleton. Money path: 402 -> upto deposit ($0.25 cap) -> verifier -> settle in the same request.
// Based on the x402 upto server example (x402-foundation/x402 examples/typescript/servers/upto) and the
// local spike server (~/upto-spike/.../spike-server.ts), both Apache-2.0/upstream code; adapted here.
//
// KEY FACT (read in @x402/express index.ts): if the handler responds with status >= 400 the middleware does
// NOT settle. So every outcome, including errors, responds 200 with a settlement override and an
// {error} body. Only pre-payment rejections (oversize body) return 4xx, before any deposit exists.
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import express from "express";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { paymentMiddleware, setSettlementOverrides, x402ResourceServer } from "@x402/express";
import { UptoSvmScheme } from "@x402/svm/upto/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { CAP_ATOMIC, finalSettle, runVerifier, type Decision } from "./verifier.ts";
import { makeSettlementRecovery } from "./settlement.ts";
import { ConcurrencyGate, RateLimiter, parseMaxConcurrent, payerFromHeader } from "./limits.ts";

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as Network;
const need = (k: string): string => {
  const v = process.env[k]?.trim();
  if (!v) { console.error(`Missing required env var ${k}`); process.exit(1); }
  return v;
};
const svmAddress = need("SVM_ADDRESS");
const facilitatorUrl = need("FACILITATOR_URL");
const rpcUrl = need("SVM_RPC_URL");
if (/api\.devnet\.solana\.com/.test(rpcUrl)) { console.error("Refusing the public devnet RPC (money-path rule 4)"); process.exit(1); }
const authorizerKey = need("SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY");
const PORT = Number(process.env.SERVER_PORT || 4021); // NOT PORT (DECISIONS D-004)
const MAX_INPUT_BYTES = Number(process.env.MAX_INPUT_BYTES) || 65536;
const ALLOW_STUB = process.env.ALLOW_STUB_VERIFIER === "1";
const gate = new ConcurrencyGate(parseMaxConcurrent(process.env.VERIFIER_MAX_CONCURRENT));
const RATE_SECS = Number(process.env.RATE_LIMIT_SECONDS) > 0 ? Number(process.env.RATE_LIMIT_SECONDS) : 10;
const limiter = new RateLimiter(RATE_SECS * 1000);

const receiverAuthorizerSigner = await createKeyPairSignerFromBytes(base58.decode(authorizerKey));
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(
  SOLANA_DEVNET,
  new UptoSvmScheme({ receiverAuthorizerSigner, rpcUrl }),
);
// settlement_pending => poll the dedicated RPC (bounded) before reporting failure (rule 3). See settlement.ts.
const POLL_SECS = Math.min(Number(process.env.SETTLEMENT_POLL_SECONDS) || 45, 120);
resourceServer.onSettleFailure(makeSettlementRecovery({ rpcUrl, timeoutMs: POLL_SECS * 1000, intervalMs: 1500 }));
try { await resourceServer.initialize(); } catch (e) {
  console.error(e instanceof Error ? e.message : "Failed to initialize x402 resource server");
  process.exit(1);
}

const app = express();

// Body parser BEFORE payment so oversize input is rejected with 413 before any deposit is escrowed.
app.use("/report", express.raw({ type: () => true, limit: MAX_INPUT_BYTES }));

// Best-effort PRE-payment rate check: if the (unverified) payer in the payment header already submitted within the
// window, answer 429 before the middleware escrows anything. Only the post-payment check below ever RECORDS, so a
// forged header can at worst get a 429 for requests that claim someone else's address.
app.use("/report", (req, res, next) => {
  const payer = payerFromHeader(req.header("payment-signature") ?? req.header("x-payment"));
  const r = payer ? limiter.check(payer) : { ok: true, retryAfterMs: 0 };
  if (r.ok) return next();
  res.set("Retry-After", String(Math.ceil(r.retryAfterMs / 1000)));
  res.status(429).json({ error: "rate limited", detail: `one report per ${RATE_SECS}s per wallet; no payment was taken` });
});

app.use(
  paymentMiddleware(
    {
      "POST /report": {
        accepts: [{ scheme: "upto", price: "$0.25", network: SOLANA_DEVNET, payTo: svmAddress, maxTimeoutSeconds: 300 }],
        description: "Prove-It Bond: submit a proof input file; bond returned unless the bug does not reproduce",
        mimeType: "application/json",
      },
    },
    resourceServer,
    undefined,
    undefined,
    false,
  ),
);

async function handle(req: express.Request, res: express.Response) {
  // TEST ONLY (needs ALLOW_STUB_VERIFIER=1): fault injection for the money-path tests.
  const fault = ALLOW_STUB ? String(req.header("x-test-fault") ?? "") : "";
  let decision: Decision = { verdict: "error", detail: "internal error", settleAtomic: 0n };
  let dir: string | undefined;
  let held = false;
  try {
    const body = req.body;
    // Payment is already escrowed here, so every rejection below must still answer 200 + settle $0 (errors -> 0).
    const payer = payerFromHeader(req.header("payment-signature") ?? req.header("x-payment"));
    const rl = payer ? limiter.hit(payer) : { ok: true, retryAfterMs: 0 };
    if (!rl.ok) {
      decision = { verdict: "rate_limited", detail: `one report per ${RATE_SECS}s per wallet; retry in ${Math.ceil(rl.retryAfterMs / 1000)}s; bond refunded`, settleAtomic: 0n };
    } else if (!(held = gate.tryAcquire())) {
      decision = { verdict: "busy", detail: `verifier at capacity (${gate.max} concurrent); retry shortly; bond refunded`, settleAtomic: 0n };
    } else if (!Buffer.isBuffer(body) || body.length === 0) {
      decision = { verdict: "error", detail: "empty or missing body", settleAtomic: 0n };
    } else {
      dir = await mkdtemp(path.join(tmpdir(), "proveit-"));
      // TEST ONLY: the stub routes on filename, so a test may choose it via header when the stub is allowed.
      const name = ALLOW_STUB ? path.basename(String(req.header("x-test-filename") ?? "input.bin")) : "input.bin";
      const file = path.join(dir, name);
      await writeFile(file, body);
      if (fault === "throw") throw new Error("TEST injected exception inside the handler after payment");
      decision = await runVerifier(file, ALLOW_STUB);
      if (fault === "overcap") decision = { ...decision, verdict: "not_reproduced", settleAtomic: 300_000n }; // attempt to exceed the cap
    }
  } catch (e) {
    decision = { verdict: "error", detail: `exception: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`, settleAtomic: 0n };
  } finally {
    if (held) gate.release();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (fault === "escape") throw new Error("TEST injected exception that escapes the handler's own try/catch");
  const settle = finalSettle(decision); // rate_limited/busy carry settleAtomic 0n; clamp still applies // errors -> 0, clamped to the cap before settling
  try {
    setSettlementOverrides(res, { amount: settle.toString() });
    // Always 200: >=400 would skip settlement and strand the bond. Errors are reported in the body.
    res.status(200).json({ verdict: decision.verdict, detail: decision.detail, settledAtomic: settle.toString(), capAtomic: CAP_ATOMIC.toString() });
  } catch {
    setSettlementOverrides(res, { amount: "0" });
    res.status(200).json({ verdict: "error", detail: "response failure", settledAtomic: "0" });
  }
}

// Express 4 does not catch async rejections: an escaped throw would hang the request (bond stranded) and can kill
// the process. Last-resort wrapper: ALWAYS answer 200 with a $0 settle override.
app.post("/report", (req, res) => {
  handle(req, res).catch(e => {
    console.error("[report] escaped exception, settling $0:", e instanceof Error ? e.message : e);
    try {
      if (!res.headersSent) {
        setSettlementOverrides(res, { amount: "0" });
        res.status(200).json({ verdict: "error", detail: "internal error", settledAtomic: "0", capAtomic: CAP_ATOMIC.toString() });
      }
    } catch (e2) { console.error("[report] could not even answer:", e2); }
  });
});
process.on("unhandledRejection", e => console.error("[unhandledRejection]", e));

// Final error handler (oversize body etc.). Pre-payment errors only; runs before any escrow.
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status === 413 ? "input too large" : "server error" });
});

app.listen(PORT, () => {
  console.log(`Prove-It Bond server on http://localhost:${PORT}  POST /report  (stub allowed: ${ALLOW_STUB})`);
  console.log(`  facilitator ${facilitatorUrl}; authorizer ${receiverAuthorizerSigner.address}`);
});
