#!/usr/bin/env bash
# QE_SANDBOX_SECURITY: wall-clock cap and cleanup test on the REAL verifier code path.
# Run from the repo root (needs docker and python3). Usage: bash scripts/sandbox_cap_test.sh [--full] [case_id]
#
# IMPORTANT, read this: there is NO real hanging libucl input in the repo (backtest/RESULTS.md says so;
# docs/DECISIONS.md says the earlier timeout test used a lowered cap). So every hang here is INDUCED and
# labeled INDUCED. It is not a collected bug. What it proves: verify.py's own docker_run() (same flags,
# same named container, same timeout + `docker kill` path) stops a container that does not exit, within
# the deadline, and leaves no container behind. What it does NOT prove: that libucl has a hanging input,
# that the server's separate 60 s cap works (server-side, not tested here), or anything about escapes.
#
#   A  INDUCED: verify.docker_run() on the vulnerable image with entrypoint /bin/sh and an input file that
#      is the script "sleep 300" (control A0: "echo ran"). Deadline 8 s (budget 3 s + 5 s kill reserve). Expect: timed out, elapsed <= 8 s.
#   A0 control: same call with input "true": must exit 0 (so a timeout in A is not a broken setup).
#   B  verify.py end to end with VERIFY_CAP_SECONDS=5.2 on a harmless input: budget 0.2 s, so the first
#      vulnerable run is cut off. Expect verdict inconclusive, elapsed <= ~6 s. (If the host is fast enough
#      to finish a container in 0.2 s this is reported NOT EXERCISED, not PASS.)
#   C  (--full only) INDUCED with the real 60 s cap: Deadline(60) via docker_run, expect kill at ~55 s,
#      total <= 60 s.
#   Every stage: afterwards `docker ps -a` must show no verify-* container.
# Results on a non-amd64 host (amd64 image under emulation) are NOT authoritative.
set -u
FULL=0; CASE=42482847
for a in "$@"; do case "$a" in --full) FULL=1;; *) CASE="$a";; esac; done
[ -f verifier/verify.py ] && [ -f verifier/cases.json ] || { echo "run from the repo root"; exit 2; }
command -v docker >/dev/null && command -v python3 >/dev/null || { echo "need docker and python3"; exit 2; }
FAILS=0; NE=0
WORK="$(mktemp -d "${VERIFY_TMPDIR:-${TMPDIR:-/tmp}}/sandbox-cap.XXXXXX")" || exit 2
WORK="$(cd "$WORK" && pwd -P)"
trap 'docker ps -aq --filter name=verify- 2>/dev/null | xargs docker rm -f >/dev/null 2>&1; rm -rf "$WORK"' EXIT

echo "== sandbox_cap_test.sh $(date -u +%FT%TZ) =="
echo "host: $(uname -sm); docker: $(docker info --format '{{.Architecture}} {{.ServerVersion}}' 2>&1)"
case "$(uname -m)" in x86_64|amd64) ;; *) echo "NOTE: non-amd64 host: results are emulated and NOT authoritative";; esac
PRE="$(docker ps -a --filter name=verify- --format '{{.Names}}')"
[ -n "$PRE" ] && echo "WARN  verify-* containers already present before the test: $PRE"

leftover() { docker ps -a --filter name=verify- --format '{{.Names}} {{.Status}}'; }
check_clean() { # label
  local l; l="$(leftover)"
  if [ -z "$l" ]; then echo "PASS  $1: no verify-* container left"; else echo "FAIL  $1: leftover: $l"; FAILS=$((FAILS+1)); fi
}

