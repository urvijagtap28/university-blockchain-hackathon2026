// Pure decision tests (no network): node test/unit.ts
import assert from "node:assert/strict";
import { decideFromOutput, clamp, finalSettle, CAP_ATOMIC, buildInvocation, type Invocation, type Decision } from "../src/verifier.ts";
const ok = (v: string, extra = "") => `{"verdict":"${v}","detail":"d"${extra}}`;
assert.equal(decideFromOutput(ok("not_reproduced"), false).settleAtomic, 250000n);
assert.equal(decideFromOutput(ok("reproduced"), false).settleAtomic, 0n);
assert.equal(decideFromOutput(ok("inconclusive"), false).settleAtomic, 0n);
assert.equal(decideFromOutput(ok("not_reproduced", ',"stub":true'), false).verdict, "error"); // stub refused
assert.equal(decideFromOutput(ok("not_reproduced", ',"stub":true'), false).settleAtomic, 0n);
assert.equal(decideFromOutput(ok("not_reproduced", ',"stub":true'), true).settleAtomic, 250000n); // allowed in test mode
for (const bad of ["", "not json", "[]", "null", '{"verdict":"win"}', ok("reproduced") + "\n" + ok("reproduced"), '{"detail":"x"}']) {
  const d = decideFromOutput(bad, true);
  assert.equal(d.verdict, "error", bad); assert.equal(d.settleAtomic, 0n);
}
assert.equal(clamp(300000n), CAP_ATOMIC); assert.equal(clamp(-5n), 0n);
// Invocation: amd64-only, case from config, cap below ours, secrets not passed on
const e0 = { PATH: "/bin", VERIFIER_CASE: "42482847", SVM_PRIVATE_KEY: "x", SVM_RPC_URL: "y" };
const arm = buildInvocation("f", false, e0, "arm64") as Decision;
assert.equal(arm.verdict, "error"); assert.equal(arm.settleAtomic, 0n);
assert.equal((buildInvocation("f", false, { ...e0, VERIFIER_ALLOW_NON_AMD64: "1" }, "arm64") as Invocation).cmd, "python3");
const inv = buildInvocation("f", false, { ...e0, VERIFIER_PYTHON: "python" }, "x64") as Invocation;
assert.equal(inv.cmd, "python"); assert.deepEqual(inv.args.slice(-2), ["--case", "42482847"]);
assert.equal(inv.env.VERIFY_CAP_SECONDS, "55"); assert.equal(inv.secs, 60);
assert.equal(inv.env.SVM_PRIVATE_KEY, undefined); assert.equal(inv.env.SVM_RPC_URL, undefined);
assert.equal((buildInvocation("f", false, { ...e0, VERIFIER_TIMEOUT_SECONDS: "5" }, "x64") as Invocation).env.VERIFY_CAP_SECONDS, "1");
for (const badCase of ["../x", "42;ls", "abcd", "1234567890123"]) assert.equal((buildInvocation("f", true, { VERIFIER_CASE: badCase }, "arm64") as Decision).verdict, "error", badCase);
assert.equal(((buildInvocation("f", true, {}, "arm64")) as Invocation).args.length, 2); // stub mode: no case, no arch guard
// Clamp: an over-cap decision can never produce an over-cap settle; error always settles 0
assert.equal(finalSettle({ verdict: "not_reproduced", settleAtomic: 300_000n }), CAP_ATOMIC);
assert.equal(finalSettle({ verdict: "not_reproduced", settleAtomic: 10n ** 30n }), CAP_ATOMIC);
assert.equal(finalSettle({ verdict: "error", settleAtomic: CAP_ATOMIC }), 0n);
assert.equal(finalSettle({ verdict: "reproduced", settleAtomic: -1n }), 0n);
// settlement_pending recovery (mock RPC, no network)
import { pollSignature, makeSettlementRecovery, isPendingError } from "../src/settlement.ts";
const rpc = (seq: Array<unknown>) => { let i = 0; return (async () => ({ ok: true, json: async () => ({ result: { value: [seq[Math.min(i++, seq.length - 1)]] } }) })) as unknown as typeof fetch; };
let clock = 0; const fakeNow = () => clock; const fakeSleep = async (ms: number) => { clock += ms; };
const popt = (f: typeof fetch) => ({ timeoutMs: 10_000, intervalMs: 1000, fetchImpl: f, now: fakeNow, sleep: fakeSleep });
assert.equal(await pollSignature("u", "sig", popt(rpc([null, null, { err: null, confirmationStatus: "confirmed" }]))), "confirmed");
assert.equal(await pollSignature("u", "sig", popt(rpc([null, { err: null, confirmationStatus: "processed" }, { err: null, confirmationStatus: "finalized" }]))), "confirmed");
assert.equal(await pollSignature("u", "sig", popt(rpc([null, { err: { InstructionError: [0, "x"] }, confirmationStatus: "confirmed" }]))), "failed");
clock = 0; assert.equal(await pollSignature("u", "sig", popt(rpc([null]))), "unknown"); assert.ok(clock <= 10_000, "bounded"); // never confirms -> terminates
assert.equal(await pollSignature("u", "sig", popt((async () => { throw new Error("429"); }) as unknown as typeof fetch)), "unknown"); // RPC errors do not throw
const pendErr = Object.assign(new Error("p"), { errorReason: "settlement_pending", transaction: "SIG", network: "solana:x", payer: "P" });
assert.ok(isPendingError(pendErr)); assert.ok(!isPendingError(Object.assign(new Error("p"), { errorReason: "other", transaction: "S" })));
assert.ok(!isPendingError(Object.assign(new Error("p"), { errorReason: "settlement_pending", transaction: "" }))); // no sig -> nothing to poll
const logs: string[] = [];
const hook = (f: typeof fetch) => makeSettlementRecovery({ rpcUrl: "u", timeoutMs: 5000, intervalMs: 1000, fetchImpl: f, now: fakeNow, sleep: fakeSleep, log: l => logs.push(l) });
const rec = await hook(rpc([null, { err: null, confirmationStatus: "confirmed" }]))({ error: pendErr }) as { recovered: true; result: { success: boolean; transaction: string } };
assert.equal(rec.recovered, true); assert.equal(rec.result.success, true); assert.equal(rec.result.transaction, "SIG");
assert.equal(await hook(rpc([null]))({ error: pendErr }), undefined); // timeout -> not recovered
assert.equal(await hook(rpc([{ err: "boom", confirmationStatus: "confirmed" }]))({ error: pendErr }), undefined); // tx failed -> not recovered
assert.equal(await hook(rpc([{ err: null, confirmationStatus: "confirmed" }]))({ error: Object.assign(new Error("x"), { errorReason: "boom", transaction: "S" }) }), undefined); // other failure ignored
console.log("unit ok");
