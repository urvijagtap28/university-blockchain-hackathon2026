// Unit tests for web/public/evidence.js (pure parsers). Run: node --test web/test/evidence.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(here, "..", "public", "evidence.js"), "utf8"), ctx);
const J = o => JSON.parse(JSON.stringify(o)); // cross-realm objects: compare as plain JSON
const pe = (v, d) => J(ctx.Evidence.parseEvidence(v, d)), pd = (a, d) => J(ctx.Evidence.parseDecision(a, d));
const texts = r => r.lines.map(l => l.text);

// Real strings: docs/evidence/real-run-2026-11-17/verdicts.jsonl and backtest/RESULTS.md (written by verifier/verify.py).
test("reproduced (recorded)", () => {
  const r = pe("reproduced", "case 42482847, 2 B input: vul 3/3 heap-buffer-overflow at ucl_lex_json_string src/ucl_parser.c:1036:8; fixed build clean");
  assert.equal(r.kind, "evidence");
  assert.deepEqual(texts(r), ["Error: heap-buffer-overflow, 3 of 3 vulnerable runs", "In libucl: ucl_lex_json_string, src/ucl_parser.c:1036", "Fixed build: clean"]);
});
test("not reproduced (recorded)", () => {
  assert.deepEqual(texts(pe("not_reproduced", "case 42482847, 47 B input: vul 3/3 clean")), ["3 of 3 vulnerable runs clean"]);
});
test("inconclusive: different error type (recorded backtest string)", () => {
  const d = "case 42482847, 2421 B input: vul run1: SEGV at kh_get_ucl_hash_caseless_node src/ucl_hash.c:230:1; vul run2: SEGV at kh_get_ucl_hash_caseless_node src/ucl_hash.c:230:1; vul run3: SEGV at kh_get_ucl_hash_caseless_node src/ucl_hash.c:230:1";
  const r = pe("inconclusive", d);
  assert.equal(r.kind, "evidence");
  assert.deepEqual(texts(r), ["Different error type than expected: SEGV", "In kh_get_ucl_hash_caseless_node, src/ucl_hash.c:230", "3 of 3 vulnerable runs"]);
});
test("inconclusive: timeout, killed, mixed, no frame, control not clean, both builds, input cap", () => {
  assert.deepEqual(texts(pe("inconclusive", "case 1, 9 B input: vul run1: run exceeded 55 s, container killed")), ["Timeout", "Vulnerable run 1: timeout, run exceeded 55 s"]);
  assert.equal(pe("inconclusive", "case 1, 9 B input: vul run1: killed (exit 137: SIGKILL, usually out of memory or amd64 emulation on a non-amd64 host); vul run2: killed (exit 137: SIGKILL, usually out of memory or amd64 emulation on a non-amd64 host); vul run3: killed (exit 137: SIGKILL, usually out of memory or amd64 emulation on a non-amd64 host)").lines[0].text.startsWith("Could not decide: sandbox run killed (exit 137)"), true);
  const mixed = pe("inconclusive", "case 1, 9 B input: vul run1: heap-buffer-overflow at f src/a.c:1:2; vul run2: clean");
  assert.deepEqual(texts(mixed), ["Vulnerable runs did not agree or did not finish", "Run 1: heap-buffer-overflow in f, src/a.c:1", "Run 2: clean"]);
  assert.match(pe("inconclusive", "case 1, 9 B input: vul run1: SEGV with no library frame; vul run2: SEGV with no library frame; vul run3: SEGV with no library frame").lines[0].text, /SEGV, no frame in library source/);
  const ctl = pe("inconclusive", "case 1, 9 B input: vul 3/3 heap-buffer-overflow at f src/a.c:1:2; fixed-build control not clean (run exceeded 20 s, container killed)");
  assert.deepEqual(texts(ctl), ["Fixed-build control did not run clean", "Vulnerable: heap-buffer-overflow in f, src/a.c:1", "Fixed: timeout, run exceeded 20 s"]);
  const both = pe("inconclusive", "case 1, 9 B input: crashes on both builds (vul 3/3 heap-buffer-overflow at f src/a.c:1:2; fix: SEGV at g src/b.c:5:6)");
  assert.deepEqual(texts(both), ["Crashed on both builds, so no clean control", "Vulnerable: heap-buffer-overflow in f, src/a.c:1", "Fixed: SEGV in g, src/b.c:5"]);
  assert.deepEqual(texts(pe("inconclusive", "input is 70000 bytes, over the 65536 byte limit")), ["Input over the size cap (70000 bytes, limit 65536)"]);
});
test("stub detail is never evidence", () => {
  for (const v of ["reproduced", "not_reproduced", "inconclusive"]) { const r = pe(v, "stub: filename contains 'real'"); assert.equal(r.kind, "stub"); assert.deepEqual(texts(r), ["Stub verdict (filename rule)"]); }
});
test("garbage, wrong verdict, near misses fall back to raw", () => {
  const raw = (v, d) => assert.equal(pe(v, d).kind, "raw", v + " / " + String(d).slice(0, 60));
  raw("reproduced", ""); raw("reproduced", "garbage"); raw("reproduced", null); raw(undefined, "case 1, 9 B input: vul 3/3 clean");
  raw("reproduced", "case 42482847, 2 B input: vul 3/3 clean");                           // verdict/format mismatch
  raw("not_reproduced", "case 42482847, 2 B input: vul 3/3 heap-buffer-overflow at f src/a.c:1; fixed build clean");
  raw("reproduced", "case 42482847, 2 B input: vul 3/3 heap-buffer-overflow at f src/a.c:1; fixed build clean EXTRA"); // trailing text
  raw("reproduced", "xcase 42482847, 2 B input: vul 3/3 heap-buffer-overflow at f src/a.c:1; fixed build clean");
  raw("error", "case 1, 9 B input: vul 3/3 clean");
  raw("inconclusive", "sandbox error: timeout after 60 s");                               // not a verify.py format
  raw("inconclusive", "case 1, 9 B input: vul run1: something unexpected");
  raw("inconclusive", "case 1, 9 B input: vul run2: clean");                              // numbering must start at 1
  raw("inconclusive", "x".repeat(3000));
});
test("HTML payloads in detail never become markup input: parser returns only plain strings and falls back to raw", () => {
  const p = "<img src=x onerror=alert(1)>";
  assert.equal(pe("reproduced", p).kind, "raw");
  assert.equal(pe("inconclusive", "case 1, 9 B input: vul run1: " + p).kind, "raw");
  // A payload in a position the strict grammar would have to accept cannot match: no '<' in function, error type or path classes.
  assert.equal(pe("reproduced", "case 1, 9 B input: vul 3/3 <img> at f src/a.c:1; fixed build clean").kind, "raw");
  assert.equal(pe("reproduced", "case 1, 9 B input: vul 3/3 heap-buffer-overflow at <b>f</b> src/a.c:1; fixed build clean").kind, "raw");
  assert.equal(pe("reproduced", "case 1, 9 B input: vul 3/3 heap-buffer-overflow at f <script>:1; fixed build clean").kind, "raw");
});
test("parseDecision only for wording the backend or fixtures emit", () => {
  assert.deepEqual(pd("allow", "allowlist: http://localhost:4021/report"), { step: "policy", ok: true, text: "Endpoint allowed (localhost:4021)" });
  assert.deepEqual(pd("approve", "approved (confirmed in the web UI, up to the per-report cap)"), { step: "approved", ok: true, text: "Approved in the web UI" });
  assert.deepEqual(pd("approve", "auto-approved: ask 250000 atomic is within AGENT_AUTO_APPROVE_USD 0.25"), { step: "approved", ok: true, text: "Auto-approved: $0.25 ask within the $0.25 limit" });
  assert.deepEqual(pd("sign", "x402 upto authorization signed (maximum is the per-report cap)"), { step: "signed", ok: true, text: "upto authorization signed" });
  assert.equal(pd("sign", "x402 upto authorization signed for 250000 atomic to 8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib").text, "upto authorization signed, up to $0.25");
  assert.equal(pd("refuse", "session budget exhausted: need $0.25, remaining $0.00").text, "Failed: session budget");
  assert.equal(pd("refuse", "ask above the per-report cap").text, "Failed: per-report cap");
  assert.deepEqual(pd("reject", "approval rejected: nothing paid"), { step: "approved", ok: false, text: "Not approved" });
  assert.equal(pd("allow", "<img src=x onerror=alert(1)>"), null);
  assert.equal(pd("approve", "whatever"), null); assert.equal(pd("sign", undefined), null); assert.equal(pd("settle", "settled 0 atomic"), null);
});
