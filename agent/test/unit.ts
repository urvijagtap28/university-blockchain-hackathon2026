// Unit tests for the safety rules, with a mocked fetch and a mocked x402 signer. No network, no keys.
// run: cd agent && node test/unit.ts
import assert from "node:assert/strict";
import { Budget, RetryBudget, approvalRoute, checkAllowed, checkCap, loadConfig, parseYesNo, retryDelayMs, usdToAtomic, atomicToUsd } from "../src/policy.ts";
import { makeLogger } from "../src/log.ts";
import { submitReport, type Deps } from "../src/agent.ts";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const URL_OK = "http://localhost:4021/report";
const env = { AGENT_ALLOWED_URL: URL_OK, AGENT_PER_REPORT_CAP_USD: "0.25", AGENT_SESSION_BUDGET_USD: "2.00", AGENT_APPROVAL_THRESHOLD_USD: "0.10", AGENT_AUTO_APPROVE_USD: "0.25" };

// --- money parsing
assert.equal(usdToAtomic("0.25"), 250000n); assert.equal(usdToAtomic("2"), 2000000n); assert.equal(usdToAtomic("2.00"), 2000000n);
for (const bad of ["", "abc", "-1", "1e3", "0.1234567", "$1"]) assert.throws(() => usdToAtomic(bad), bad);
assert.equal(atomicToUsd(250000n), "0.250000");

// --- config: auto-approve is clamped to the per-report cap
assert.equal(loadConfig({ ...env, AGENT_AUTO_APPROVE_USD: "5" }).autoApprove, 250000n);
assert.throws(() => loadConfig({}), /AGENT_ALLOWED_URL/);

// --- allowlist
const cfg = loadConfig(env);
assert.equal(checkAllowed(URL_OK, cfg).ok, true);
for (const u of ["http://localhost:4021/other", "http://localhost:4022/report", "https://localhost:4021/report", "http://evil.test/report", "http://localhost:4021/report?x=1", "http://user:p@localhost:4021/report", "http://localhost:4021/report/", "nonsense", "http://localhost:4021@evil.test/report"])
  assert.equal(checkAllowed(u, cfg).ok, false, u);

// --- per-report cap
assert.equal(checkCap(250000n, cfg).ok, true); assert.equal(checkCap(250001n, cfg).ok, false); assert.equal(checkCap(0n, cfg).ok, false); assert.equal(checkCap(-5n, cfg).ok, false);

// --- budget: reserve worst case, release on $0, keep on forfeit, stop when exhausted
{
  const b = new Budget(usdToAtomic("2.00"));
  for (let i = 0; i < 8; i++) assert.equal(b.tryReserve(250000n), true);
  assert.equal(b.tryReserve(250000n), false); assert.equal(b.remaining, 0n);
  b.settle(250000n, 0n); assert.equal(b.remaining, 250000n); // $0 settle gives the reservation back
  b.settle(250000n, 250000n); assert.equal(b.remaining, 250000n); // forfeit: stays spent
  b.settle(250000n, 999999n); assert.equal(b.remaining, 250000n); // actual clamped to worst case
  b.release(250000n); assert.equal(b.remaining, 500000n);
}

// --- approval routing and parsing
assert.equal(approvalRoute(100000n, cfg).kind, "below_threshold");
assert.equal(approvalRoute(250000n, cfg).kind, "auto_approved");
const noAuto = loadConfig({ ...env, AGENT_AUTO_APPROVE_USD: "0" });
assert.equal(approvalRoute(250000n, noAuto).kind, "needs_prompt");
const lowAuto = loadConfig({ ...env, AGENT_AUTO_APPROVE_USD: "0.15" });
assert.equal(approvalRoute(250000n, lowAuto).kind, "needs_prompt"); // above the auto level
assert.equal(approvalRoute(300000n, { ...cfg }).kind, "needs_prompt"); // never auto above cap (checkCap refuses earlier anyway)
for (const y of ["y", "Y", "yes", " YES "]) assert.equal(parseYesNo(y), true);
for (const n of ["", "n", "no", "yy", "yes please", null, undefined]) assert.equal(parseYesNo(n as any), false);

