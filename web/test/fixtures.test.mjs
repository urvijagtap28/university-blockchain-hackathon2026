// Checks every fixture against the Web app contract (AGENTS/INTERFACES.md). Run: node web/test/fixtures.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
let fails = 0, checks = 0;
const bad = (f, m) => { fails++; console.log("FAIL " + f + ": " + m); };
const t = (f, c, m) => { checks++; if (!c) bad(f, m); };
const isStr = v => typeof v === "string", isNum = v => typeof v === "number", isBool = v => typeof v === "boolean", isObj = v => v && typeof v === "object" && !Array.isArray(v);
const nullOr = (fn) => v => v === null || fn(v);
const atomic = v => isStr(v) && /^[0-9]{1,12}$/.test(v);
const keys = (f, o, exp, label) => { t(f, isObj(o), label + " not an object"); if (!isObj(o)) return; const a = Object.keys(o).sort().join(), b = exp.slice().sort().join(); t(f, a === b, label + " keys [" + a + "] expected [" + b + "]"); };
const shape = (f, o, spec, label) => { keys(f, o, Object.keys(spec), label); if (isObj(o)) for (const [k, fn] of Object.entries(spec)) t(f, fn(o[k]), label + "." + k + " has wrong type: " + JSON.stringify(o[k])); };
const oneOf = (...a) => v => a.includes(v);
const SIGRE = /^[1-9A-HJ-NP-Za-km-z]{43,90}$/;

function config(f, c) {
  shape(f, c, { mode: oneOf("stub", "real"), busy: isBool, csrfToken: isStr, policy: isObj, session: isObj, target: isObj, limits: isObj, wallet: isObj, demoInputs: Array.isArray }, "config");
  shape(f, c.policy, { perReportCapUsd: isNum, sessionBudgetUsd: isNum, approvalThresholdUsd: isNum, retryBudget: isNum, allowedUrl: isStr }, "policy");
  shape(f, c.session, { budgetAtomic: atomic, spentAtomic: atomic, reservedAtomic: atomic, remainingAtomic: atomic }, "session");
  shape(f, c.target, { caseId: isStr, targetCommit: isStr, fixCommit: isStr, vulImage: isStr, fixImage: isStr, caveat: isStr }, "target");
  shape(f, c.limits, { maxInputBytes: v => v === 65536, verifierTimeoutSeconds: isNum, maxConcurrent: isNum, rateLimitSeconds: isNum, sandbox: v => Array.isArray(v) && v.every(isStr) }, "limits");
  shape(f, c.wallet, { buyerAddress: isStr, payTo: isStr }, "wallet");
  c.demoInputs.forEach((d, i) => { shape(f, d, { id: isStr, label: isStr, category: oneOf("real_bug", "hand_made_fake"), handMade: isBool, sizeBytes: isNum }, "demoInputs[" + i + "]"); t(f, d.handMade === (d.category === "hand_made_fake"), "handMade must match category"); });
}
function log(f, l) {
  shape(f, l, { mode: oneOf("stub", "real"), signer: isStr, verify: isObj, head: nullOr(isObj), records: Array.isArray }, "log");
  shape(f, l.verify, { ok: isBool, records: isNum, verified: isNum, problems: Array.isArray }, "verify");
  l.verify.problems.forEach((p, i) => shape(f, p, { line: isNum, message: isStr }, "problems[" + i + "]"));
  if (l.head) shape(f, l.head, { seq: isNum, hash: v => /^[0-9a-f]{64}$/.test(v) }, "head");
  t(f, l.verify.records === l.records.length, "verify.records equals records.length");
  t(f, l.verify.ok === (l.verify.verified === l.verify.records && l.verify.problems.length === 0), "verify.ok consistent");
  t(f, (l.records.length === 0) === (l.head === null), "head null iff empty");
  l.records.forEach((r, i) => shape(f, r, { seq: isNum, timestamp: isStr, reportHash: v => /^[0-9a-f]{64}$/.test(v), label: nullOr(isStr), category: nullOr(oneOf("real_bug", "hand_made_fake")), verdict: isStr, detail: isStr, settledAtomic: nullOr(atomic), settlementStatus: isStr, txSignature: nullOr(isStr), sigOk: isBool }, "records[" + i + "]"));
}
function inbox(f, x) {
  keys(f, x, ["items"], "inbox"); t(f, Array.isArray(x.items), "items array");
  x.items.forEach((it, i) => { shape(f, it, { seq: isNum, reportHash: isStr, verdict: oneOf("reproduced", "inconclusive"), errorType: nullOr(isStr), topFrame: nullOr(isStr), detail: isStr, caseId: nullOr(isStr), targetCommit: nullOr(isStr), timestamp: isStr, note: nullOr(isObj) }, "items[" + i + "]"); if (it.note) shape(f, it.note, { decision: oneOf("valid", "not_a_bug", "misuse", "unreviewed"), text: isStr, ts: isStr }, "note"); });
  const ts = x.items.map(i => i.timestamp); t(f, ts.every((v, i) => i === 0 || ts[i - 1] >= v), "newest first");
}
const SSE = {
  started: o => shape("sse", o, { jobId: isStr, reportHash: isStr }, "started"),
  decision: o => shape("sse", o, { ts: isStr, action: oneOf("allow", "refuse", "approve", "reject", "sign", "retry", "settle"), detail: isStr }, "decision"),
  checking: o => shape("sse", o, { message: v => v === "checking the chain" }, "checking"),
  verdict: o => shape("sse", o, { verdict: oneOf("reproduced", "not_reproduced", "inconclusive", "error"), detail: isStr }, "verdict"),
  settled: o => shape("sse", o, { settledAtomic: atomic, txSignature: nullOr(isStr), bondOutcome: oneOf("returned", "forfeited", "unknown") }, "settled"),
  error: o => shape("sse", o, { message: isStr, settledAtomic: nullOr(atomic) }, "error"),
  done: o => shape("sse", o, { recordSeq: nullOr(isNum) }, "done"),
};
function sse(f, txt) {
  const blocks = txt.split(/\n\n+/).filter(b => b.trim());
  t(f, blocks.length > 0, "empty transcript");
  const names = [];
  blocks.forEach(b => {
    const lines = b.split("\n"); t(f, lines.length === 2 && lines[0].startsWith("event: ") && lines[1].startsWith("data: "), "block must be 'event: x' + 'data: json'");
    const ev = lines[0].slice(7); let d; try { d = JSON.parse(lines[1].slice(6)); } catch { bad(f, "bad json in " + ev); return; }
    names.push(ev); t(f, !!SSE[ev], "unknown event " + ev); if (SSE[ev]) SSE[ev](d);
  });
  t(f, names[0] === "started", "first event is started"); t(f, f.includes("dropped") || names[names.length - 1] === "done", "last event is done (dropped-stream fixtures end early on purpose)");
}
function errBody(f, b, extra) { shape(f, b, { error: isStr, message: isStr, ...extra }, "errbody"); }

