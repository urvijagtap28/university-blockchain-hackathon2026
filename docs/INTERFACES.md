# Interfaces

## Verifier (server calls verifier/verify.py)

### Current contract (implemented, 2026-11-16)
```
python verifier/verify.py <input_file> [--case <id>]
```
- stdout: exactly ONE line of JSON, `{"verdict": "...", "detail": "..."}`. There are no other keys and never a `"stub"` key.
- `verdict` is one of `reproduced`, `not_reproduced`, `inconclusive`. Exit code is always 0.
- `detail` is ASCII, at most about 300 chars, free text for humans. Do not parse it.
- Without `--case`, the case is `default_case` from `verifier/cases.json` (42482847).
- Money: `reproduced` and `inconclusive` mean settle $0; `not_reproduced` means settle $0.25.
- The stub is `verifier/verify_stub.py`. It has the same output plus `"stub": true`, and the server must refuse it outside test mode.

### Changes from the original CLAUDE.md contract (`python verify.py <input_file>`)
1. **Added optional `--case <id>`** (additive; calls without it behave as before against the default case).
2. **Case IDs are validated before anything else.** Anything not matching `^[0-9]{1,12}$` (empty, `../x`, `42;ls`, very long, non-ASCII digits, whitespace, newlines) gives `inconclusive` with detail `invalid case id '<escaped, truncated>': must be 1-12 digits`, without calling Docker. A well-formed ID not in cases.json gives `unknown case '<id>': not in cases.json`. `--case` with no value, or given twice, is a usage error (inconclusive).
3. **Cases, images and expected error types now live in `verifier/cases.json`.** verify.py runs images by `n132/arvo@sha256:<digest>` from that file and refuses (inconclusive, before Docker) any entry that is not a pinned digest, or a missing or unreadable file.
4. **Images must be `linux/amd64`**; any other platform gives inconclusive.

### Proposal: exposing the case ID and both digests for the verdict log (NOT implemented; for Person A to choose)
The stdout stays `{"verdict", "detail"}` as agreed.

**Option A (recommended, no change to verify.py).** The server already knows the case it passed: the `--case` value it sent, or `default_case` when it sent none. It reads that case's entry from `verifier/cases.json` and writes these fields into the signed verdict log:
- `case`
- `vul_image`, `fix_image` (the `@sha256` references)
- `vul_libucl_commit`, `fix_libucl_commit`

verify.py refuses to run anything that is not in cases.json, so these are the images that ran. To make that link checkable, the log should also record `sha256(verifier/cases.json)` and `sha256(verifier/verify.py)`.

**Option B (if you want verify.py to state what it ran).** Add an optional `--meta-out <path>`. verify.py would write one JSON object to that file and leave stdout unchanged, for example: `{"case": "42482847", "vul_image": "n132/arvo@sha256:76a8...", "fix_image": "n132/arvo@sha256:02a9...", "vul_libucl_commit": "875c251...", "fix_libucl_commit": "45997ad...", "runs": ["crash", "crash", "crash", "clean"], "verify_sha256": "..."}`. This would be a contract change and would be recorded here before implementing it.

**Not recommended: adding keys to stdout.** It breaks the "exactly `{verdict, detail}`" check that both sides test against.
