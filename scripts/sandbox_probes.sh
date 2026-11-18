#!/usr/bin/env bash
# QE_SANDBOX_SECURITY: benign probes of the verifier container's CONFIGURED limits.
# Run from the repo root (needs docker and python3). Usage: bash scripts/sandbox_probes.sh [case_id]
#
# What this is: it launches containers from the SAME vulnerable image with the SAME hardening flags
# that verifier/verify.py docker_run() builds (captured from the code at run time, not retyped),
# replacing only the entrypoint with bash, and checks that each configured restriction held.
# What this is NOT: an escape test. The sandbox is not claimed to be escape-proof. These probes are
# harmless: one connection attempt to 1.1.1.1:53, one DNS lookup, bounded process and memory use,
# no host file access, no privileged flags, no docker socket.
#
# Each probe prints PASS (restriction held), FAIL (it did not), or NOT-POSSIBLE (probe could not run;
# this is NOT a pass). Exit code 1 if any FAIL, 0 otherwise (check for NOT-POSSIBLE by eye).
# Results on a non-amd64 host (amd64 image under emulation) are NOT authoritative.
set -u
CASE="${1:-42482847}"
[ -f verifier/verify.py ] && [ -f verifier/cases.json ] || { echo "run from the repo root"; exit 2; }
command -v docker >/dev/null || { echo "docker not found"; exit 2; }
command -v python3 >/dev/null || { echo "python3 not found"; exit 2; }

RUNID="$(date +%s)-$$"
PFX="probe-${RUNID}"
FAILS=0; NPS=0; WARNS=0
SCRATCH_HOST="$(mktemp -d "${VERIFY_TMPDIR:-${TMPDIR:-/tmp}}/sandbox-probe.XXXXXX")" || exit 2
SCRATCH_HOST="$(cd "$SCRATCH_HOST" && pwd -P)"
INPUT="$SCRATCH_HOST/input"
printf 'probe-input-do-not-modify\n' > "$INPUT"
chmod 0444 "$INPUT"
SUM_BEFORE="$(python3 -I -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$INPUT")"

cleanup() {
  docker ps -aq --filter "name=${PFX}" 2>/dev/null | xargs docker rm -f >/dev/null 2>&1
  chmod -R u+w "$SCRATCH_HOST" 2>/dev/null; rm -rf "$SCRATCH_HOST"
}
trap cleanup EXIT

IMAGE="$(python3 -I -c "import json,sys;print(json.load(open('verifier/cases.json'))['cases'][sys.argv[1]]['vul']['image'])" "$CASE")" || exit 2

echo "== sandbox_probes.sh $(date -u +%FT%TZ) =="
echo "host: $(uname -sm); docker server arch: $(docker info --format '{{.Architecture}} {{.ServerVersion}}' 2>&1)"
echo "image: $IMAGE ($(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE" 2>&1))"
case "$(uname -m)" in x86_64|amd64) ;; *) echo "NOTE: non-amd64 host: amd64 image runs under emulation. Results are NOT authoritative."; esac

# --- derive the flags from verify.py itself (capture the argv docker_run would pass to docker) ---
FLAGS_RAW="$(python3 -I - "$IMAGE" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("verify_mod", "verifier/verify.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cap = []
class R:  # fake CompletedProcess
    returncode = 0; stdout = ""; stderr = ""
m.docker = lambda args, timeout: (cap.append(list(args)) or R())
m.docker_run("__IMAGE__", "__HARNESS__", "__INPUT__", m.Deadline(60))
a = cap[0]
if a[-4:] != ["--entrypoint", "__HARNESS__", "__IMAGE__", "/in/input"] or "--name" not in a:
    sys.stderr.write("verify.py docker_run() argv layout changed; update this script\n"); sys.exit(3)
a = a[:-4]
assert a[0] == "run"; a = a[1:]
i = a.index("--name"); del a[i:i + 2]          # replaced by a probe-specific name
for x in a:
    print(x)
PY
)" || { echo "could not derive flags from verify.py"; exit 2; }
FLAGS=()
while IFS= read -r line; do FLAGS+=("${line//__INPUT__/$INPUT}"); done <<< "$FLAGS_RAW"
echo "flags derived from verifier/verify.py docker_run() (after 'docker run'):"
printf '  %s\n' "${FLAGS[*]}"

