// Pure decision tests (no network): node test/unit.ts
import assert from "node:assert/strict";
import { decideFromOutput, clamp, CAP_ATOMIC } from "../src/verifier.ts";
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
console.log("unit ok");
