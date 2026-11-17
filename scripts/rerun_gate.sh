#!/usr/bin/env bash
# Run from the repo root on the x86_64 box (WSL 2 shell with docker). Usage: bash rerun_gate.sh [case_id]
set -u
CASE="${1:-42482847}"
POC="targets/libucl/inputs/arvo_${CASE}.poc"
OUT="gate_rerun_${CASE}"; mkdir -p "$OUT"
VUL=$(python3 -I -c "import json;print(json.load(open('verifier/cases.json'))['cases']['$CASE']['vul']['image'])")
FIX=$(python3 -I -c "import json;print(json.load(open('verifier/cases.json'))['cases']['$CASE']['fix']['image'])")
H=/out/ucl_add_string_fuzzer
AO="alloc_dealloc_mismatch=0:allocator_may_return_null=1:detect_leaks=0:detect_stack_use_after_return=1:fast_unwind_on_fatal=0:handle_abort=1:handle_segv=1:symbolize=1:print_scariness=1:dedup_token_length=3"
IN="$(cd "$(dirname "$POC")" && pwd)/$(basename "$POC")"
{ echo "commit=$(git rev-parse --short HEAD)"; uname -m; docker version --format 'client {{.Client.Version}} server {{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}'; docker image inspect --format '{{.Os}}/{{.Architecture}}' "$VUL" "$FIX"; } > "$OUT/env.txt" 2>&1
run() { # label image n
  local s e; s=$(date +%s.%N)
  docker run --rm --pull never --network none --read-only --tmpfs /tmp:rw,size=16m --user 1000:1000 \
    --cpus 1 --memory 1g --memory-swap 1g --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
    -e "ASAN_OPTIONS=$AO" --mount "type=bind,src=$IN,dst=/in/input,readonly" \
    --entrypoint "$H" "$2" /in/input > "$OUT/$1.txt" 2>&1
  local rc=$?; e=$(date +%s.%N)
  printf '%s exit=%s seconds=%.2f\n' "$1" "$rc" "$(echo "$e - $s" | bc)"
}
{ for n in 1 2 3; do run "vul_run$n" "$VUL"; done; run "fix_control" "$FIX"; } | tee "$OUT/summary.txt"
s=$(date +%s.%N); VERDICT=$(python3 -I verifier/verify.py "$POC" --case "$CASE"); e=$(date +%s.%N)
printf 'verify.py: %s\nverify.py seconds=%.2f\n' "$VERDICT" "$(echo "$e - $s" | bc)" | tee -a "$OUT/summary.txt"
echo "full ASan trace (vul_run1):"; cat "$OUT/vul_run1.txt"
