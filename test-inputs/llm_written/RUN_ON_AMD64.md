# Run plan for B (amd64 laptop, no payments)

Written by Claude on 2026-11-17. Nothing here has been run; no results are included. Ground truth of the inputs is unknown. Any `reproduced` must be reported as such and triaged by a human, never relabeled.

Run from the repo root (Git Bash or WSL on Windows; docker running; ARVO images for 42482847 already pulled).

## 0. Setup and record
Do not edit, delete or regenerate any input file, before or after the run. Stash or commit any local changes before switching branches.
```bash
git checkout orchestrator-setup && git pull
git rev-parse HEAD
sha256sum verifier/verify.py        # last known good: 1bd695e02decdd8557216ba69f6479154c14edd97af33af10d5f4d0bd6a9d432
docker --version; uname -m
```
Report all of these. If the verify.py hash differs, say what changed.

## 1. Check files are intact (line endings preserved)
```bash
python3 -I - <<'PY'
import json,hashlib,os
m=json.load(open("test-inputs/llm_written/manifest.json"))["files"]
bad=[f["file"] for f in m if hashlib.sha256(open("test-inputs/llm_written/"+f["file"],"rb").read()).hexdigest()!=f["sha256"]]
print(len(m),"files; hash mismatches:",bad)
PY
```
If any mismatch, stop and report it (do not run that file).

## 2. Run every input through the real verifier (no server, no payments)
```bash
D=$(date +%F); OUT=../llm_written_results_$D.jsonl   # outside git
: > "$OUT"
for f in test-inputs/llm_written/llm_*; do
  s=$(date +%s)
  line=$(python -I verifier/verify.py "$f" --case 42482847 2>/dev/null)
  rc=$?
  e=$(( $(date +%s) - s ))
  printf '{"file":"%s","rc":%d,"secs":%d,"out":%s}\n' "$(basename "$f")" "$rc" "$e" "${line:-null}" >> "$OUT"
  echo "$(basename "$f") rc=$rc ${e}s $line"
done
```
(`python` may be `py -3` on Windows. If the verifier output is not valid JSON the jsonl row is invalid; keep the console output too.)

## 3. Counts
```bash
python3 -I - "$OUT" <<'PY'
import sys,json,collections
rows=[json.loads(l) for l in open(sys.argv[1])]
c=collections.Counter((r["out"] or {}).get("verdict","FAILURE") if r["rc"]==0 else "FAILURE" for r in rows)
print(len(rows),"inputs;",dict(c))
for r in rows:
    if (r["out"] or {}).get("verdict")!="not_reproduced": print(r["file"],r["rc"],r["secs"],r["out"])
print("max secs:",max(r["secs"] for r in rows))
print("over 60 s:",[r["file"] for r in rows if r["secs"]>60])
PY
```
A FAILURE is: non-zero exit, not exactly one JSON line, or over 60 s. The script flags non-zero exits as FAILURE and prints any file over 60 s separately; report both.

## 4. Sandbox cap test (unchanged)
```bash
bash scripts/sandbox_cap_test.sh
```

After the cap test, confirm nothing is left running:
```bash
docker ps -a | grep verify- || echo "no leftover verify-* containers"
```

## 5. Send back
- The results file (`llm_written_results_<date>.jsonl`) and the console output of step 3.
- Machine details (CPU arch, docker version) and `git rev-parse HEAD`.
- For every `reproduced` or `inconclusive` row: the full detail string; for each `reproduced`, re-run that file and keep the ASan trace for human triage.
- Output of step 4 and of the leftover-container check.
- Step 0 output (commit, verify.py sha256, docker version, architecture).
- Leave every `reproduced` row unlabeled. Person A will match each against the 6 known cases in verifier/cases.json.
Do not edit the input files after running. Counts to quote: reproduced / not_reproduced / inconclusive / failures, out of the total, with the wording in README.md.
