Stub-verifier test inputs (for verifier/verify_stub.py). Hand-made fake reports for the real verifier are in fake/. Each file is 5 bytes (`test\n`) and has no real content.
The stub routes by FILENAME only: `real*` -> reproduced, `flaky*` -> inconclusive, else not_reproduced.
Replace with real reproducer inputs when the real verifier lands.
