#!/usr/bin/env python3
"""Real verifier: runs a submitted input file against ARVO libucl ASan images in a sandbox.

Contract (fixed, shared with the stub and the server):
  usage:  python verify.py <input_file> [--case <arvo_id>]     (default case 42482847)
  stdout: exactly ONE line of JSON: {"verdict": "...", "detail": "..."}
          verdict is one of: reproduced, not_reproduced, inconclusive
  exit code is always 0; the verdict is in the JSON. No "stub" key is ever emitted.

Verdict rules (CLAUDE.md):
  reproduced     : 3/3 vulnerable runs show the case's expected ASan error type with at least
                   one stack frame in library source (/src/libucl/, not tests/), AND the
                   fixed-build control run is clean.
  not_reproduced : 3/3 vulnerable runs clean.
  inconclusive   : anything else (mixed, timeout, sandbox error, crash on both builds, bad input).

Sandbox per run: separate container, no network, read-only root FS + small tmpfs /tmp,
uid 1000, 1 CPU, 1 GB RAM, 64 pids, all capabilities dropped, no-new-privileges, no host env
passed through (the container sees only the image's own build variables, which hold no secrets,
plus ASAN_OPTIONS), input bind-mounted read-only. Images are referenced by the sha256 digests in
verifier/cases.json, must already be pulled, and must be linux/amd64; this script never pulls.
--case must be 1-12 digits and listed in cases.json; anything else is inconclusive before any
Docker call.

Lessons applied (docs/DECISIONS.md):
  1. The harness gets ONLY the input path (images use libFuzzer, honggfuzz or the AFL++ driver).
  2. Each container is named and is `docker kill`ed on timeout (killing the docker CLI is not enough).
  3. detect_leaks=0, so leaks never count as a crash.
Limits: 60 s wall clock for the whole call (the server enforces 60 s too), 64 KB input cap.

Test hook: env VERIFY_CAP_SECONDS can only LOWER the 60 s cap (used to test the timeout path).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

MAX_INPUT_BYTES = 64 * 1024
TOTAL_CAP_SECONDS = 60.0
VUL_RUNS = 3
KILL_RESERVE_SECONDS = 5.0  # time kept back so a timed-out container can still be killed

# Accepted cases, pinned image digests and expected error types live in cases.json next to this
# file (docs/SANDBOX_HANDOFF.md). Only cases listed there are accepted.
CASES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cases.json")
CASE_ID_RE = re.compile(r"^[0-9]{1,12}$")
IMAGE_RE = re.compile(r"^n132/arvo@sha256:[0-9a-f]{64}$")
HARNESS_RE = re.compile(r"^/out/[A-Za-z0-9_.-]+$")
ERROR_RE = re.compile(r"^[a-z-]+$")
PLATFORM = "linux/amd64"

ASAN_OPTIONS = ("alloc_dealloc_mismatch=0:allocator_may_return_null=1:detect_leaks=0:"
                "detect_stack_use_after_return=1:fast_unwind_on_fatal=0:handle_abort=1:"
                "handle_segv=1:symbolize=1:print_scariness=1:dedup_token_length=3")

ASAN_ERR = re.compile(r"ERROR: AddressSanitizer: ([A-Za-z0-9_-]+)")
ANY_SANITIZER = re.compile(r"ERROR: (Address|Leak|Memory|UndefinedBehavior)Sanitizer|runtime error:")
LIB_FRAME = re.compile(r"#\d+ 0x[0-9a-f]+ in (\S+) /src/libucl/(?!tests/)(\S+)")
DOCKER_ERROR_EXITS = {125, 126, 127}  # docker daemon / cannot exec / not found


class Deadline:
    def __init__(self, seconds):
        self.end = time.monotonic() + seconds

    def left(self):
        return self.end - time.monotonic()


def emit(verdict, detail):
    print(json.dumps({"verdict": verdict, "detail": detail}))


def docker(args, timeout):
    return subprocess.run(["docker"] + args, capture_output=True, text=True,
                          errors="replace", timeout=timeout)


def show(value, limit=32):
    """Safe, short rendering of an untrusted string for the detail field."""
    s = ascii(value)  # ASCII only: escapes non-ASCII and control characters
    return s if len(s) <= limit else f"{s[:limit]}... ({len(value)} chars)"


def load_cases():
    """Load and sanity-check cases.json. Raises ValueError on anything unexpected."""
    with open(CASES_FILE, encoding="utf-8") as f:
        doc = json.load(f)
    if not HARNESS_RE.match(doc.get("harness", "")):
        raise ValueError("cases.json: bad harness path")
    if doc.get("platform") != PLATFORM:
        raise ValueError("cases.json: platform must be " + PLATFORM)
    cases = doc.get("cases") or {}
    for cid, c in cases.items():
        if not CASE_ID_RE.match(cid) or not ERROR_RE.match(c.get("expected_error", "")):
            raise ValueError(f"cases.json: bad entry {show(cid)}")
        for t in ("vul", "fix"):
            if not IMAGE_RE.match(c.get(t, {}).get("image", "")):
                raise ValueError(f"cases.json: case {cid} {t} image is not a pinned n132/arvo digest")
    if doc.get("default_case") not in cases:
        raise ValueError("cases.json: default_case is not a listed case")
    return doc


def run_once(image, harness, input_path, expected, deadline):
    """Run the harness once. Returns (kind, info).
    kind: 'crash' (expected ASan error + library frame), 'clean', 'timeout', or 'other'."""
    budget = deadline.left() - KILL_RESERVE_SECONDS
    if budget <= 0:
        return "timeout", "no time left in the total time cap"
    name = "verify-" + uuid.uuid4().hex[:16]
    cmd = ["run", "--rm", "--name", name, "--pull", "never",
           "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,size=16m",
           "--user", "1000:1000", "--cpus", "1", "--memory", "1g", "--memory-swap", "1g",
           "--pids-limit", "64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
           "-e", "ASAN_OPTIONS=" + ASAN_OPTIONS,
           "--mount", f"type=bind,src={input_path},dst=/in/input,readonly",
           "--entrypoint", harness, image, "/in/input"]
    try:
        p = docker(cmd, timeout=budget)
    except subprocess.TimeoutExpired:
        try:
            docker(["kill", name], timeout=KILL_RESERVE_SECONDS)
        except subprocess.TimeoutExpired:
            pass
        return "timeout", f"run exceeded {budget:.0f} s, container killed"
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode in DOCKER_ERROR_EXITS and not ANY_SANITIZER.search(out):
        return "other", f"sandbox error (docker exit {p.returncode}): {out.strip()[-160:]}"
    err = ASAN_ERR.search(out)
    frames = LIB_FRAME.findall(out)
    if err and err.group(1) == expected and frames:
        fn, loc = frames[0]
        return "crash", f"{err.group(1)} at {fn} {loc}"
    if p.returncode == 0 and not ANY_SANITIZER.search(out):
        return "clean", "clean"
    if err:
        where = f" at {frames[0][0]} {frames[0][1]}" if frames else " with no library frame"
        return "other", f"{err.group(1)}{where}"
    if ANY_SANITIZER.search(out):
        return "other", "non-ASan sanitizer report"
    return "other", f"exit {p.returncode} without sanitizer report"


def image_platform(image, deadline):
    """Return 'os/arch' of a locally present image, or None if it is not present."""
    t = min(15.0, max(1.0, deadline.left() - KILL_RESERVE_SECONDS))
    p = docker(["image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", image], timeout=t)
    return p.stdout.strip() if p.returncode == 0 else None


def verify(input_file, case, deadline):
    # Validate the case id BEFORE anything else touches it (never reaches Docker if malformed).
    if case is not None and not CASE_ID_RE.match(case):
        return "inconclusive", f"invalid case id {show(case)}: must be 1-12 digits"
    try:
        cfg = load_cases()
    except OSError as e:  # no host paths in detail: it may end up in the verdict log
        return "inconclusive", f"verifier config error: cannot read cases.json ({type(e).__name__})"
    except ValueError as e:
        return "inconclusive", f"verifier config error: {e}"[:300]
    if case is None:
        case = cfg["default_case"]
    if case not in cfg["cases"]:
        return "inconclusive", f"unknown case {show(case)}: not in cases.json"
    if not os.path.isfile(input_file):
        return "inconclusive", "input file not found"
    size = os.path.getsize(input_file)
    if size > MAX_INPUT_BYTES:
        return "inconclusive", f"input is {size} bytes, over the {MAX_INPUT_BYTES} byte limit"
    entry = cfg["cases"][case]
    expected, harness = entry["expected_error"], cfg["harness"]
    vul, fix = entry["vul"]["image"], entry["fix"]["image"]
    for img in (vul, fix):
        plat = image_platform(img, deadline)
        if plat is None:
            return "inconclusive", f"sandbox error: image {img} not present locally"
        if plat != PLATFORM:
            return "inconclusive", f"sandbox error: image {img} is {plat}, verified only on {PLATFORM}"

    # Copy the input into a private scratch dir so the mount source is a plain file we control
    # (no symlinks, no odd characters in the path, no changes after the size check).
    scratch = tempfile.mkdtemp(prefix="verify-")
    try:
        staged = os.path.join(scratch, "input")
        with open(input_file, "rb") as src:
            data = src.read(MAX_INPUT_BYTES + 1)
        if len(data) > MAX_INPUT_BYTES:
            return "inconclusive", f"input over the {MAX_INPUT_BYTES} byte limit"
        with open(staged, "wb") as dst:
            dst.write(data)
        staged = os.path.abspath(staged)

        results = []
        for _ in range(VUL_RUNS):
            kind, info = run_once(vul, harness, staged, expected, deadline)
            results.append((kind, info))
            if kind != results[0][0]:  # mixed outcomes: no need to keep running
                break
        kinds = [k for k, _ in results]
        summary = "; ".join(f"vul run{i + 1}: {info}" for i, (_, info) in enumerate(results))
        tag = f"case {case}, {len(data)} B input"

        if kinds == ["clean"] * VUL_RUNS:
            return "not_reproduced", f"{tag}: vul 3/3 clean"
        if kinds != ["crash"] * VUL_RUNS:
            return "inconclusive", f"{tag}: {summary}"

        fkind, finfo = run_once(fix, harness, staged, expected, deadline)
        if fkind == "clean":
            return "reproduced", f"{tag}: vul 3/3 {results[0][1]}; fixed build clean"
        if fkind == "crash":
            return "inconclusive", f"{tag}: crashes on both builds (vul 3/3 {results[0][1]}; fix: {finfo})"
        return "inconclusive", f"{tag}: vul 3/3 {results[0][1]}; fixed-build control not clean ({finfo})"
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def parse_args(argv):
    args = argv[1:]
    case = None  # None -> default_case from cases.json
    if args.count("--case") > 1:
        return None, None
    if "--case" in args:
        i = args.index("--case")
        if i + 1 >= len(args):
            return None, None
        case = args[i + 1]
        del args[i:i + 2]
    if len(args) != 1:
        return None, None
    return args[0], case


def main():
    cap = TOTAL_CAP_SECONDS
    try:
        cap = min(cap, float(os.environ.get("VERIFY_CAP_SECONDS", cap)))
    except ValueError:
        pass
    deadline = Deadline(cap)
    input_file, case = parse_args(sys.argv)
    if input_file is None:
        emit("inconclusive", "usage: python verify.py <input_file> [--case <id>]")
        return
    try:
        verdict, detail = verify(input_file, case, deadline)
    except Exception as e:  # any failure is inconclusive, never a crash with no JSON
        verdict, detail = "inconclusive", f"verifier error: {type(e).__name__}: {e}"[:300]
    if verdict not in ("reproduced", "not_reproduced", "inconclusive"):
        verdict, detail = "inconclusive", "invalid verdict value"
    emit(verdict, detail)


if __name__ == "__main__":
    main()
