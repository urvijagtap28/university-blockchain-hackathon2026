"""Check ARVO libucl cases: extract each PoC, run it 3x on the vul image and 1x on the fix image
under sandbox flags (input host-mounted), plus a harmless control on both.

usage: python -I harness/arvo_case_check.py <id> [<id> ...]
Docker is called with absolute Windows host paths (works from PowerShell; no Git Bash path rewriting).
"""
import os, re, subprocess, sys, time, uuid

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INPUTS = os.path.join(REPO, "targets", "libucl", "inputs")
HARMLESS = os.path.join(INPUTS, "harmless.ucl")
ASAN = ("alloc_dealloc_mismatch=0:allocator_may_return_null=1:detect_leaks=0:"
        "detect_stack_use_after_return=1:fast_unwind_on_fatal=0:handle_abort=1:"
        "handle_segv=1:symbolize=1:print_scariness=1:dedup_token_length=3")
# Library code = under /src/libucl/ but not the fuzz harness (tests/). Bundled headers count.
LIB_FRAME = re.compile(r"#\d+ 0x[0-9a-f]+ in (\S+) (/src/libucl/(?!tests/)\S+)")


def harness_path(image):
    out = subprocess.run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "cat",
                          image, "/bin/arvo"], capture_output=True, text=True, timeout=60).stdout
    m = re.search(r"(/out/\S+) /tmp/poc", out)
    return m.group(1) if m else None


def extract_poc(image, dest):
    cid = subprocess.run(["docker", "create", image], capture_output=True, text=True, check=True).stdout.strip()
    try:
        subprocess.run(["docker", "cp", f"{cid}:/tmp/poc", dest], capture_output=True, check=True)
    finally:
        subprocess.run(["docker", "rm", cid], capture_output=True)


def run(image, harness, host_file):
    # Only the input path as argument: works for both libFuzzer and AFL++ driver builds
    # (the AFL++ driver treats libFuzzer flags like -runs=1 as a file and hangs on stdin).
    name = "arvo-check-" + uuid.uuid4().hex[:12]
    cmd = ["docker", "run", "--rm", "--name", name, "--network", "none", "--read-only",
           "--tmpfs", "/tmp:rw,size=16m", "--user", "1000:1000",
           "--cpus", "1", "--memory", "1g", "--memory-swap", "1g", "--pids-limit", "64",
           "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "-e", "ASAN_OPTIONS=" + ASAN, "-v", f"{os.path.abspath(host_file)}:/in/input:ro",
           "--entrypoint", harness, image, "/in/input"]
    t = time.time()
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        # Killing the docker CLI does not stop the container; kill it explicitly.
        subprocess.run(["docker", "kill", name], capture_output=True)
        return {"exit": "timeout", "err": None, "frames": [], "secs": 60.0}
    out = p.stdout + p.stderr
    m = re.search(r"ERROR: AddressSanitizer: (\S+)", out)
    eng = ("libfuzzer" if "INFO: Seed:" in out else "honggfuzz" if "honggfuzz" in out
           else "aflpp" if "Reading " in out or "aflpp_driver" in out else "?")
    return {"engine": eng, "exit": p.returncode, "err": m.group(1) if m else None,
            "frames": LIB_FRAME.findall(out), "secs": round(time.time() - t, 1)}


def fmt(r):
    top = f" top={r['frames'][0][0]} {r['frames'][0][1].replace('/src/libucl/', '')}" if r["frames"] else ""
    return f"engine={r.get('engine')} exit={r['exit']} asan={r['err']} libframes={len(r['frames'])}{top} {r['secs']}s"


def check(case):
    vul, fix = f"n132/arvo:{case}-vul", f"n132/arvo:{case}-fix"
    hv, hf = harness_path(vul), harness_path(fix)
    poc = os.path.join(INPUTS, f"arvo_{case}.poc")
    extract_poc(vul, poc)
    print(f"===== {case}  harness vul={hv} fix={hf}  poc={os.path.getsize(poc)} bytes")
    vruns = [run(vul, hv, poc) for _ in range(3)]
    for i, r in enumerate(vruns, 1):
        print(f"  vul poc run{i}: {fmt(r)}")
    fr = run(fix, hf, poc)
    print(f"  fix poc      : {fmt(fr)}")
    hvr, hfr = run(vul, hv, HARMLESS), run(fix, hf, HARMLESS)
    print(f"  vul harmless : {fmt(hvr)}")
    print(f"  fix harmless : {fmt(hfr)}")
    types = {r["err"] for r in vruns}
    ok = (len(types) == 1 and None not in types and all(r["frames"] for r in vruns)
          and fr["err"] is None and fr["exit"] == 0)
    clean_ctl = hvr["err"] is None and hfr["err"] is None and hvr["exit"] == 0 and hfr["exit"] == 0
    print(f"  RESULT: {'reproduced' if ok else 'NOT a clean reproduction'}; harmless control {'clean' if clean_ctl else 'NOT clean'}")
    return ok and clean_ctl


if __name__ == "__main__":
    results = {c: check(c) for c in sys.argv[1:]}
    print("SUMMARY:", " ".join(f"{c}={'PASS' if v else 'FAIL'}" for c, v in results.items()))
