#!/usr/bin/env node
// Negative tests for demo/web/build.mjs. Usage: node demo/web/test/negative.mjs <run-dir> <scratch-dir>
// Works on COPIES in <scratch-dir>; never touches the run dir. No network.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [runDir, scratch] = process.argv.slice(2);
if (!runDir || !scratch) { console.error("usage: negative.mjs <run-dir> <scratch-dir>"); process.exit(2); }
const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build.mjs");
let bad = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!ok) bad++; };
const build = (d, ...a) => spawnSync("node", [BUILD, d, "--out", path.join(d, "out.html"), ...a], { encoding: "utf8" });
const fresh = n => { const d = path.join(scratch, n); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); for (const f of ["verdicts.jsonl", "results.json", "meta.json"]) cpSync(path.join(runDir, f), path.join(d, f)); return d; };

// 1 tampered log: settledAtomic 250000 -> 0 on line 3
{ const d = fresh("tampered"); const L = readFileSync(path.join(d, "verdicts.jsonl"), "utf8").split("\n"); L[2] = L[2].replace('"settledAtomic":"250000"', '"settledAtomic":"0"'); writeFileSync(path.join(d, "verdicts.jsonl"), L.join("\n"));
  const r = build(d); console.log(r.stderr.trim()); check("tampered log: build fails (exit 1), no page", r.status === 1 && !existsSync(path.join(d, "out.html")));
  const r2 = build(d, "--allow-failed"); check("tampered log + --allow-failed: page written with N-1 of N", r2.status === 1 && existsSync(path.join(d, "out.html")) && /3 of 5 log entries verified|4 of 5 log entries verified/.test(r2.stderr + r2.stdout), (r2.stdout + r2.stderr).split("\n").filter(l => /of 5/.test(l)).join(" | ")); }
// 2 missing log
{ const d = fresh("nolog"); rmSync(path.join(d, "verdicts.jsonl")); const r = build(d); console.log(r.stderr.trim()); check("missing log: clear error, exit 2", r.status === 2 && /verdict log not found/.test(r.stderr)); }
// 3 XSS fixture + bad signature: edit results.json only (log untouched), so build's cross-check flags txSignature mismatch for the bad sig row; use --allow-failed
{ const d = fresh("xss"); const j = JSON.parse(readFileSync(path.join(d, "results.json"), "utf8"));
  const x = '<img src=x onerror=alert(1)>';
  j.rows[0].label = x; j.rows[0].detail = x; j.rows[0].file = x; j.rows[1].txSignature = 'javascript:alert(1)"><script>alert(2)</script>';
  writeFileSync(path.join(d, "results.json"), JSON.stringify(j));
  const r = build(d, "--allow-failed"); const html = readFileSync(path.join(d, "out.html"), "utf8");
  check("XSS fixture: build output contains no raw '<img' or '<script>alert' in the data blob", !html.includes("<img src=x") && !html.includes("<script>alert"));
  check("XSS fixture: cross-check flags the tampered signature field", /entry 2: txSignature/.test(r.stderr));
  writeFileSync(path.join(d, "fixture-info.txt"), "see out.html"); }
console.log(bad ? `${bad} FAILED` : "ALL NEGATIVE BUILD TESTS PASSED"); process.exit(bad ? 1 : 0);
