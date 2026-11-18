"""End-to-end tests for verifier/verify.py (needs Docker and the ARVO images pulled).

usage: python -I verifier/test_verify.py [scratch_dir]
Runs verify.py as a subprocess, exactly as the server will, and checks for each test:
expected verdict, exactly one line of JSON on stdout with only "verdict" and "detail" keys,
and that no verify-* containers are left running afterwards.
"""
import json, os, shutil, subprocess, sys, tempfile, time

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


MALFORMED_CASES = [
    ("empty", ""),
    ("path traversal", "../x"),
    ("shell metacharacters", "42;ls"),
    ("very long (5000 digits)", "9" * 5000),
    ("very long (5000 chars, mixed)", "A/" * 2500),
    ("trailing space", "42482847 "),
    ("negative", "-1"),
    ("full-width unicode digits", "４２４８２８４７"),
    ("newline injection", "42482847\nls"),
]


def load_verify_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location("verify_under_test", VERIFY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def no_docker_tests(scratch):
    """In-process: malformed --case values and a tampered cases.json must give inconclusive
    and must NEVER call Docker. verify.docker is replaced with a trap that records calls."""
    mod = load_verify_module()
    calls = []
    mod.docker = lambda args, timeout: calls.append(args) or (_ for _ in ()).throw(AssertionError("docker called"))
    poc = os.path.join(INPUTS, "arvo_42482847.poc")
    ok = True

    def check(label, verdict, detail, want_in):
        nonlocal ok
        good = verdict == "inconclusive" and want_in in detail and not calls and len(detail) <= 300
        ok &= good
        print(f"[{'PASS' if good else 'FAIL'}] no-docker: {label}\n        inconclusive? {verdict} | detail: {detail}"
              f" | docker calls: {len(calls)}")

    for label, value in MALFORMED_CASES:
        v, d = mod.verify(poc, value, mod.Deadline(60))
        check(f"--case {label}", v, d, "invalid case id")
    v, d = mod.verify(poc, "999", mod.Deadline(60))
    check("--case 999 (well-formed, not in cases.json)", v, d, "not in cases.json")
    # Tampered config: a mutable tag instead of a pinned digest must be refused before Docker.
    bad = os.path.join(scratch, "cases_tampered.json")
    doc = json.load(open(os.path.join(HERE, "cases.json"), encoding="utf-8"))
    doc["cases"]["42482847"]["vul"]["image"] = "n132/arvo:42482847-vul"
    json.dump(doc, open(bad, "w", encoding="utf-8"))
    real = mod.CASES_FILE
    mod.CASES_FILE = bad
    v, d = mod.verify(poc, None, mod.Deadline(60))
    check("tampered cases.json (tag instead of digest)", v, d, "not a pinned n132/arvo digest")
    mod.CASES_FILE = os.path.join(scratch, "missing_cases.json")
    v, d = mod.verify(poc, None, mod.Deadline(60))
    check("missing cases.json", v, d, "verifier config error")
    mod.CASES_FILE = real
    # VERIFY_TMPDIR set to something that is not a directory: inconclusive, no Docker.
    os.environ["VERIFY_TMPDIR"] = os.path.join(scratch, "no_such_dir")
    try:
        v, d = mod.verify(poc, None, mod.Deadline(60))
    finally:
        del os.environ["VERIFY_TMPDIR"]
    check("VERIFY_TMPDIR not a directory", v, d, "VERIFY_TMPDIR is set but is not an existing directory")
    return ok


def fake_docker_tests(scratch):
    """In-process with a FAKE docker (no containers): VERIFY_TMPDIR staging location and cleanup,
    exit-137 handling in verdict mode and in --self-test, and the digest-only audit."""
    import re, types
    mod = load_verify_module()
    poc = os.path.join(INPUTS, "arvo_42482847.poc")
    seen = {"mounts": [], "images": []}
    run_rc = {"value": 0}

    def fake(args, timeout):
        if args[:2] == ["image", "inspect"]:
            seen["images"].append(args[-1])
            return types.SimpleNamespace(returncode=0, stdout="linux/amd64\n", stderr="")
        if args[0] == "run":
            src = [a for a in args if a.startswith("type=bind,src=")][0]
            path = src[len("type=bind,src="):].split(",dst=")[0]
            seen["mounts"].append((path, os.path.exists(path)))
            seen["images"].append(args[args.index("/in/input") - 1])
            return types.SimpleNamespace(returncode=run_rc["value"], stdout="", stderr="")
        raise AssertionError(f"unexpected docker call {args[:2]}")

    mod.docker = fake
    results = []

    def record(label, good, info):
        results.append(good)
        print(f"[{'PASS' if good else 'FAIL'}] fake-docker: {label}\n        {info}")

    # 1. VERIFY_TMPDIR: the bind-mount source must be inside it, exist during the run, and be removed after.
    vt = os.path.join(scratch, "verify_tmpdir_test")
    os.makedirs(vt, exist_ok=True)
    for f in os.listdir(vt):
        shutil.rmtree(os.path.join(vt, f), ignore_errors=True)
    os.environ["VERIFY_TMPDIR"] = vt
    try:
        v, d = mod.verify(poc, None, mod.Deadline(60))
    finally:
        del os.environ["VERIFY_TMPDIR"]
    inside = all(os.path.commonpath([os.path.abspath(vt), p]) == os.path.abspath(vt) and existed
                 for p, existed in seen["mounts"])
    record("VERIFY_TMPDIR staging location and cleanup",
           v == "not_reproduced" and len(seen["mounts"]) == 3 and inside and os.listdir(vt) == [],
           f"verdict={v}; {len(seen['mounts'])} mounts, all inside VERIFY_TMPDIR and present during run: {inside}; "
           f"VERIFY_TMPDIR empty afterwards: {os.listdir(vt) == []}; example src: {seen['mounts'][0][0] if seen['mounts'] else None}")
    # 2. Default (VERIFY_TMPDIR unset): staging stays under tempfile's default directory.
    seen["mounts"].clear()
    v, d = mod.verify(poc, None, mod.Deadline(60))
    default_root = os.path.abspath(tempfile.gettempdir())
    under_default = all(os.path.commonpath([default_root, p]) == default_root for p, _ in seen["mounts"])
    record("VERIFY_TMPDIR unset keeps tempfile default", v == "not_reproduced" and under_default,
           f"verdict={v}; all mounts under {default_root}: {under_default}")
    # 3. Exit 137 in verdict mode: inconclusive, named as a kill, never not_reproduced.
    run_rc["value"] = 137
    v, d = mod.verify(poc, None, mod.Deadline(60))
    record("exit 137 in verdict mode -> inconclusive", v == "inconclusive" and "exit 137" in d, f"{v}: {d}")
    # 4. Exit 137 in self-test: fail with 'environment cannot run the harness'.
    ok_, d = mod.self_test(mod.Deadline(60))
    record("exit 137 in --self-test -> environment failure", (not ok_) and "environment cannot run the harness" in d
           and "exit 137" in d, f"ok={ok_}: {d}")
    run_rc["value"] = 0
    ok_, d = mod.self_test(mod.Deadline(60))
    record("--self-test with clean runs -> pass", ok_, f"ok={ok_}: {d}")
    # 4b. Timeout path: `docker rm -f <name>` is ALWAYS attempted after `docker kill`, even when the kill
    #     fails (returns an error, or itself times out). Same container name; kill 3 s + rm 2 s = 5 s reserve.
    for mode in ("kill returns error", "kill times out"):
        calls = []
        def fake_to(args, timeout, mode=mode):
            calls.append((list(args), timeout))
            if args[0] == "run":
                raise subprocess.TimeoutExpired(args, timeout)
            if args[0] == "kill":
                if mode == "kill times out":
                    raise subprocess.TimeoutExpired(args, timeout)
                return types.SimpleNamespace(returncode=1, stdout="", stderr="Error response from daemon")
            return types.SimpleNamespace(returncode=0, stdout="", stderr="")
        mod.docker = fake_to
        rc, info = mod.docker_run("n132/arvo@sha256:" + "0" * 64, "/out/h", poc, mod.Deadline(60))
        name = calls[0][0][calls[0][0].index("--name") + 1]
        kinds = [c[0][0] for c in calls]
        rm = [c for c in calls if c[0][:2] == ["rm", "-f"]]
        good = (rc is None and info.endswith("container killed") and kinds == ["run", "kill", "rm"]
                and rm and rm[0][0] == ["rm", "-f", name] and rm[0][1] == 2
                and [c for c in calls if c[0][0] == "kill"][0][1] == mod.KILL_RESERVE_SECONDS - 2)
        record(f"timeout path: {mode} -> docker rm -f still called", good,
               f"calls={[(c[0][0], c[0][-1] if c[0][0] != 'run' else '...', c[1] if c[0][0] != 'run' else 'budget') for c in calls]}; "
               f"returned rc={rc!r}, info={info!r}")
    mod.docker = fake

    # 5. Digest-only audit: every image docker was asked about or ran, every cases.json image, and
    #    verify.py's source contain no tag-style reference.
    doc = json.load(open(os.path.join(HERE, "cases.json"), encoding="utf-8"))
    refs = [c[t]["image"] for c in doc["cases"].values() for t in ("vul", "fix")]
    digest = re.compile(r"^n132/arvo@sha256:[0-9a-f]{64}$")
    src = open(VERIFY, encoding="utf-8").read()
    good = (all(digest.match(r) for r in refs) and all(digest.match(r) for r in seen["images"])
            and "n132/arvo:" not in src and "n132/arvo:" not in json.dumps(doc))
    record("digest-only image references", good,
           f"cases.json refs={len(refs)} all digest; images used by verify.py in these tests={len(seen['images'])} "
           f"all digest; 'n132/arvo:' in verify.py: {'n132/arvo:' in src}; in cases.json: {'n132/arvo:' in json.dumps(doc)}")
    return all(results)


def main():
    sys.stdout.reconfigure(errors="backslashreplace")  # Windows console is cp1252
    scratch =sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="verify-test-")
    no_docker_ok = no_docker_tests(scratch)
    fake_ok = fake_docker_tests(scratch)
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
    tests.append(("inconclusive: --case with no value", [poc("42482847"), "--case"], "inconclusive", None))
    tests.append(("inconclusive: --case given twice", [poc("42482847"), "--case", "42482847", "--case", "42482848"],
                  "inconclusive", None))
    for label, value in MALFORMED_CASES:
        if "\n" in value:
            continue  # not passable as a Windows command-line argument; covered in-process above
        tests.append((f"inconclusive (CLI): --case {label}", [poc("42482847"), "--case", value], "inconclusive", None))
    tests.append(("inconclusive: timeout (VERIFY_CAP_SECONDS=6)", [poc("42482847")], "inconclusive",
                  {"VERIFY_CAP_SECONDS": "6"}))

    vt = os.path.join(scratch, "verify_tmpdir_e2e")
    os.makedirs(vt, exist_ok=True)
    tests.append(("reproduced: VERIFY_TMPDIR set (real Docker)", [poc("42482847")], "reproduced", {"VERIFY_TMPDIR": vt}))

    results = [run(*t) for t in tests]
    left_in_vt = os.listdir(vt)
    print(f"[{'PASS' if not left_in_vt else 'FAIL'}] VERIFY_TMPDIR left empty after real run: {left_in_vt}")
    results.append(not left_in_vt)

    # --self-test (real Docker): separate output shape, never a "verdict" key.
    t0 = time.time()
    p = subprocess.run([sys.executable, "-I", VERIFY, "--self-test"], capture_output=True, text=True, timeout=90)
    lines = p.stdout.splitlines()
    obj = json.loads(lines[0]) if len(lines) == 1 else {}
    good = (set(obj) == {"self_test", "detail"} and obj.get("self_test") == "pass" and p.returncode == 0
            and leftover_containers() == 0)
    print(f"[{'PASS' if good else 'FAIL'}] --self-test on this host ({time.time() - t0:.1f}s, exit {p.returncode})\n"
          f"        {lines[0] if lines else '<no stdout>'}")
    results.append(good)

    print(f"SUMMARY: {sum(results)}/{len(results)} end-to-end passed; "
          f"no-docker tests {'all passed' if no_docker_ok else 'FAILED'}; "
          f"fake-docker tests {'all passed' if fake_ok else 'FAILED'}")
    sys.exit(0 if all(results) and no_docker_ok and fake_ok else 1)


if __name__ == "__main__":
    main()