# --- flag audit against the spec ---
echo; echo "-- P0 flag audit (derived flags vs spec)"
audit() { # label, regex-on-joined-flags
  if printf ' %s ' "${FLAGS[*]}" | grep -Eq -- "$2"; then echo "PASS  flag present: $1"; else echo "FAIL  flag MISSING: $1"; FAILS=$((FAILS+1)); fi
}
audit "--rm"                         ' --rm '
audit "--network none"               ' --network none '
audit "--read-only"                  ' --read-only '
audit "--tmpfs /tmp (scratch)"       ' --tmpfs /tmp:rw,size=[0-9]+[mMgG] '
audit "--user non-root"              ' --user [1-9][0-9]*:[1-9][0-9]* '
audit "--cpus"                       ' --cpus [0-9.]+ '
audit "--memory"                     ' --memory [0-9]+[mMgG] '
audit "--memory-swap"                ' --memory-swap [0-9]+[mMgG] '
audit "--pids-limit"                 ' --pids-limit [0-9]+ '
audit "--cap-drop ALL"               ' --cap-drop ALL '
audit "no-new-privileges"            ' --security-opt no-new-privileges '
audit "--pull never"                 ' --pull never '
audit "input mount readonly"         'dst=/in/input,readonly'
for bad in '--privileged' '--cap-add' '--network host' 'docker.sock' '--pid host' '--security-opt (seccomp|apparmor)=unconfined' '-v '; do
  if printf ' %s ' "${FLAGS[*]}" | grep -Eq -- "$bad"; then echo "FAIL  forbidden flag present: $bad"; FAILS=$((FAILS+1)); fi
done
echo "INFO  weaker/missing vs a maximal hardening (not in spec; see QE report): no --ulimit (fsize/nofile/core), /tmp tmpfs flags are docker defaults (probe (c) prints them), /dev/shm stays default writable 64m, default seccomp/apparmor profile only, no in-container timeout (wall clock is host-side + docker kill)"

# --- helper: run one probe script in a fresh hardened container ---
N=0
run_in_container() { # name, script ; sets OUT and RC
  N=$((N+1)); local name="${PFX}-$1"; shift
  OUT="$(docker run --name "$name" "${FLAGS[@]}" --entrypoint /bin/bash "$IMAGE" -c "$1" 2>&1)"; RC=$?
  OUT="$(printf '%s\n' "$OUT" | grep -v '^WARNING: The requested image.s platform')"
}
report() { # id, desc  (reads OUT for a final RESULT:<STATUS>:<evidence> line)
  local line st ev
  line="$(printf '%s\n' "$OUT" | grep -E '^RESULT:' | tail -1)"
  if [ -z "$line" ]; then st=FAIL; ev="no RESULT line; docker exit $RC; output tail: $(printf '%s' "$OUT" | tail -3 | tr '\n' '|')"
  else st="$(printf '%s' "$line" | cut -d: -f2)"; ev="$(printf '%s' "$line" | cut -d: -f3-)"; fi
  case "$st" in
    PASS) echo "PASS  $1 $2: $ev";;
    NP) echo "NOT-POSSIBLE  $1 $2: $ev"; NPS=$((NPS+1));;
    WARN) echo "WARN  $1 $2: $ev"; WARNS=$((WARNS+1));;
    *) echo "FAIL  $1 $2: $ev"; FAILS=$((FAILS+1));;
  esac
  printf '%s\n' "$OUT" | grep -vE '^RESULT:' | sed 's/^/        | /' | head -25
}

echo; echo "-- precheck: hardened container starts at all"
run_in_container precheck 'echo started'
if [ "$RC" != 0 ] || [ "$OUT" != started ]; then
  echo "ABORT  hardened container did not start (docker exit $RC): $(printf '%s' "$OUT" | tail -3 | tr '\n' '|')"
  echo "       (Colima/Docker Desktop on macOS only share certain paths: set VERIFY_TMPDIR to an existing directory under \$HOME and retry.)"
  exit 2
fi
echo "PASS  precheck: container started with the derived flags"

echo; echo "-- probes (each in its own fresh container)"

# (a) network
run_in_container net '
n_ok=0; n_err=""
if timeout 5 bash -c "exec 3<>/dev/tcp/1.1.1.1/53" 2>/tmp/e1; then n_ok=1; fi
echo "tcp 1.1.1.1:53 connect exit/err: ok=$n_ok err=$(tr "\n" " " </tmp/e1 | cut -c1-120)"
d_ok=0
if command -v getent >/dev/null; then
  if timeout 6 getent hosts example.com >/tmp/e2 2>&1; then d_ok=1; fi
  echo "dns example.com via getent: ok=$d_ok out=$(tr "\n" " " </tmp/e2 | cut -c1-120)"
