// Pure decision tests (no network): node test/unit.ts
import assert from "node:assert/strict";
import { decideFromOutput, clamp, CAP_ATOMIC, buildInvocation, type Invocation, type Decision } from "../src/verifier.ts";
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
console.log("unit ok");
