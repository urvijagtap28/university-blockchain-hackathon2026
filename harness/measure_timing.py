"""Measure per-run and per-verdict timing with the full verify.py lockdown.

usage: python -I harness/measure_timing.py [runs_per_cell]
Per run: verify.run_once() (one locked-down `docker run`, as verify.py does it) on each case's
vul and fix image, with the ARVO input and with harmless.ucl.
Per verdict: `python verify.py` as a subprocess (what the server calls), reproduced and not_reproduced.
"""
import importlib.util, json, os, statistics, subprocess, sys, time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERIFY = os.path.join(REPO, "verifier", "verify.py")
INPUTS = os.path.join(REPO, "targets", "libucl", "inputs")
N = int(sys.argv[1]) if len(sys.argv) > 1 else 5

spec = importlib.util.spec_from_file_location("verify_mod", VERIFY)
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
cfg = v.load_cases()


def stats(xs):
    return f"n={len(xs)} min={min(xs):.2f}s median={statistics.median(xs):.2f}s max={max(xs):.2f}s"


all_runs = []
for cid, c in cfg["cases"].items():
    for t in ("vul", "fix"):
        for label, f in (("arvo", f"arvo_{cid}.poc"), ("harmless", "harmless.ucl")):
            xs, kinds = [], set()
            for _ in range(N):
                t0 = time.monotonic()
                kind, _info = v.run_once(c[t]["image"], cfg["harness"], os.path.abspath(os.path.join(INPUTS, f)),
                                         c["expected_error"], v.Deadline(60))
                xs.append(time.monotonic() - t0)
                kinds.add(kind)
            all_runs += xs
            print(f"run  {cid} {t} {label:8s} {sorted(kinds)} {stats(xs)}", flush=True)
print(f"RUN ALL: {stats(all_runs)}")

for label, args, want in (("reproduced", [os.path.join(INPUTS, "arvo_42482847.poc")], "reproduced"),
                          ("not_reproduced", [os.path.join(INPUTS, "harmless.ucl")], "not_reproduced")):
    xs = []
    for _ in range(N):
        t0 = time.monotonic()
        out = subprocess.run([sys.executable, "-I", VERIFY] + args, capture_output=True, text=True).stdout
        xs.append(time.monotonic() - t0)
        assert json.loads(out)["verdict"] == want, out
    print(f"VERDICT {label} (default case): {stats(xs)}")
