#!/usr/bin/env python3
"""TEST ONLY fake verifier for money-path tests (VERIFIER_PATH=server/test/fake_verifier.py, with ALLOW_STUB_VERIFIER=1).
Sleeps N seconds where N comes from the input FILENAME 'sleepN.bin' (the server's x-test-filename), then prints
a stub-flagged not_reproduced verdict. Not the real verifier."""
import json, os, re, sys, time
m = re.match(r"sleep(\d+)", os.path.basename(sys.argv[1]))
if m:
    time.sleep(int(m.group(1)))
print(json.dumps({"verdict": "not_reproduced", "detail": "fake_verifier after sleep", "stub": True}))