# Python driver: calls the real docker_run() from verifier/verify.py.
induced() { # label input_text deadline_seconds expect(timeout|exit0) max_elapsed
  # one fresh file per stage: re-using one path made the macOS VM file share show a stale/missing file
  local f="$WORK/input_$1"; printf '%s\n' "$2" > "$f"; chmod 0444 "$f"
  python3 -I - "$CASE" "$f" "$3" "$4" "$5" "$1" <<'PY'
import importlib.util, json, sys, time
case, inp, dl, expect, maxel, label = sys.argv[1:7]
spec = importlib.util.spec_from_file_location("verify_mod", "verifier/verify.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
img = m.load_cases()["cases"][case]["vul"]["image"]
t0 = time.monotonic()
rc, info = m.docker_run(img, "/bin/sh", inp, m.Deadline(float(dl)))
el = time.monotonic() - t0
print("%s: returncode=%r elapsed=%.2f s (deadline %s s) info=%s" % (label, rc, el, dl, str(info).replace("\n", " | ")[-300:]))
if expect == "timeout":
    ok = rc is None and el <= float(maxel)
    print("%s %s: %s" % ("PASS " if ok else "FAIL ", label, "timed out and was killed within the deadline" if ok else "expected timeout within %s s" % maxel))
else:
    ok = rc == 0 and 'ran' in str(info) and el <= float(maxel)
    print("%s %s: %s" % ("PASS " if ok else "FAIL ", label, "control script ran and exited 0 (setup works)" if ok else "control did not exit 0 (a timeout in the induced test would be meaningless)"))
sys.exit(0 if ok else 1)
PY
  local r=$?; [ $r -ne 0 ] && FAILS=$((FAILS+1)); return 0
}

echo; echo "-- A0 control (INDUCED harness: /bin/sh runs a script that exits immediately)"
induced "A0" "echo ran" 20 exit0 20
check_clean "A0"

echo; echo "-- A INDUCED hang: sh runs 'sleep 300'; real docker_run() with Deadline(8) -> budget 3 s"
induced "A" "sleep 300" 8 timeout 8.5
check_clean "A"

echo; echo "-- B real verify.py end to end, VERIFY_CAP_SECONDS=5.2 (budget 0.2 s), harmless input"
HARMLESS=targets/libucl/inputs/harmless.ucl
if [ ! -f "$HARMLESS" ]; then echo "NOT-POSSIBLE  B: $HARMLESS missing"; NE=$((NE+1)); else
  t0="$(python3 -I -c 'import time;print(time.monotonic())')"
  VOUT="$(VERIFY_CAP_SECONDS=5.2 python3 -I verifier/verify.py "$HARMLESS" --case "$CASE" 2>&1)"
  t1="$(python3 -I -c 'import time;print(time.monotonic())')"
  EL="$(python3 -I -c "print('%.2f' % ($t1-$t0))")"
  echo "verify.py output: $VOUT"; echo "elapsed: $EL s (cap 5.2 s)"
  VERDICT="$(printf '%s' "$VOUT" | python3 -I -c 'import json,sys;print(json.loads(sys.stdin.read().strip().splitlines()[-1]).get("verdict"))' 2>/dev/null)"
  LINES="$(printf '%s\n' "$VOUT" | grep -c .)"
  if [ "$LINES" != 1 ]; then echo "FAIL  B: expected exactly one stdout line, got $LINES"; FAILS=$((FAILS+1))
  elif [ "$VERDICT" = inconclusive ] && printf '%s' "$VOUT" | grep -q 'exceeded\|no time left'; then
    if python3 -I -c "import sys;sys.exit(0 if $EL <= 6.5 else 1)"; then echo "PASS  B: inconclusive via the timeout path within the cap"; else echo "FAIL  B: took $EL s, over the 5.2 s cap plus slack"; FAILS=$((FAILS+1)); fi
  elif [ "$VERDICT" = inconclusive ]; then echo "NOT EXERCISED  B: inconclusive but not via the timeout path (see detail); read it"; NE=$((NE+1))
  else echo "NOT EXERCISED  B: host finished within the 0.2 s budget (verdict $VERDICT)"; NE=$((NE+1)); fi
fi
check_clean "B"

if [ "$FULL" = 1 ]; then
  echo; echo "-- C INDUCED hang against the REAL 60 s cap (takes ~60 s)"
  induced "C" "sleep 300" 60 timeout 60
  check_clean "C"
else
  echo; echo "SKIPPED  C (real 60 s cap): rerun with --full. UNVERIFIED until run."
fi

echo; echo "== summary: FAIL=$FAILS NOT-EXERCISED/NOT-POSSIBLE=$NE =="
case "$(uname -m)" in x86_64|amd64) echo "amd64 host";; *) echo "host $(uname -m): emulated, NOT authoritative";; esac
echo "All hangs above are INDUCED, not collected bugs; the server's 60 s cap is not exercised here."
[ "$FAILS" -eq 0 ]
