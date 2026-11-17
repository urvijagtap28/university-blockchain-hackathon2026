# Decisions

## 2026-11-16: Use ARVO prebuilt images; target library is libucl

**Decision (team, Nov 16).** Use the ARVO dataset (github.com/n132/ARVO, metadata from n132/ARVO-Meta release v3.0.0 `arvo.db`) for prebuilt ASan vulnerable/fixed Docker images of OSS-Fuzz bugs. Target library: **libucl** (github.com/vstakhov/libucl), a small C config parser.

**Approved deviations from CLAUDE.md:**
1. We use libucl's OSS-Fuzz harness (`tests/fuzzers/ucl_add_string_fuzzer.c`, built into the image as `/out/ucl_add_string_fuzzer`) instead of writing our own harness. The README credits the ARVO and OSS-Fuzz harness authors.
2. We use one vulnerable/fixed image pair per bug (`n132/arvo:<id>-vul` / `-fix`) instead of one pinned commit.

Everything else in CLAUDE.md is unchanged, including the verifier contract (`python verify.py <input_file>` prints one JSON line; verdict is `reproduced`, `not_reproduced` or `inconclusive`).

**Library-code rule:** a stack frame counts as library code if its path is under `/src/libucl/` and is not `tests/fuzzers/`. libucl's bundled headers (`utstring.h`, `mum.h`) count, because they ship in libucl's repo. For the demo, prefer cases whose crash is in `ucl_parser.c`, `ucl_util.c` or `ucl_hash.c`.

**Why libucl** (shortlist was libucl 10, libexif 8, md4c 3): it has the most ASan memory-error cases through a single harness, the crashes are in parser code, and the inputs are readable text.

### libucl cases in ARVO (sanitizer=asan, memory-error crash types)
| ARVO id | Crash type | Top library frame |
|---|---|---|
| 42482847 | Heap-buffer-overflow READ 1 | ucl_lex_json_string ucl_parser.c:1036 |
| 42482848 | Heap-buffer-overflow READ 1 | ucl_parse_value ucl_parser.c:1811 |
| 42486194 | Heap-buffer-overflow WRITE 1 | ucl_expand_variable ucl_parser.c:550 |
| 42487344 | Heap-buffer-overflow READ 7 | utstring_printf_va utstring.h:132 (bundled header) |
| 42490132 | Heap-buffer-overflow READ 1 | ucl_strnstr ucl_util.c:2183 |
| 42495584 | Heap-buffer-overflow READ 6 | utstring_printf_va utstring.h:132 (bundled header) |
| 42497487 | Heap-buffer-overflow READ 1 | ucl_check_variable ucl_parser.c:376 |
| 42501732 | Heap-buffer-overflow READ 8 | _mum_hash_aligned mum.h:230 (bundled header) |
| 42501839 | Heap-buffer-overflow READ 8 | _mum_hash_aligned mum.h:230 (bundled header) |
| 42512369 | Heap-buffer-overflow READ 1 | ucl_hash_search ucl_hash.c:460 |

This table comes from ARVO metadata. Only 42482847 has been run by us so far.

## Image details: case 42482847 (verified by running, 2026-11-16)
- Bug: heap-buffer-overflow READ 1 in `ucl_lex_json_string` (src/ucl_parser.c:1036). Fix commit `ac8d76023386fb1f1b31b47cd294e28831929c96` (https://github.com/vstakhov/libucl/commit/ac8d76023386fb1f1b31b47cd294e28831929c96).
- `n132/arvo:42482847-vul`: digest `sha256:76a841ce67b750f5abf59477c391f1701384a5f1f84053f4ac5afb112a199483`, 3.55 GB.
- `n132/arvo:42482847-fix`: digest `sha256:02a979ebbb0d5dab1455d079a993baebee8119ea210ea75622afd31e60e63d3d`, 2.49 GB.
- Both images: amd64; default cmd `sleep infinity`; no user set (root); workdir `/src`.
- Harness binary: `/out/ucl_add_string_fuzzer` (libFuzzer and ASan, owned by uid 1000). Given a file argument, libFuzzer runs that one input and exits.
- ARVO's `/bin/arvo` is a bash script that exports `ASAN_OPTIONS` and runs `/out/ucl_add_string_fuzzer /tmp/poc`.
- ARVO's crashing input `/tmp/poc` is 2 bytes, `"\` (hex 22 5c), with sha256 386cf314bb05acdaaabdf4da1caf140167271a26bd08bf34c3a7427d4bc4431f. A copy is at `targets/libucl/inputs/arvo_42482847.poc`.

### How to run the harness on our own input (step 4 result)
Call the harness binary directly as the entrypoint, with the submission mounted read-only:
```
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=16m --user 1000:1000 \
  --cpus 1 --memory 1g --memory-swap 1g --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
  -e ASAN_OPTIONS=... -v <ABSOLUTE_HOST_PATH>:/in/input:ro \
  --entrypoint /out/ucl_add_string_fuzzer n132/arvo:<id>-vul -runs=1 -timeout=25 -rss_limit_mb=900 /in/input
```
Results (`harness/arvo_mount_test.py`, Docker called from Python with absolute Windows paths):

| Image | arvo_42482847.poc | harmless.ucl |
|---|---|---|
| vul | heap-buffer-overflow, frames #0-#3 in src/ucl_parser.c, exit 1 | clean, exit 0 |
| fix | clean, exit 0 | clean, exit 0 |

Each run took 0.3-0.5 s.

**Windows note:** call Docker from Python using absolute Windows paths (`os.path.abspath`) for `-v`. When running from Git Bash, set `MSYS_NO_PATHCONV=1`, or Git Bash rewrites container paths such as `/in/input`.

### Not verified yet
- The other 9 libucl cases (no images pulled).
- 3x repeat stability. Wall-clock timeout enforcement on a hanging input. Input over 64 KB.
- Whether `--read-only` breaks any other case.
