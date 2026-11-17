"""End-to-end tests for verifier/verify.py (needs Docker and the ARVO images pulled).

usage: python -I verifier/test_verify.py [scratch_dir]
Runs verify.py as a subprocess, exactly as the server will, and checks for each test:
expected verdict, exactly one line of JSON on stdout with only "verdict" and "detail" keys,
and that no verify-* containers are left running afterwards.
"""
import json, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
VERIFY = os.path.join(HERE, "verify.py")
INPUTS = os.path.join(REPO, "targets", "libucl", "inputs")
FAKES = os.path.join(REPO, "test-inputs", "fake")
CASE_IDS = ["42482847", "42482848", "42486194", "42490132", "42497487", "42512369"]


def leftover_containers():
    out = subprocess.run(["docker", "ps", "-q", "--filter", "name=verify-"],
                         capture_output=True, text=True).stdout
    return len(out.split())


def run(label, args, expect, env=None):
    t = time.time()
    p = subprocess.run([sys.executable, "-I", VERIFY] + args, capture_output=True, text=True,
                       env={**os.environ, **(env or {})}, timeout=90)
    dt = time.time() - t
    lines = p.stdout.splitlines()
    problems = []
    try:
        obj = json.loads(lines[0]) if len(lines) == 1 else None
    except ValueError:
        obj = None
    if obj is None:
        problems.append(f"stdout is not exactly one JSON line: {p.stdout!r}")
    elif set(obj) != {"verdict", "detail"}:
        problems.append(f"unexpected keys {sorted(obj)}")
    elif obj["verdict"] != expect:
        problems.append(f"verdict {obj['verdict']} != expected {expect}")
    if p.returncode != 0:
        problems.append(f"exit code {p.returncode}")
    if dt > 61:
        problems.append(f"took {dt:.1f}s (> 60 s cap)")
    left = leftover_containers()
    if left:
        problems.append(f"{left} verify-* containers still running")
    status = "PASS" if not problems else "FAIL"
    print(f"[{status}] {label} ({dt:.1f}s)\n        {lines[0] if lines else '<no stdout>'}")
    for pr in problems:
        print("        !!", pr)
    return not problems


def main():
    scratch = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="verify-test-")
    oversize = os.path.join(scratch, "oversize_65537.bin")
    exact = os.path.join(scratch, "exact_65536.ucl")
    with open(oversize, "wb") as f:
        f.write(b"\0" * 65537)
    with open(exact, "wb") as f:
        f.write(b" " * 65536)
    poc = lambda c: os.path.join(INPUTS, f"arvo_{c}.poc")

    tests = []
    # reproduced: ARVO's own crashing input for each verified case
    tests.append(("reproduced: default case, ARVO input 42482847", [poc("42482847")], "reproduced", None))
    for c in CASE_IDS[1:]:
        tests.append((f"reproduced: --case {c}, ARVO input", [poc(c), "--case", c], "reproduced", None))
    # not_reproduced: harmless input and hand-made fakes against the default case
    tests.append(("not_reproduced: harmless.ucl", [os.path.join(INPUTS, "harmless.ucl")], "not_reproduced", None))
    for name in sorted(os.listdir(FAKES)):
        if name.startswith("hand_made_fake"):
            tests.append((f"not_reproduced: {name} (hand-made fake)", [os.path.join(FAKES, name)], "not_reproduced", None))
    tests.append(("not_reproduced: exactly 65536 B (at the limit)", [exact], "not_reproduced", None))
    # inconclusive
    tests.append(("inconclusive: 42512369 input vs default case (real SEGV, wrong error type)",
                  [poc("42512369")], "inconclusive", None))
    tests.append(("inconclusive: 65537 B input (over limit)", [oversize], "inconclusive", None))
    tests.append(("inconclusive: missing file", [os.path.join(scratch, "nope.bin")], "inconclusive", None))
    tests.append(("inconclusive: unknown case", [poc("42482847"), "--case", "999"], "inconclusive", None))
    tests.append(("inconclusive: usage error (no args)", [], "inconclusive", None))
    tests.append(("inconclusive: timeout (VERIFY_CAP_SECONDS=6)", [poc("42482847")], "inconclusive",
                  {"VERIFY_CAP_SECONDS": "6"}))

    results = [run(*t) for t in tests]
    print(f"SUMMARY: {sum(results)}/{len(results)} passed")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
