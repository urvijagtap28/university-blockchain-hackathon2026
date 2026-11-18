// node test/verdictlog.test.ts  (ephemeral in-memory key; temp dir)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VerdictLog, ephemeralSigner, verifyLogText, canonicalize, signerFromKeypair, type RecordFields } from "../src/verdictlog.ts";
import { base58 } from "@scure/base";
import { generateKeyPairSync } from "node:crypto";

assert.equal(canonicalize({ b: 1, a: { d: [3, { y: null, x: "é" }], c: true } }), '{"a":{"c":true,"d":[3,{"x":"é","y":null}]},"b":1}');
const dir = mkdtempSync(path.join(tmpdir(), "vlog-"));
const f = path.join(dir, "v.jsonl");
const fields = (n: number): RecordFields => ({
  reportHash: "ab".repeat(32), caseId: n % 2 ? null : "42482847", targetCommit: "875c251", fixCommit: null, vulImage: null, fixImage: null,
  casesSha256: "cd".repeat(32), verifierSha256: null, verdict: n % 2 ? "reproduced" : "not_reproduced", detail: "d" + n,
  settledAtomic: n % 2 ? "0" : "250000", settlementStatus: "settled", txSignature: n % 2 ? "sigA" : "sigB", timestamp: new Date(1e12 + n).toISOString(),
});
const signer = await ephemeralSigner();
const log = new VerdictLog(f, signer);
for (let i = 0; i < 4; i++) assert.ok(log.append(fields(i)));
let text = readFileSync(f, "utf8");
let r = verifyLogText(text, signer.publicKeyB58);
assert.equal(r.ok, true, r.problems.join(";")); assert.equal(r.records, 4);
// restart continues the chain
const log2 = new VerdictLog(f, signer); log2.append(fields(4));
assert.equal(verifyLogText(readFileSync(f, "utf8"), signer.publicKeyB58).ok, true);
text = readFileSync(f, "utf8");
const L = text.split("\n").filter(Boolean);
// tamper a field (keeping canonical form): signature must fail
const t1 = L.map((l, i) => i === 0 ? l.replace('"verdict":"not_reproduced"', '"verdict":"reproduced"') : l).join("\n") + "\n";
assert.notEqual(t1, text); r = verifyLogText(t1); assert.equal(r.ok, false); assert.ok(r.problems.some(p => p.includes("BAD SIGNATURE")));
// tamper settled amount
const t2 = text.replace('"settledAtomic":"250000"', '"settledAtomic":"0"'); r = verifyLogText(t2); assert.equal(r.ok, false);
// whitespace re-serialization -> not canonical
r = verifyLogText(L.map((l, i) => i === 0 ? JSON.stringify(JSON.parse(l), null, 1).replace(/\n\s*/g, " ") : l).join("\n") + "\n"); assert.equal(r.ok, false);
// delete a middle record -> seq + chain break
r = verifyLogText([L[0], L[1], L[3], L[4]].join("\n") + "\n"); assert.equal(r.ok, false); assert.ok(r.problems.some(p => p.includes("chain") || p.includes("seq")));
// reorder
r = verifyLogText([L[0], L[2], L[1], L[3], L[4]].join("\n") + "\n"); assert.equal(r.ok, false);
// delete the first record
r = verifyLogText(L.slice(1).join("\n") + "\n"); assert.equal(r.ok, false);
// tail truncation is NOT detectable (documented limitation)
r = verifyLogText(L.slice(0, 3).join("\n") + "\n"); assert.equal(r.ok, true);
// wrong key: pinned to another key fails; a record re-signed by another key fails against the pin
const other = await ephemeralSigner();
r = verifyLogText(text, other.publicKeyB58); assert.equal(r.ok, false); assert.ok(r.problems.some(p => p.includes("pinned")));
const f2 = path.join(dir, "o.jsonl"); new VerdictLog(f2, other).append(fields(0));
r = verifyLogText(L[0] + "\n" + readFileSync(f2, "utf8")); assert.equal(r.ok, false); // mixed signers / chain
// signature swapped in from another signer's record
const sig2 = JSON.parse(readFileSync(f2, "utf8")).signature;
r = verifyLogText(L.map((l, i) => i === 0 ? l.replace(JSON.parse(l).signature, sig2) : l).join("\n") + "\n"); assert.equal(r.ok, false);
// key parsing: good keypair round trips, mismatched halves and wrong length rejected
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const s3 = signerFromKeypair(base58.encode(Buffer.concat([seed, pub]))); assert.equal(s3.publicKeyB58, base58.encode(pub));
assert.throws(() => signerFromKeypair(base58.encode(Buffer.concat([seed, Buffer.alloc(32, 7)]))));
assert.throws(() => signerFromKeypair(base58.encode(seed)));
// append never throws, even to an unwritable path
assert.equal(new VerdictLog(path.join(dir, "no/such/dir/x.jsonl"), signer).append(fields(0)), null);
rmSync(dir, { recursive: true, force: true });
console.log("verdictlog ok");