// --- retry budget and delay
{
  const r = new RetryBudget(1, 2);
  assert.equal(r.tryRetry(0), true); assert.equal(r.tryRetry(1), false); // 1 per report
  assert.equal(r.tryRetry(0), true); assert.equal(r.tryRetry(0), false); // session cap 2
  assert.equal(retryDelayMs("10", cfg), 10500); assert.equal(retryDelayMs("9999", cfg), 30000); assert.equal(retryDelayMs("junk", cfg), 11500); assert.equal(retryDelayMs(undefined, cfg), 11500);
}

// --- logger drops key-like fields, keeps tx
{
  const f = path.join(mkdtempSync(path.join(tmpdir(), "agentlog-")), "d.log");
  makeLogger(f)("x", { tx: "abc", privateKey: "SECRET1", AGENT_SVM_PRIVATE_KEY: "SECRET2", paymentSignature: "SECRET3", n: 5n });
  const t = readFileSync(f, "utf8"); assert.ok(t.includes('"tx":"abc"') && t.includes('"n":"5"') && !/SECRET/.test(t));
}

// --- integration of the rules in submitReport, mocked fetch + signer
type R = { status: number; headers?: Record<string, string>; json?: unknown };
function mk(responses: R[], over: Partial<Deps> = {}, askAtomic = "250000") {
  const calls: { url: string; paid: boolean }[] = [];
  let signed = 0, prompts = 0;
  const events: string[] = [];
  const queue = [...responses];
  const fetchFn = (async (u: any, init: any) => {
    calls.push({ url: String(u), paid: !!init?.headers?.["PAYMENT-SIGNATURE"] });
    const r = queue.shift(); if (!r) throw new Error("unexpected extra fetch");
    return new Response(r.json !== undefined ? JSON.stringify(r.json) : "", { status: r.status, headers: r.headers });
  }) as typeof fetch;
  const deps: Deps = {
    cfg, budget: new Budget(usdToAtomic("2.00")), retries: new RetryBudget(1, 3),
    log: (e, d) => { events.push(e); (deps as any)._last = { e, d }; },
    fetchFn,
    x402: {
      getPaymentRequiredResponse: () => ({ accepts: [{ scheme: "upto", network: "solana:dev", amount: askAtomic, payTo: "PAYTO" }] }),
      createPaymentPayload: async () => { signed++; return { p: 1 }; },
      encodePaymentSignatureHeader: () => ({ "PAYMENT-SIGNATURE": "sig" }),
    },
    prompt: async () => { prompts++; return "y"; },
    sleep: async () => {},
    ...over,
  };
  return { deps, calls, events, stats: () => ({ signed, prompts }) };
}
const body = new Uint8Array([1, 2, 3]);
const ok402: R = { status: 402 };
const settled = (v: string, amt: string): R => ({ status: 200, json: { verdict: v, detail: "d", settledAtomic: amt } });

