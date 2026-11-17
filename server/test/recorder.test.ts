// node test/recorder.test.ts : OutcomeRecorder writes exactly one record per paid request on every path (D-013).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VerdictLog, ephemeralSigner, verifyLogText, OutcomeRecorder, SettleNotes, type PendingFields } from "../src/verdictlog.ts";

const signer = await ephemeralSigner();
const dir = mkdtempSync(path.join(tmpdir(), "rec-"));
const mk = (name: string, ms = 30) => {
  const f = path.join(dir, name);
  const warns: string[] = [];
  const notes = new SettleNotes();
  const rec = new OutcomeRecorder(new VerdictLog(f, signer), notes, ms, m => warns.push(m));
  const lines = () => { try { return readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  return { rec, notes, warns, lines, f };
};
const F: PendingFields = { reportHash: "ab".repeat(32), caseId: null, targetCommit: null, fixCommit: null, vulImage: null, fixImage: null, casesSha256: null, verifierSha256: null, verdict: "not_reproduced", detail: "d", attempted: "250000" };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 1. normal: hook reports (settled), then close => exactly one record, settled
{ const t = mk("a.jsonl"); const k = t.rec.register("K1", F); t.rec.flush(k, { status: "settled", tx: "sig1", amount: "250000" }); t.rec.closed(k); await sleep(80);
  const L = t.lines(); assert.equal(L.length, 1); assert.equal(L[0].settlementStatus, "settled"); assert.equal(L[0].txSignature, "sig1"); assert.equal(t.rec.pendingCount, 0); }
// 2. settle failed (402) hook: failed record with the pending sig
{ const t = mk("b.jsonl"); const k = t.rec.register("K2", F); t.rec.flush(k, { status: "failed", tx: "pendsig", amount: null }); t.rec.closed(k); await sleep(80);
  const L = t.lines(); assert.equal(L.length, 1); assert.equal(L[0].settlementStatus, "failed"); assert.equal(L[0].txSignature, "pendsig"); assert.equal(L[0].settledAtomic, "250000"); }
// 3. client already disconnected before register (closed() right after register), settle reports LATER => still one settled record
{ const t = mk("c.jsonl", 500); const k = t.rec.register("K3", F); t.rec.closed(k); await sleep(20); assert.equal(t.lines().length, 0);
  t.rec.flush(k, { status: "settled", tx: "sig3", amount: "0" }); await sleep(20); const L = t.lines(); assert.equal(L.length, 1); assert.equal(L[0].settlementStatus, "settled"); assert.equal(L[0].settledAtomic, "0"); }
// 4. settle never reports: fallback timer after close writes status unknown
{ const t = mk("d.jsonl"); const k = t.rec.register("K4", F); t.rec.closed(k); await sleep(100); const L = t.lines(); assert.equal(L.length, 1); assert.equal(L[0].settlementStatus, "unknown"); }
// 5. settle never reports AND response never closes: nothing is written yet (documented: pendingCount stays 1)
{ const t = mk("e.jsonl"); t.rec.register("K5", F); await sleep(100); assert.equal(t.lines().length, 0); assert.equal(t.rec.pendingCount, 1); }
// 6. escaped exception path registers like any other
{ const t = mk("f.jsonl"); const k = t.rec.register("K6", { ...F, verdict: "error", detail: "internal error (escaped exception)", attempted: "0" }); t.rec.flush(k, { status: "settled", tx: "s6", amount: "0" }); assert.equal(t.lines()[0].verdict, "error"); }
// 7. double flush / flush without register => no duplicate
{ const t = mk("g.jsonl"); const k = t.rec.register("K7", F); t.rec.flush(k, { status: "settled", tx: "s", amount: "1" }); t.rec.flush(k, { status: "failed", tx: "x", amount: null }); t.rec.flush("nope"); assert.equal(t.lines().length, 1); }
// 8. no payment key: unique anon key, still recorded via fallback
{ const t = mk("h.jsonl"); const k = t.rec.register(null, F); const k2 = t.rec.register(null, F); assert.notEqual(k, k2); t.rec.closed(k); t.rec.closed(k2); await sleep(100); assert.equal(t.lines().length, 2); }
// 9. pre-handler failure (verify/deposit settle failed, handler never ran)
{ const t = mk("i.jsonl"); const { attempted: _a, ...base } = F; t.rec.preHandlerFailure({ ...base, verdict: "payment_failed" }, "depsig", "deposit settle failed");
  const L = t.lines(); assert.equal(L.length, 1); assert.equal(L[0].verdict, "payment_failed"); assert.equal(L[0].settledAtomic, "0"); assert.equal(L[0].settlementStatus, "failed"); assert.equal(L[0].txSignature, "depsig");
  assert.equal(verifyLogText(readFileSync(t.f, "utf8"), signer.publicKeyB58).ok, true); }
// 10. log unwritable: loud warning, no throw. log disabled (null): silent no-op
{ const notes = new SettleNotes(); const warns: string[] = []; const bad = new VerdictLog(path.join(dir, "nodir", "x.jsonl"), signer);
  const rec = new OutcomeRecorder(bad, notes, 10, m => warns.push(m)); const k = rec.register("K10", F); rec.flush(k, { status: "settled", tx: "s", amount: "1" });
  assert.ok(warns.some(w => w.includes("could NOT be written")), warns.join("|"));
  const off = new OutcomeRecorder(null, notes, 10, m => warns.push(m)); off.flush(off.register("K", F)); }
console.log("recorder ok");
