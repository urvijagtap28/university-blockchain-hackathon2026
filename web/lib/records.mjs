// Verdict-log reading/verification, inbox parsing, notes. The signed log is the source of truth.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { verifyLogText } from "../../server/src/verdictlog.ts";

export const sha256 = b => createHash("sha256").update(b).digest("hex");
export const B58_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;

export function readLogText(file) { try { return existsSync(file) ? readFileSync(file, "utf8") : ""; } catch { return ""; } }
export function parseLines(text) {
  const out = [];
  text.split("\n").filter(Boolean).forEach((l, i) => { try { out.push({ idx: i, rec: JSON.parse(l), line: l }); } catch { /* reported by verifyLogText */ } });
  return out;
}
export const countLines = file => readLogText(file).split("\n").filter(Boolean).length;

/** Newest record for this proof hash at line index >= baseline, or null. */
export function findRecord(file, reportHash, baseline) {
  const rows = parseLines(readLogText(file));
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].idx >= baseline && rows[i].rec.reportHash === reportHash) return rows[i].rec;
  return null;
}

export function buildLogView({ file, signerPub, mode, labelFor }) {
  const text = readLogText(file);
  const v = verifyLogText(text, signerPub || undefined);
  const broken = new Set();
  const problems = v.problems.map(p => { const m = /^line (\d+):\s*(.*)$/.exec(p); if (m) broken.add(Number(m[1]) - 1); return m ? { line: Number(m[1]), message: m[2] } : { line: 0, message: p }; });
  const rows = parseLines(text);
  const records = rows.map(({ idx, rec }) => {
    const l = labelFor(rec.reportHash) ?? { label: null, category: null };
    return { seq: rec.seq, timestamp: rec.timestamp, reportHash: rec.reportHash, label: l.label, category: l.category, verdict: rec.verdict, detail: String(rec.detail ?? ""),
      settledAtomic: String(rec.settledAtomic), settlementStatus: rec.settlementStatus, txSignature: typeof rec.txSignature === "string" && B58_SIG.test(rec.txSignature) ? rec.txSignature : null, sigOk: !broken.has(idx) };
  });
  const lines = text.split("\n").filter(Boolean);
  const last = rows.length ? rows[rows.length - 1].rec : null;
  const verified = records.filter(r => r.sigOk).length;
  return { mode, signer: signerPub || (v.signers[0] ?? null), verify: { ok: v.ok, records: v.records, verified, problems },
    head: lines.length ? { seq: last?.seq ?? lines.length - 1, hash: sha256(lines[lines.length - 1]) } : null, records };
}

const ERR_TYPE = /(?:3\/3 |run\d+: |^)([a-z]+(?:-[a-z]+)+)(?= at |:|,|;|$)/;
const TOP_FRAME = /(?: at |frame )([A-Za-z_]\w*) ([^\s;,]+)/;
/** Only what the verifier detail holds; null when absent. */
export function parseDetail(detail) {
  const d = String(detail ?? "");
  const e = ERR_TYPE.exec(d), f = TOP_FRAME.exec(d);
  return { errorType: e ? e[1] : null, topFrame: f ? `${f[1]} ${f[2]}` : null };
}

export const NOTE_DECISIONS = ["valid", "not_a_bug", "misuse", "unreviewed"];
// QE-W2-004: the parse cache is keyed on a hash of the file CONTENT (re-reading a small file is cheap), so a same-size same-mtime tamper cannot leave a stale parse.
const cache = new Map();
function parsedCached(file) {
  const text = readLogText(file), key = sha256(text);
  const c = cache.get(file);
  if (c && c.key === key) return c;
  const e = { key, rows: parseLines(text), bytes: Buffer.byteLength(text) }; cache.set(file, e);
  return e;
}
export function noteFileStats(file) { const c = parsedCached(file); return { count: c.rows.length, bytes: c.bytes }; }
export function readNotes(file) {
  const m = new Map();
  for (const { rec } of parsedCached(file).rows) if (rec && typeof rec.reportHash === "string") m.set(rec.reportHash, { decision: rec.decision, text: rec.text, ts: rec.ts });
  return m;
}
export function appendNote(file, { reportHash, decision, text }) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), reportHash, decision, text }) + "\n", { mode: 0o600 });
}
export const HASH64 = /^[0-9a-f]{64}$/;
/** Lines (0-based) whose record failed verifyLogText; same verification as /api/log. */
function brokenLines(text, signerPub) {
  const v = verifyLogText(text, signerPub || undefined), broken = new Set();
  for (const p of v.problems) { const m = /^line (\d+):/.exec(p); if (m) broken.add(Number(m[1]) - 1); }
  return broken;
}
// QE-W2-003/004: each item carries sigOk (record verified, as in /api/log) and hashOk (reportHash is 64 lowercase hex); the UI must not offer copy or triage when either is false.
export function buildInbox({ file, notesFile, signerPub }) {
  const notes = readNotes(notesFile);
  const text = readLogText(file), broken = brokenLines(text, signerPub);
  const items = parseLines(text).filter(({ rec }) => rec && (rec.verdict === "reproduced" || rec.verdict === "inconclusive")).reverse().map(({ idx, rec: r }) => {
    const hashOk = typeof r.reportHash === "string" && HASH64.test(r.reportHash);
    return { seq: r.seq, reportHash: hashOk ? r.reportHash : String(r.reportHash ?? "").slice(0, 80), hashOk, sigOk: !broken.has(idx), verdict: r.verdict, ...parseDetail(r.detail), detail: String(r.detail ?? ""),
      caseId: r.caseId ?? null, targetCommit: r.targetCommit ?? null, timestamp: r.timestamp, note: hashOk ? notes.get(r.reportHash) ?? null : null };
  });
  return { items };
}
