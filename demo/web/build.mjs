#!/usr/bin/env node
// Build ONE self-contained HTML results page from a finished demo run directory. No network, no keys, no server.
//   node demo/web/build.mjs <run-dir> [--out demo/web/out/report.html] [--allow-failed]
// The run dir needs verdicts.jsonl and results.json (written by `node demo/run.mjs --analyze <run-dir>` or by a live run).
// The log is RE-VERIFIED here (verifyLogText, pinned to meta.signerPub) and results.json is cross-checked against it.
// Exit 0 ok; 1 verification/consistency failure (page only written with --allow-failed, and then shows CHECKS FAILED); 2 usage/missing/unreadable input.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLogText } from "../../server/src/verdictlog.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const outArg = oi >= 0 ? args[oi + 1] : undefined;
const allowFailed = args.includes("--allow-failed");
const dirArg = args.find((a, i) => !a.startsWith("--") && (oi < 0 || i !== oi + 1));
const die = (code, m) => { console.error(`BUILD FAILED: ${m}`); process.exit(code); };
if (!dirArg || (oi >= 0 && !outArg)) die(2, "usage: node demo/web/build.mjs <run-dir> [--out file] [--allow-failed]");

const dir = path.resolve(dirArg);
const logPath = path.join(dir, "verdicts.jsonl");
const resPath = path.join(dir, "results.json");
if (!existsSync(logPath)) die(2, `verdict log not found: ${logPath}`);
if (!existsSync(resPath)) die(2, `results.json not found in ${dir} (run: node demo/run.mjs --analyze ${dirArg})`);
let logText, results;
try { logText = readFileSync(logPath, "utf8"); } catch (e) { die(2, `cannot read verdict log: ${e.message}`); }
try { results = JSON.parse(readFileSync(resPath, "utf8")); } catch (e) { die(2, `cannot read results.json: ${e.message}`); }
if (results?.schema !== 1 || !Array.isArray(results.rows) || !results.meta?.signerPub) die(2, "results.json has an unexpected shape (schema 1 expected)");

// Independent re-verification of the log itself, pinned to the signer from the run metadata.
const v = verifyLogText(logText, results.meta.signerPub);
const lines = logText.split("\n").filter(Boolean);
const brokenLines = {};
for (const p of v.problems) { const m = /^line (\d+): (.*)$/.exec(p); if (m) (brokenLines[m[1]] ??= []).push(m[2]); }
const generalProblems = v.problems.filter(p => !/^line \d+:/.test(p));
const perRecord = lines.map((_, i) => !brokenLines[i + 1]);
const verifiedCount = perRecord.filter(Boolean).length;

// Cross-check results.json against the log it claims to describe.
const consistency = [];
const recs = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });
if (results.log?.records !== v.records) consistency.push(`results.json says ${results.log?.records} log records, the log has ${v.records}`);
for (const row of results.rows) {
  if (row.seq === null) continue;
  const r = recs[row.seq];
  if (!r) { consistency.push(`entry ${row.entry}: no log record at seq ${row.seq}`); continue; }
  for (const [k, lk] of [["verdict", "verdict"], ["settledAtomic", "settledAtomic"], ["txSignature", "txSignature"]])
    if (String(row[k]) !== String(r[lk])) consistency.push(`entry ${row.entry}: ${k} in results.json (${row[k]}) differs from the log (${r[lk]})`);
}

const failures = [...v.problems, ...consistency, ...(results.problems ?? []).map(p => `run check: ${p}`)];
const logFailed = v.problems.length > 0 || consistency.length > 0;
if (logFailed) {
  console.error("Log verification / consistency problems:\n" + [...v.problems, ...consistency].map(p => "  - " + p).join("\n"));
  console.error(`${verifiedCount} of ${v.records} log entries verified.`);
  if (!allowFailed) die(1, "the verdict log failed verification (use --allow-failed to render a page with a CHECKS FAILED banner)");
}

const data = { results, verify: { records: v.records, verifiedCount, perRecord, brokenLines, generalProblems, signers: v.signers, pinned: results.meta.signerPub, method: "build.mjs re-ran verifyLogText from server/src/verdictlog.ts on verdicts.jsonl, pinned to the signer public key in meta.json. A record counts as verified if no problem names its line." },
  consistency, failures };
const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028").replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
const tpl = readFileSync(path.join(HERE, "template.html"), "utf8");
if (!tpl.includes("/*__DATA__*/null")) die(2, "template.html is missing the data placeholder");
const html = tpl.replace("/*__DATA__*/null", () => json);
const out = path.resolve(outArg ?? path.join(HERE, "out", "report.html"));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes); mode ${results.mode}; ${verifiedCount} of ${v.records} log entries verified; ${failures.length} problem(s) listed`);
process.exit(logFailed ? 1 : 0);
