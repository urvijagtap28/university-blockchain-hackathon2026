// QE-W2-007: the real rowName / overCap / refusalTitle source is cut out of web/public/app.js, run in a vm, and timed on adversarial 64 KB inputs.
// Run: env -i node --test web/test/redos.test.mjs
import test from "node:test"; import assert from "node:assert/strict"; import vm from "node:vm"; import { readFileSync } from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../public/app.js"), "utf8");
const cut = (start, end) => { const a = src.indexOf(start); assert.ok(a >= 0, start); const b = src.indexOf(end, a); assert.ok(b > a, end); return src.slice(a, b + end.length); };
const code = cut("const rowName = r => {", "\n  };") + "\n" + cut("function overCap(m)", "}\n") + "\n" + cut("function refusalTitle(m)", "}\n") + "\nthis.f = { rowName, refusalTitle };";
const ctx = {}; vm.createContext(ctx); vm.runInContext(code, ctx); const { rowName, refusalTitle } = ctx.f;
const N = 65536, ms = f => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };
test("behavior kept", () => {
  assert.equal(rowName({ label: "HAND-MADE fake: Empty file (0 B), x" }), "Empty file");
  assert.equal(rowName({ label: "ARVO 42482847, heap overflow" }), "ARVO 42482847");
  assert.equal(rowName({ label: "Plain label" }), "Plain label"); assert.equal(rowName({}), "Unlabeled");
  assert.equal(refusalTitle("402 asks 0.300000 USDC, above per-report cap 0.250000"), "Over limit");
  assert.equal(refusalTitle("ask is above the cap"), "Over limit"); assert.equal(refusalTitle("endpoint not allowed"), "Not allowed");
  assert.equal(refusalTitle("session budget"), "Budget used up"); assert.equal(refusalTitle("cap above"), "Refused");
});
test("adversarial 64 KB inputs run in under 50 ms each", () => {
  const inputs = [" ".repeat(N), "above ".repeat(N / 6), "A".repeat(N), "(".repeat(N), ",".repeat(N), "HAND-MADE" + "x".repeat(N), " ,".repeat(N / 2)];
  for (const s of inputs) { const a = ms(() => rowName({ label: s })), b = ms(() => refusalTitle(s)); assert.ok(a < 50 && b < 50, `${s.slice(0, 10)}: rowName ${a} ms, refusalTitle ${b} ms`); }
});
