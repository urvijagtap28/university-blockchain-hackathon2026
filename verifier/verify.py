#!/usr/bin/env python3
"""STUB verifier. Person B replaces this with the real one.

WARNING: routes on filename, so a sender can pick their own verdict. Output carries
"stub": true. The server MUST treat stub:true as an error (settle $0) outside tests.
Never deploy or demo-with-money using this file.

Contract (must stay identical in the real version):
  usage:  python verify.py <input_file>
  stdout: exactly ONE line of JSON, e.g. {"verdict": "reproduced", "detail": "..."}
  verdict is one of: reproduced, not_reproduced, inconclusive
"""
import json
import os
import sys

VALID = {"reproduced", "not_reproduced", "inconclusive"}


def decide(path):
    # 1. Force a verdict with an env var, handy for testing each money path:
    #    STUB_VERDICT=not_reproduced python verify.py somefile
    forced = os.environ.get("STUB_VERDICT")
    if forced:
        return forced, "forced by STUB_VERDICT"

    # 2. Otherwise decide from the file name, so a demo can mix verdicts.
    name = os.path.basename(path).lower()
    if "real" in name:
        return "reproduced", "stub: filename contains 'real'"
    if "flaky" in name:
        return "inconclusive", "stub: filename contains 'flaky'"
    return "not_reproduced", "stub: default"


def main():
    if len(sys.argv) != 2:
        verdict, detail = "inconclusive", "usage error: expected one argument"
    elif not os.path.isfile(sys.argv[1]):
        verdict, detail = "inconclusive", "input file not found"
    else:
        verdict, detail = decide(sys.argv[1])

    if verdict not in VALID:
        verdict, detail = "inconclusive", "invalid verdict value"

    print(json.dumps({"verdict": verdict, "detail": detail, "stub": True}))


if __name__ == "__main__":
    main()