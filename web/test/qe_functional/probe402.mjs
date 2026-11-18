// Unpaid probe of the x402 server: decode the PAYMENT-REQUIRED header (what the 402 actually asks). Key-free, no payment.
import { writeFileSync } from "node:fs"; import path from "node:path"; import { SCRATCH, balances } from "./lib.mjs";
const r = await fetch("http://127.0.0.1:4021/report", { method: "POST", body: "x" });
const h = r.headers.get("payment-required"); const body = await r.text();
let dec = null; try { dec = JSON.parse(Buffer.from(h, "base64").toString()); } catch (e) { dec = { parseError: String(e), body: body.slice(0, 500) }; }
console.log(r.status, JSON.stringify(dec, null, 1));
writeFileSync(path.join(SCRATCH, "402.json"), JSON.stringify(dec, null, 2));
console.log("balances", JSON.stringify(await balances()));
