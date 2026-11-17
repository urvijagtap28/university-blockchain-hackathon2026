// Test client (NOT the agent): pays the 0.25 upto bond and POSTs a file.
// usage: node --env-file=../.env test/client.ts <file> [x-test-filename]   (buyer key = AGENT_SVM_PRIVATE_KEY)
import { readFileSync } from "node:fs";
import { base58 } from "@scure/base";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { UptoSvmScheme } from "@x402/svm/upto/client";

const file = process.argv[2];
const testName = process.argv[3];
const key = process.env.AGENT_SVM_PRIVATE_KEY?.trim();
if (!file || !key) { console.error("usage: client.ts <file> [x-test-filename]; needs AGENT_SVM_PRIVATE_KEY"); process.exit(1); }
const url = `http://localhost:${process.env.SERVER_PORT || 4021}/report`;
const client = new x402Client();
client.setSpendControls({ maxAmountPerPayment: "$0.25" });
client.register("solana:*", new UptoSvmScheme(await createKeyPairSignerFromBytes(base58.decode(key))));
const pay = wrapFetchWithPayment(fetch, client);
const t0 = performance.now();
const res = await pay(url, {
  method: "POST",
  headers: { "content-type": "application/octet-stream", ...(testName ? { "x-test-filename": testName } : {}), ...(process.env.TEST_FAULT ? { "x-test-fault": process.env.TEST_FAULT } : {}) },
  body: readFileSync(file),
});
const result = await new x402HTTPClient(client).processResponse(res);
console.dir(result, { depth: null });
console.log(`completed in ${((performance.now() - t0) / 1000).toFixed(3)}s`);
