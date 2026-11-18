// usage: node scripts/verify-log.ts <log.jsonl> [--pubkey <base58 signer public key>]
// Exit 0 = every signature, canonical line, seq and prev-hash link checks out. Exit 1 = tampering or inconsistency. Exit 2 = usage.
import { readFileSync } from "node:fs";
import { verifyLogText } from "../src/verdictlog.ts";
const args = process.argv.slice(2);
const pi = args.indexOf("--pubkey");
const pub = pi >= 0 ? args[pi + 1] : undefined;
const file = args.find((a, i) => !a.startsWith("--") && i !== pi + 1);
if (!file) { console.error("usage: verify-log.ts <log.jsonl> [--pubkey <base58>]"); process.exit(2); }
const r = verifyLogText(readFileSync(file, "utf8"), pub);
for (const p of r.problems) console.log("PROBLEM", p);
console.log(`${r.ok ? "OK" : "FAIL"}: ${r.records} records, signer(s): ${r.signers.join(", ") || "none"}${pub ? " (pinned)" : " (NOT pinned: pass --pubkey to rule out a wholesale re-signed log)"}`);
console.log("Cannot prove: that no records were dropped from the END (tail truncation), that the whole file was not replaced by a freshly signed one (unless --pubkey is pinned and the key is secret), or that a record's contents are true (the key holder can sign anything).");
process.exit(r.ok ? 0 : 1);
