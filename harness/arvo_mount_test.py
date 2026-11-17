"""Step 4 check: run the ARVO libucl harness on a host file mounted in, under sandbox flags."""
import os, re, subprocess, sys, time

ASAN = ("alloc_dealloc_mismatch=0:allocator_may_return_null=1:detect_leaks=0:"
        "detect_stack_use_after_return=1:fast_unwind_on_fatal=0:handle_abort=1:"
        "handle_segv=1:symbolize=1:print_scariness=1:dedup_token_length=3")

def run(image, host_file):
    host_file = os.path.abspath(host_file)  # absolute Windows path, e.g. C:\...\x.poc
    cmd = ["docker", "run", "--rm", "--network", "none", "--read-only",
           "--tmpfs", "/tmp:rw,size=16m", "--user", "1000:1000",
           "--cpus", "1", "--memory", "1g", "--memory-swap", "1g", "--pids-limit", "64",
           "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "-e", "ASAN_OPTIONS=" + ASAN,
           "-v", f"{host_file}:/in/input:ro",
           "--entrypoint", "/out/ucl_add_string_fuzzer",
           image, "-runs=1", "-timeout=25", "-rss_limit_mb=900", "/in/input"]
    t = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    dt = time.time() - t
    out = p.stdout + p.stderr
    err = re.search(r"ERROR: AddressSanitizer: (\S+)", out)
    frames = re.findall(r"#\d+ 0x[0-9a-f]+ in (\S+) (/src/libucl/\S+)", out)
    print(f"--- {image} <- {os.path.basename(host_file)}  exit={p.returncode} {dt:.1f}s")
    print("    mount src:", host_file)
    print("    asan:", err.group(1) if err else None)
    for f in frames[:4]:
        print("    frame:", f[0], f[1])
    for line in out.splitlines():
        if line.startswith(("Running:", "Executed", "SUMMARY")):
            print("    " + line)

if __name__ == "__main__":  # usage: python harness/arvo_mount_test.py targets/libucl/inputs
    d = sys.argv[1]
    for img in ("n132/arvo:42482847-vul", "n132/arvo:42482847-fix"):
        for f in ("arvo_42482847.poc", "harmless.ucl"):
            run(img, os.path.join(d, f))