else echo "getent not present"; d_ok=-1; fi
echo "interfaces: $(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d " " | tr "\n" " ")"
if [ "$n_ok" = 1 ] || [ "$d_ok" = 1 ]; then echo "RESULT:FAIL:network reachable (tcp ok=$n_ok dns ok=$d_ok)"
elif [ "$d_ok" = -1 ]; then echo "RESULT:NP:tcp blocked; no DNS tool in image"
else echo "RESULT:PASS:tcp connect and DNS lookup both failed; interfaces above"; fi'
report "(a)" "outbound network blocked"

# (b)+(c) writes
run_in_container write '
bad=""; for p in /probe_root_file /etc/probe_file /out/probe_file /usr/probe_file /root/probe_file /in/probe_file /src/probe_file; do
  if ( : > "$p" ) 2>/dev/null; then bad="$bad $p"; rm -f "$p"; fi; done
echo "root fs mount flags: $(awk '"'"'$5=="/"{print $6}'"'"' /proc/self/mountinfo | head -1)"
shm=no; if ( : > /dev/shm/probe_file ) 2>/dev/null; then shm=yes; rm -f /dev/shm/probe_file; fi
echo "writable outside scratch (should be empty):[$bad ]; /dev/shm writable=$shm"
if [ -n "$bad" ]; then echo "RESULT:FAIL:wrote to:$bad"
elif [ "$shm" = yes ]; then echo "RESULT:WARN:root FS, /etc, /out, /usr, /root, /in, /src all read-only; but /dev/shm (docker default 64m tmpfs) is writable. Not in spec; bounded by docker default"
else echo "RESULT:PASS:no write outside scratch"; fi'
report "(b)" "cannot write outside scratch"

run_in_container scratch '
if echo hello > /tmp/probe_ok 2>/dev/null && [ "$(cat /tmp/probe_ok)" = hello ]; then
  sz=$(df -k /tmp | tail -1 | tr -s " " | cut -d" " -f2); echo "/tmp size KiB: $sz; mount: $(awk '"'"'$5=="/tmp"{print $6}'"'"' /proc/self/mountinfo)"
  # bounded fill: try to write 40 MiB into the 16 MiB tmpfs; must stop at the size limit
  dd if=/dev/zero of=/tmp/fill bs=1M count=40 2>&1 | tail -2 | tr "\n" " "; echo
  used=$(du -sk /tmp | cut -f1)
  if [ "$used" -le 17000 ]; then echo "RESULT:PASS:scratch writable; fill stopped at ${used} KiB (cap 16384 KiB)"; else echo "RESULT:FAIL:scratch grew to ${used} KiB"; fi
else echo "RESULT:FAIL:cannot write to /tmp scratch"; fi'
report "(c)" "scratch writable and size-capped"

# (d) env and host visibility
run_in_container env '
names=$(env | cut -d= -f1 | sort | tr "\n" " "); echo "env var NAMES: $names"
sus=$(env | cut -d= -f1 | grep -Ei "SVM_|KEY|SECRET|TOKEN|PASSWORD|MNEMONIC|PRIVATE|RPC|WALLET|AWS_|CDP_" | tr "\n" " ")
extra=$(env | cut -d= -f1 | grep -vxE "ASAN_OPTIONS|PATH|HOME|HOSTNAME|PWD|SHLVL|_|OLDPWD|TERM" | tr "\n" " ")
echo "extra (image-owned, not secrets-looking) names: $extra"
vis=""; for p in /Users /home /host_mnt /mnt/c /repo /app /.env /keys /var/run/docker.sock /run/docker.sock /root/.config /root/.ssh; do
  [ -e "$p" ] && vis="$vis $p($(ls -A "$p" 2>/dev/null | head -3 | tr "\n" ","))"; done
echo "host-ish paths visible:[$vis ]"
echo "mount destinations: $(awk '"'"'{print $5}'"'"' /proc/self/mountinfo | tr "\n" " ")"
echo "/in contents: $(ls -A /in | tr "\n" " ")"
if [ -n "$sus" ]; then echo "RESULT:FAIL:secret-looking env names: $sus"
elif ! env | cut -d= -f1 | grep -qx ASAN_OPTIONS; then echo "RESULT:FAIL:ASAN_OPTIONS not set"
elif echo "$vis" | grep -qE "docker.sock|/Users|/host_mnt|/keys|/.env|\.ssh"; then echo "RESULT:FAIL:host paths visible:$vis"
elif [ -n "$(echo "$extra" | tr -d " ")" ] || [ "$(ls -A /in | tr -d "\n")" != input ]; then echo "RESULT:WARN:no secret-looking names and no host paths, but extra image env names/contents listed above"
else echo "RESULT:PASS:only ASAN_OPTIONS (+shell basics); no host paths; /in holds only input"; fi'
report "(d)" "no env secrets, no host paths"