{ // (c) non-allowlisted URL: refused, NO network call at all, nothing signed
  const m = mk([]);
  const o = await submitReport(m.deps, body, "http://evil.test/report");
  assert.equal(o.status, "refused"); assert.equal(m.calls.length, 0); assert.equal(m.stats().signed, 0); assert.deepEqual(m.events, ["refuse_url"]);
}
{ // redirect on the unpaid request: refused, not followed, nothing signed
  const m = mk([{ status: 302, headers: { location: "http://evil.test/x" } }]);
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "refused"); assert.equal(m.calls.length, 1); assert.equal(m.stats().signed, 0); assert.ok(m.events.includes("refuse_redirect"));
}
{ // redirect AFTER payment: not followed, reservation kept (unknown outcome)
  const m = mk([ok402, { status: 307, headers: { location: "http://evil.test/x" } }]);
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "unknown"); assert.equal(m.calls.length, 2); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00") - 250000n);
}
{ // (d) over-cap 402: refused BEFORE signing, budget untouched
  const m = mk([ok402], {}, "250001");
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "refused"); assert.equal(m.stats().signed, 0); assert.equal(m.calls.length, 1); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00")); assert.ok(m.events.includes("refuse_cap"));
}
{ // (e) budget exhausted: refused before signing
  const m = mk([ok402]);
  assert.equal(m.deps.budget.tryReserve(usdToAtomic("1.80")), true); // 0.20 left < 0.25
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "refused"); assert.equal(m.stats().signed, 0); assert.ok(m.events.includes("refuse_budget"));
}
{ // (e2) eight forfeits exhaust $2.00, ninth refused
  const m = mk([...Array.from({ length: 8 }).flatMap(() => [ok402, settled("not_reproduced", "250000")]), ok402]);
  for (let i = 0; i < 8; i++) assert.equal((await submitReport(m.deps, body, URL_OK)).status, "done");
  assert.equal(m.deps.budget.remaining, 0n);
  assert.equal((await submitReport(m.deps, body, URL_OK)).status, "refused"); assert.equal(m.stats().signed, 8);
}
{ // reproduced: $0 settled, reservation released
  const m = mk([ok402, settled("reproduced", "0")]);
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "done"); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00"));
}
{ // (f) approval required, no auto-approve: rejected -> no signing, budget released
  const m = mk([ok402], { cfg: noAuto, prompt: async () => "n" });
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "rejected"); assert.equal(m.stats().signed, 0); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00")); assert.ok(m.events.includes("approval_rejected"));
}
{ // no answer (no TTY) = rejection
  const m = mk([ok402], { cfg: noAuto, prompt: async () => null });
  assert.equal((await submitReport(m.deps, body, URL_OK)).status, "rejected"); assert.equal(m.stats().signed, 0);
}
{ // approved by human -> pays
  const m = mk([ok402, settled("not_reproduced", "250000")], { cfg: noAuto, prompt: async () => "y" });
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "done"); assert.equal(m.stats().signed, 1); assert.ok(m.events.includes("approval_granted"));
}
{ // auto-approve path never prompts
  const m = mk([ok402, settled("reproduced", "0")]);
  await submitReport(m.deps, body, URL_OK); assert.equal(m.stats().prompts, 0); assert.ok(m.events.includes("approval_auto"));
}
{ // backoff: paid-stage 429 -> wait, retry ONCE, second 429 -> stop; budget fully released
  let slept = 0;
  const m = mk([ok402, { status: 429, headers: { "retry-after": "10" } }, ok402, { status: 429, headers: { "retry-after": "10" } }], { sleep: async ms => { slept += ms; } });
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "unpaid_limited"); assert.equal(m.calls.length, 4); assert.equal(slept, 10500); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00")); assert.ok(m.events.includes("retry") && m.events.includes("retry_denied"));
}
{ // busy ($0 settled) then retry succeeds
  const m = mk([ok402, settled("busy", "0"), ok402, settled("reproduced", "0")]);
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "done"); assert.equal((o as any).verdict, "reproduced"); assert.equal(m.stats().signed, 2);
}
{ // session retry budget exhausted: busy is not retried
  const m = mk([ok402, settled("busy", "0")], { retries: new RetryBudget(1, 0) });
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal((o as any).verdict, "busy"); assert.equal(m.stats().signed, 1);
}
{ // post-payment 402 (settlement_pending / settle_failed): reservation KEPT
  const m = mk([ok402, { status: 402, headers: {} }]);
  const o = await submitReport(m.deps, body, URL_OK);
  assert.equal(o.status, "unknown"); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00") - 250000n);
}
{ // server claims settled more than reserved: clamped
  const m = mk([ok402, settled("not_reproduced", "900000")]);
  await submitReport(m.deps, body, URL_OK); assert.equal(m.deps.budget.remaining, usdToAtomic("2.00") - 250000n);
}
console.log("agent unit ok");
