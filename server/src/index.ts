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
import { CAP_ATOMIC, clamp, runVerifier, type Decision } from "./verifier.ts";

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

const receiverAuthorizerSigner = await createKeyPairSignerFromBytes(base58.decode(authorizerKey));
const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(
  SOLANA_DEVNET,
  new UptoSvmScheme({ receiverAuthorizerSigner, rpcUrl }),
);
try { await resourceServer.initialize(); } catch (e) {
  console.error(e instanceof Error ? e.message : "Failed to initialize x402 resource server");
  process.exit(1);
}

const app = express();

// Body parser BEFORE payment so oversize input is rejected with 413 before any deposit is escrowed.
app.use("/report", express.raw({ type: () => true, limit: MAX_INPUT_BYTES }));

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

app.post("/report", async (req, res) => {
  let decision: Decision = { verdict: "error", detail: "internal error", settleAtomic: 0n };
  let dir: string | undefined;
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      decision = { verdict: "error", detail: "empty or missing body", settleAtomic: 0n };
    } else {
      dir = await mkdtemp(path.join(tmpdir(), "proveit-"));
      // TEST ONLY: the stub routes on filename, so a test may choose it via header when the stub is allowed.
      const name = ALLOW_STUB ? path.basename(String(req.header("x-test-filename") ?? "input.bin")) : "input.bin";
      const file = path.join(dir, name);
      await writeFile(file, body);
      decision = await runVerifier(file, ALLOW_STUB);
    }
  } catch (e) {
    decision = { verdict: "error", detail: `exception: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`, settleAtomic: 0n };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  const settle = clamp(decision.verdict === "error" ? 0n : decision.settleAtomic); // clamp before settling
  try {
    setSettlementOverrides(res, { amount: settle.toString() });
    // Always 200: >=400 would skip settlement and strand the bond. Errors are reported in the body.
    res.status(200).json({ verdict: decision.verdict, detail: decision.detail, settledAtomic: settle.toString(), capAtomic: CAP_ATOMIC.toString() });
  } catch {
    setSettlementOverrides(res, { amount: "0" });
    res.status(200).json({ verdict: "error", detail: "response failure", settledAtomic: "0" });
  }
});

// Final error handler (oversize body etc.). Pre-payment errors only; runs before any escrow.
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.status === 413 ? "input too large" : "server error" });
});

app.listen(PORT, () => {
  console.log(`Prove-It Bond server on http://localhost:${PORT}  POST /report  (stub allowed: ${ALLOW_STUB})`);
  console.log(`  facilitator ${facilitatorUrl}; authorizer ${receiverAuthorizerSigner.address}`);
});