# (e) identity and capabilities
run_in_container id '
u=$(id -u); g=$(id -g)
eff=$(awk '"'"'/^CapEff/{print $2}'"'"' /proc/self/status); bnd=$(awk '"'"'/^CapBnd/{print $2}'"'"' /proc/self/status)
inh=$(awk '"'"'/^CapInh/{print $2}'"'"' /proc/self/status); amb=$(awk '"'"'/^CapAmb/{print $2}'"'"' /proc/self/status)
nnp=$(awk '"'"'/^NoNewPrivs/{print $2}'"'"' /proc/self/status); seccomp=$(awk '"'"'/^Seccomp:/{print $2}'"'"' /proc/self/status)
echo "uid=$u gid=$g CapEff=$eff CapBnd=$bnd CapInh=$inh CapAmb=$amb NoNewPrivs=$nnp Seccomp=$seccomp"
z=0000000000000000
if [ "$u" = 0 ]; then echo "RESULT:FAIL:running as uid 0"
elif [ "$eff" != "$z" ] || [ "$bnd" != "$z" ]; then echo "RESULT:FAIL:capabilities not empty (eff=$eff bnd=$bnd)"
elif [ "$nnp" != 1 ]; then echo "RESULT:FAIL:NoNewPrivs=$nnp"
else echo "RESULT:PASS:uid $u, CapEff and CapBnd all zero, NoNewPrivs=1 (Seccomp=$seccomp; 2 = docker default filter)"; fi'
report "(e)" "non-root, no capabilities"

# (f) bounded process cap (limit read from the derived flags)
PIDS_LIMIT="$(printf '%s\n' "${FLAGS[@]}" | grep -A1 -x -- '--pids-limit' | tail -1)"
TRY=$((PIDS_LIMIT + 36))
run_in_container pids "
python3 - <<'PY'
import subprocess, time
limit=$PIDS_LIMIT; try_n=$TRY   # hard bound: never more than try_n attempts
procs=[]; fails=0; err=''
for i in range(try_n):
    try: procs.append(subprocess.Popen(['/bin/sleep','15']))
    except OSError as e: fails+=1; err=str(e)[:60]
for p in procs: p.kill()
for p in procs: p.wait()
print('attempted=%d started=%d failed=%d last_err=%s' % (try_n, len(procs), fails, err))
cur=''
for f in ('/sys/fs/cgroup/pids.max','/sys/fs/cgroup/pids/pids.max'):
    try: cur=open(f).read().strip(); print('cgroup '+f+'='+cur); break
    except Exception: pass
if len(procs) >= limit: print('RESULT:FAIL:started %d >= limit %d' % (len(procs), limit))
elif fails == 0: print('RESULT:FAIL:no fork failure')
else: print('RESULT:PASS:started %d of %d attempts, then fork refused (limit %d)' % (len(procs), try_n, limit))
PY"
report "(f)" "pids limit caps forks (bounded at limit+36 attempts)"
echo "        (fork-probe container cleanup is checked in (i))"

# (g) memory: bounded allocation, ceiling = 1.5x the configured limit, touches pages in 16 MiB steps
MEM_FLAG="$(printf '%s\n' "${FLAGS[@]}" | grep -A1 -x -- '--memory' | tail -1)"
case "$MEM_FLAG" in *[gG]) MEM_MIB=$(( ${MEM_FLAG%[gG]} * 1024 ));; *[mM]) MEM_MIB=${MEM_FLAG%[mM]};; *) MEM_MIB=1024;; esac
CEIL=$(( MEM_MIB * 3 / 2 ))
run_in_container mem "
exec python3 - <<'PY'
import sys
step=16; ceil=$CEIL; limit=$MEM_MIB
buf=[]; mib=0
while mib < ceil:
    buf.append(bytearray(b'\\x01') * (step*1024*1024)); mib+=step
    sys.stderr.write('%d\\n' % mib); sys.stderr.flush()
print('REACHED_CEILING %d MiB without being killed' % mib)
PY"
# the in-container python gets SIGKILLed by the OOM killer; judge from docker exit/out here
if printf '%s' "$OUT" | grep -q REACHED_CEILING; then
  echo "FAIL  (g) memory limit: allocated $CEIL MiB without kill (limit $MEM_MIB MiB)"; FAILS=$((FAILS+1))