const files = fs.readdirSync(dir).filter(n => n !== "README.txt").sort();
for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), "utf8");
  if (f.endsWith(".txt")) { sse(f, raw); continue; }
  let j; try { j = JSON.parse(raw); } catch { bad(f, "invalid JSON"); continue; }
  if (f.startsWith("config.")) config(f, j);
  else if (f.startsWith("log.")) log(f, j);
  else if (f.startsWith("inbox.")) inbox(f, j);
  else if (f === "notes.ok.json") keys(f, j, ["ok"], "notes");
  else if (f === "submit.202.json") keys(f, j, ["jobId"], "202");
  else if (f === "submit.429.json") errBody(f, j, { retryAfterSeconds: isNum });
  else if (f.startsWith("submit.")) errBody(f, j, {});
  else bad(f, "no checker for this file");
}
// specific expectations
const rd = n => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
t("log.tampered.json", rd("log.tampered.json").verify.ok === false && rd("log.tampered.json").verify.problems.length === 2, "tampered names 2 problems");
t("log.empty.json", rd("log.empty.json").records.length === 0, "empty");
t("log.xss.json", rd("log.xss.json").records.some(r => r.txSignature && !SIGRE.test(r.txSignature)), "xss log has a non-base58 signature");
t("log.stub.json", rd("log.stub.json").records.every(r => SIGRE.test(r.txSignature)), "stub log signatures are base58");
console.log(files.length + " fixtures, " + checks + " checks, " + fails + " failures");
process.exit(fails ? 1 : 0);
