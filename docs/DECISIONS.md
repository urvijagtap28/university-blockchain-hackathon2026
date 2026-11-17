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

This table comes from ARVO metadata. We have run the six cases in `ucl_parser.c`, `ucl_util.c` and `ucl_hash.c` (results below). The four bundled-header cases have not been run.

## Image details: case 42482847 (verified by running, 2026-11-16)
- Bug: heap-buffer-overflow READ 1 in `ucl_lex_json_string` (src/ucl_parser.c:1036). ARVO metadata gives fix commit `ac8d76023386fb1f1b31b47cd294e28831929c96`, but the fix image is NOT built from that commit (see "Source revisions inside the images").
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
  --entrypoint /out/ucl_add_string_fuzzer n132/arvo:<id>-vul /in/input
# (input path only; see Lessons below. Step 4 originally also passed -runs=1 -timeout=25 -rss_limit_mb=900, which works for libFuzzer builds only)
```
Results (`harness/arvo_mount_test.py`, Docker called from Python with absolute Windows paths):

| Image | arvo_42482847.poc | harmless.ucl |
|---|---|---|
| vul | heap-buffer-overflow, frames #0-#3 in src/ucl_parser.c, exit 1 | clean, exit 0 |
| fix | clean, exit 0 | clean, exit 0 |

Each run took 0.3-0.5 s.

**Windows note:** call Docker from Python using absolute Windows paths (`os.path.abspath`) for `-v`. When running from Git Bash, set `MSYS_NO_PATHCONV=1`, or Git Bash rewrites container paths such as `/in/input`.

## Six libucl cases verified (2026-11-16, `python -I harness/arvo_case_check.py <ids>`)
For each case: vul image 3 runs on the ARVO input, fix image 1 run on the ARVO input, and the harmless input on both. All runs use the sandbox flags with the input host-mounted read-only. The ARVO inputs are in `targets/libucl/inputs/arvo_<id>.poc`.

| ARVO id | Engine | Input | vul 3/3 | Top library frame | Lib frames | fix (ARVO input) | harmless (both) |
|---|---|---|---|---|---|---|---|
| 42482847 | libFuzzer | 2 B | heap-buffer-overflow x3 | ucl_lex_json_string src/ucl_parser.c:1036 | 4 | clean | clean |
| 42482848 | libFuzzer | 36 B | heap-buffer-overflow x3 | ucl_parse_value src/ucl_parser.c:1811 | 3 | clean | clean |
| 42486194 | honggfuzz | 4385 B | heap-buffer-overflow x3 (WRITE) | ucl_expand_variable src/ucl_parser.c:550 | 16 | clean | clean |
| 42490132 | libFuzzer | 36 B | heap-buffer-overflow x3 | ucl_strnstr src/ucl_util.c:2183 | 8 | clean | clean |
| 42497487 | libFuzzer | 14 B | heap-buffer-overflow x3 | ucl_check_variable src/ucl_parser.c:376 | 7 | clean | clean |
| 42512369 | AFL++ driver | 2421 B | heap-buffer-overflow x3 | ucl_hash_search src/ucl_hash.c:460 | 16 | clean | clean |

Each run took 0.4-0.8 s. Every image's `/bin/arvo` runs `/out/ucl_add_string_fuzzer /tmp/poc`.

### Lessons for verify.py (found by running)
- **Images use different fuzzing engines** (libFuzzer, honggfuzz, AFL++ driver). Pass **only the input path** to the harness. libFuzzer flags such as `-runs=1` make the AFL++ driver treat them as a file name and then block on stdin. That caused a 60 s hang on the 42512369 fix image, including on the harmless input.
- **The timeout must kill the container.** When Python's timeout kills the `docker run` client, the container keeps running (two were left running in our test). Give each run a `--name` and call `docker kill <name>` on timeout.
- **Keep `detect_leaks=0` in ASAN_OPTIONS.** Without it, the 42512369 fix image reports a memory leak on ARVO's input (exit 1) instead of a clean run.

### Image digests
| Image | Digest | Size |
|---|---|---|
| 42482847-vul | sha256:76a841ce67b750f5abf59477c391f1701384a5f1f84053f4ac5afb112a199483 | 3.55 GB |
| 42482847-fix | sha256:02a979ebbb0d5dab1455d079a993baebee8119ea210ea75622afd31e60e63d3d | 2.49 GB |
| 42482848-vul | sha256:bc75b21c84cd03a4b867c951e283abc6f6849401532b3642c6012d917ffbaa41 | 3.55 GB |
| 42482848-fix | sha256:c2169c93c34b7f972e4f325a7a3ae05df6880d0c8962564d5128f142542aeec4 | 2.49 GB |
| 42486194-vul | sha256:1800ba425bd254ccebde4cc8b2e748406b63d77cf90dbc4f959bbc881bde139a | 5.47 GB |
| 42486194-fix | sha256:c2066575b7747d53094c18cf2182a1eeea7afbeaa8bf2e5b9cdf5f0ebd24760b | 2.49 GB |
| 42490132-vul | sha256:c30ee80e83fb4a10a06b69acb5aca29e4b2415499ad14b2eccae648a786e392b | 5.8 GB |
| 42490132-fix | sha256:25b13d6b8782dd67acbfa7527e23a719a2847c325abb81652db4aaa14235f5a1 | 3.21 GB |
| 42497487-vul | sha256:2d9b57607673d38c1f6a72338eedeca9982130ccaeb80e910b61054a00ae8971 | 3.84 GB |
| 42497487-fix | sha256:314ce81bd1d9121e2248dab27edc885fb85cad61dc67059a51d4490f245d2642 | 2.49 GB |
| 42512369-vul | sha256:ecd56c3bcfb1f1b4dc1ae56c4925d25ed887739bd65326e40be0199b04387e91 | 3.9 GB |
| 42512369-fix | sha256:1d1b91a469051ea80639cf8e8f098cd5b83ab376a034dcba3541cdb74ac58bae | 2.85 GB |

Docker reports 29.75 GB for all images (sizes above overlap through shared layers). C: free went from 271 GB to 243 GB.

### Source revisions inside the images (checked with `git log -1` in /src/libucl)
| Case | vul commit | fix commit |
|---|---|---|
| 42482847 | 875c251 (Merge PR #216) | 45997ad 2022-01-06 "Fix variables expansion" |
| 42482848 | 875c251 (same as 42482847) | 45997ad |
| 42486194 | ac5b370 2020-07-19 | 45997ad |
| 42490132 | 1de4f36 2020-11-02 | 45997ad |
| 42497487 | a2ea4ab 2021-03-14 | 45997ad |
| 42512369 | 95df30c 2021-08-23 | 8a0294f 2025-06-04 |

**What this means.** ARVO's fix image is a later libucl version in which the bug no longer reproduces, not the single fix commit from the metadata. Five of the six cases share one fixed version. So our control run shows that "this crash is gone in a later libucl", not that "this specific bug was fixed". This was confirmed by running: the ARVO inputs for 42482848, 42486194, 42490132 and 42497487 all give `reproduced` against the default case 42482847 (its vul build has those bugs too, and its fix build is clean on them). The README and the backtest must describe the control run this way.

## verify.py (real verifier, 2026-11-16)
`python verifier/verify.py <input_file> [--case <id>]` prints exactly one line of JSON `{"verdict", "detail"}`. The default case is 42482847, and only the six verified cases are accepted. The stub moved to `verifier/verify_stub.py` (it still emits `"stub": true`).
- Sandbox per run as in step 4, with `--pull never`, `--mount type=bind,...,readonly` from a private temp copy of the input (made after the size check), input path as the only harness argument, `detect_leaks=0`, and named containers that are `docker kill`ed on timeout.
- 60 s total cap measured from start (5 s kept back for the kill). The 64 KB limit (65536 B accepted, 65537 B rejected) is checked before any Docker call. Any exception or docker error gives `inconclusive`.
- Flow: 3 vul runs (stops early once outcomes differ). 3/3 clean gives `not_reproduced` (no fix run). 3/3 expected error with a library frame leads to the fix run: clean gives `reproduced`; a crash gives `inconclusive` (crash on both builds); anything else gives `inconclusive`.
- Test hook: env `VERIFY_CAP_SECONDS` can only lower the cap.
- Tests: `python -I verifier/test_verify.py` runs 18 tests, 18/18 PASS. Reproduced on all six cases; not_reproduced on harmless.ucl, 4 hand-made fakes (test-inputs/fake/) and a 65536 B input; inconclusive on the 42512369 input against the default case (real SEGV in ucl_hash.c 3/3, the wrong error type), 65537 B, missing file, unknown case, usage error, and timeout. No verify-* containers left after any test. A typical full verdict takes 2-3.5 s.

### Not verified yet
- An input that genuinely hangs the harness (the timeout test used a lowered cap, so the kill hit a container that was starting or running, not a real infinite loop).
- A "crash on both builds" result from a real input (none found yet).
- Mixed results across the 3 runs (every input so far gave identical results).
- Concurrency (the 1-2 concurrent run limit is the server's job and is not enforced in verify.py).
- The four bundled-header cases (42487344, 42495584, 42501732, 42501839).
- Timeout and kill path on a truly hanging input inside verify.py. Input over 64 KB.
- Cross-case behaviour (for example, case A's input on case B's images). That matters for the backtest, which has not been designed yet.

## 2026-11-16: Results apply only to these amd64 images
Every result in this repo (the case checks, verifier tests, backtest and timings) was produced on **linux/amd64** images, pinned by the digests in `verifier/cases.json`, on a Windows 11 x86_64 host (Docker Desktop 29.9.3, WSL2 kernel 6.18.58.1). We claim nothing for other architectures, emulated amd64 (for example Apple Silicon), other image digests, or rebuilt images. verify.py refuses images whose platform is not `linux/amd64`, and runs images only by digest.

## 2026-11-16: verify.py reads verifier/cases.json (Person A's conditions)
- Cases, digests, expected error type and confirmed library frames moved from code into `verifier/cases.json`. The values were generated from `docker image inspect` and `git rev-parse` inside each image, not typed by hand.
- `--case` is validated (`^[0-9]{1,12}$`) before any lookup or Docker call. Contract changes and the case/digest logging proposal are in `docs/INTERFACES.md`; exact values for Person A are in `docs/SANDBOX_HANDOFF.md`.