else
  LAST="$(printf '%s\n' "$OUT" | grep -E '^[0-9]+$' | tail -1)"; LAST="${LAST:-0}"
  if [ "$RC" = 137 ] || printf '%s' "$OUT" | grep -qE 'Killed|MemoryError'; then
    echo "PASS  (g) memory limit: killed after touching ~${LAST} MiB (limit $MEM_MIB MiB, ceiling $CEIL MiB, docker exit $RC)"
  else echo "FAIL  (g) memory limit: stopped without OOM-kill evidence (docker exit $RC, last $LAST MiB)"; FAILS=$((FAILS+1)); fi
  printf '%s\n' "$OUT" | grep -vE '^[0-9]+$' | tail -4 | sed 's/^/        | /'
fi

# (h) input mount is read-only
run_in_container ro '
res=""
( echo x >> /in/input ) 2>/tmp/e1 && res="$res append-succeeded"
( : > /in/input ) 2>/tmp/e2 && res="$res truncate-succeeded"
rm -f /in/input 2>/tmp/e3 && res="$res delete-succeeded"
( mv /in/input /tmp/moved ) 2>/tmp/e4 && res="$res move-succeeded"
( : > /in/newfile ) 2>/tmp/e5 && res="$res create-succeeded"
echo "errors: $(cat /tmp/e1 /tmp/e3 2>/dev/null | tr "\n" " " | cut -c1-200)"
echo "mount options: $(awk '"'"'$5=="/in/input"{print $6}'"'"' /proc/self/mountinfo)"
echo "content still: $(cat /in/input 2>&1 | head -1)"
if [ -n "$res" ]; then echo "RESULT:FAIL:input modifiable:$res"; else echo "RESULT:PASS:append, truncate, delete, move, create in /in all refused"; fi'
report "(h)" "input mount read-only (container side)"
SUM_AFTER="$(python3 -I -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$INPUT" 2>&1)"
if [ -f "$INPUT" ] && [ "$SUM_BEFORE" = "$SUM_AFTER" ]; then echo "PASS  (h2) host copy of input unchanged (sha256 ${SUM_AFTER%????????????????????????????????????????????????????????})..."
else echo "FAIL  (h2) host copy of input changed or missing"; FAILS=$((FAILS+1)); fi

# (j) cgroup limits as seen from inside (corroborates flags actually applied by the daemon)
run_in_container cg '
r=""; for f in cpu.max memory.max memory.swap.max pids.max; do [ -r /sys/fs/cgroup/$f ] && r="$r $f=$(cat /sys/fs/cgroup/$f)"; done
if [ -z "$r" ]; then
  for f in cpu/cpu.cfs_quota_us cpu/cpu.cfs_period_us memory/memory.limit_in_bytes memory/memory.memsw.limit_in_bytes pids/pids.max; do [ -r /sys/fs/cgroup/$f ] && r="$r $f=$(cat /sys/fs/cgroup/$f)"; done; fi
echo "cgroup view:$r"
if [ -z "$r" ]; then echo "RESULT:NP:cgroup files not readable in container"
elif echo "$r" | grep -q "cpu.max=100000 100000" && echo "$r" | grep -q "memory.max=1073741824" && echo "$r" | grep -q "memory.swap.max=0" && echo "$r" | grep -q "pids.max=64"; then
  echo "RESULT:PASS:cpu 1.0, memory 1 GiB, swap 0 extra (memory-swap = memory), pids 64 (cgroup v2)"
else echo "RESULT:WARN:cgroup values did not match the v2 pattern checked (v1 host or different values); compare by eye"; fi'
report "(j)" "cgroup limits applied"

# (i) cleanup
echo; echo "-- cleanup"
LEFT="$(docker ps -a --filter "name=${PFX}" --format '{{.Names}} {{.Status}}')"
LEFT_V="$(docker ps -a --filter "name=verify-" --format '{{.Names}} {{.Status}}')"
if [ -z "$LEFT" ]; then echo "PASS  (i) no leftover probe containers ($N probe containers all removed by --rm)"
else echo "FAIL  (i) leftover probe containers: $LEFT"; FAILS=$((FAILS+1)); fi
[ -z "$LEFT_V" ] && echo "INFO  no verify-* containers present" || echo "WARN  verify-* containers present (not from this script): $LEFT_V"

echo; echo "== summary: FAIL=$FAILS NOT-POSSIBLE=$NPS WARN=$WARNS =="
case "$(uname -m)" in x86_64|amd64) echo "host arch amd64: results authoritative for the configured limits only (not an escape test)";; *) echo "host arch $(uname -m): emulated, NOT authoritative";; esac
[ "$FAILS" -eq 0 ]
