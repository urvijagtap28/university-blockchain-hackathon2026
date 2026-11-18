// QE round 3 (QE2-F-004): sweepRunDir removes only stale jobs/*.decisions.log and scratch/* plain files older than process start; touches nothing else (symlinks, dirs, other files, fresh files, parent dir targets).
// Run: env -i PATH=/usr/bin:/bin HOME=$HOME node web/test/qe/r3_sweep.mjs. Temp dir only; key-free.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, utimesSync, readdirSync } from "node:fs"; import os from "node:os"; import path from "node:path";
import { sweepRunDir } from "../../server.mjs";
const d = mkdtempSync(path.join(os.tmpdir(), "qer3s-")), out = path.join(d, "outside"); mkdirSync(out); writeFileSync(path.join(out, "victim.txt"), "keep");
const run = path.join(d, "run"); for (const s of ["jobs", "scratch"]) mkdirSync(path.join(run, s), { recursive: true });
const old = new Date(Date.now() - 3600e3), W = (f, t = old) => { writeFileSync(f, "x"); utimesSync(f, t, t); };
W(path.join(run, "jobs", "a.decisions.log")); W(path.join(run, "jobs", "b.txt")); W(path.join(run, "jobs", "fresh.decisions.log"), new Date(Date.now() + 5000)); W(path.join(run, "scratch", "h1.bin")); W(path.join(run, "verdicts.jsonl"));
mkdirSync(path.join(run, "scratch", "subdir")); W(path.join(run, "scratch", "subdir", "inner"));
symlinkSync(path.join(out, "victim.txt"), path.join(run, "scratch", "link.bin")); symlinkSync(out, path.join(run, "jobs", "dirlink.decisions.log"));
const n = sweepRunDir(run, Date.now());
const ok = (id, c, note) => console.log(`${c ? "PASS" : "FAIL"} ${id}: ${note}`); let f = 0; const chk = (id, c, note) => { if (!c) f++; ok(id, c, note); };
chk("removes-stale", !existsSync(path.join(run, "jobs", "a.decisions.log")) && !existsSync(path.join(run, "scratch", "h1.bin")), `removed count ${n}`);
chk("keeps-other-names-and-fresh", existsSync(path.join(run, "jobs", "b.txt")) && existsSync(path.join(run, "jobs", "fresh.decisions.log")) && existsSync(path.join(run, "verdicts.jsonl")), "jobs/b.txt, fresh job log, verdicts.jsonl kept");
chk("keeps-dirs", existsSync(path.join(run, "scratch", "subdir", "inner")), "subdir and its content kept");
chk("symlinks-not-followed", existsSync(path.join(out, "victim.txt")) && readdirSync(out).length === 1, "symlink targets untouched (links are not plain files, so left alone)");
chk("missing-dirs-ok", sweepRunDir(path.join(d, "nope"), Date.now()) === 0, "no throw on missing run dir");
process.exit(f ? 1 : 0);
