# Build log

Commands and actual outputs, newest last.

## 2026-11-16 repo setup
- Env check: macOS 26.6 arm64; node v26.10.0; npm 11.19.1; python3 3.14.7; git 2.54.0.
- MISSING: docker (CLI absent, daemon down), pnpm, gh.
- Spike files imported from ~/upto-spike (logs, scripts, notes). `.keys/` NOT copied. Secret grep over imported files: no hits.

## 2026-11-16 18:19 ET smoke test: $0 settle on devnet (spike code, public RPC)
- Ran from ~/upto-spike/scratch/x402/examples/typescript: facilitator/upto (:4022), servers/upto/spike-server.ts (:4023), then scratch/run.sh smoke_zero 0 0.
- Client output: status 200, paymentStatus 'settled', amount '0', request 2.153s.
- Balances before and after identical: buyer USDC 19.361423, seller USDC 0.638577.
- Deposit tx (open, escrow 0.25): cg4eW131ZwxbUx2PtNyLNSnV5rZcbP572oudefLYTUPRChmBoDiXFPGDD2AGop1qBs3o2YfUNHWcS5hSGc176wA
- Settle tx ($0): 2BJgYDWZT7EWTfduwR4cGd7rt4JvJoGM37GRAbD1MzYejBMDBc2LGu79envuGNJ15KBzVmE3pNVqdxamJa9Hhhe7
  RPC getTransaction: err null, escrow 0.25 -> closed, buyer token acct 19.111423 -> 19.361423, seller +0, buyer SOL delta 0.
- Not verified: dedicated RPC (none configured; public RPC used, 429s possible).

## 2026-11-16 stub verifier tidy
- Moved verify.py -> verifier/verify.py, test inputs -> test-inputs/ (3 identical 5-byte files; stub routes on filename).
- Ran from verifier/: fake.bin -> not_reproduced; flaky.bin -> inconclusive; real_bug.bin -> reproduced; STUB_VERDICT=bogus -> inconclusive; missing file -> inconclusive. All output has "stub": true.
- Not verified: no server consumes this yet; the fail-closed check on stub:true is recorded in STATUS.md but not implemented.
- 2026-11-16: moved verifier/testdata/ -> test-inputs/ (stub reran: same three verdicts). Uncommitted; user commits.
- 2026-11-16: CLAUDE.md now states the verifier contract. User asked to stage, commit and push (one-off, overrides never-commit for this action).

## 2026-11-16 Person B, sandbox branch: ARVO step 1 (env check)
- Machine: Windows 11 Pro 10.0.26200 x86_64 (Git Bash/MINGW64), not the macOS box above.
- `docker --version` -> Docker version 29.9.3, build 5457199
- `docker info` -> server 29.9.3, OSType linux, x86_64, mem 16474603520, 22 CPUs (daemon up)
- `git --version` -> 2.49.0.windows.1; `python --version` -> 3.14.8 (`python3` is a Store alias, NOT available); node v24.21.0; npm 11.19.0; curl 8.12.1
- MISSING: pnpm, gh, jq (not needed for Person B work). Disk C: 277G free.

## 2026-11-16 Person B: ARVO step 2 (library shortlist)
- `git clone --depth 1 https://github.com/n132/ARVO.git` (scratchpad) -> HEAD bc2a373c6b32fb3d9e7f86c516b1844885dcec51. README: metadata lives in n132/ARVO-Meta releases.
- GitHub API releases of n132/ARVO-Meta -> v3.0.0 (2025-10-23) asset arvo.db, 162656256 bytes.
- Downloaded arvo.db (scratchpad, not committed) sha256 331184ca807c2f136f98dac9f1df94c893f4ee2fdf9329dca517ff88e72f97ce. Table `arvo`, 6138 rows.
- Gotcha: every row has reproduced=1, verified=0, patch_located=1, so those columns don't filter anything. The `language` column is per project: many C libraries (libexif, libplist, libxml2) are tagged c++.
- Filter: sanitizer='asan' AND crash_type in Heap/Stack/Global-buffer-overflow, Heap-use-after-free, Heap-double-free. Counts: libucl 10, libplist 9, libexif 8, libspng 5, md4c 3 (plus large libs excluded as not small: libxml2 71, libredwg 71, gpac 58, ...).
- libucl (ucl_add_string_fuzzer; github.com/vstakhov/libucl): 42482847 HBO R1 ucl_lex_json_string ucl_parser.c:1036; 42482848 HBO R1 ucl_parse_value ucl_parser.c:1811; 42486194 HBO W1 ucl_expand_variable ucl_parser.c:550; 42487344 HBO R7 utstring_printf_va utstring.h:132; 42490132 HBO R1 ucl_strnstr ucl_util.c:2183; 42495584 HBO R6 utstring.h:132; 42497487 HBO R1 ucl_check_variable ucl_parser.c:376; 42501732 / 42501839 HBO R8 _mum_hash_aligned mum.h:230; 42512369 HBO R1 ucl_hash_search ucl_hash.c:460.
- libexif (exif_loader_fuzzer / exif_from_data_fuzzer): 42500216, 42500228, 42500232, 42500238, 42500614, 42500626, 42503996, 42510992; all HBO READ in exif-mnote-data-apple.c / exif-utils.c / exif-data.c / exif-mnote-data-fuji.c.
- md4c (fuzz-mdhtml): 42493685 md_is_container_mark md4c.c:5659; 42493686 md_is_inline_link_spec md4c.c:2321; 42507297 md_decode_utf8__ md4c.c:817; all HBO READ 1.
- Runner-up not shortlisted: libplist (9: jplist.c / oplist.c / plist.c, two fuzzers).

## 2026-11-16 Person B: step 3 (libucl 42482847 vul/fix via ARVO)
- Team chose libucl. Rule: frames under /src/libucl/ (incl. bundled utstring.h, mum.h) count as library code; harness tests/fuzzers/ does not.
- `docker pull n132/arvo:42482847-vul` / `-fix` -> vul 76a841ce67b7 3.55GB (digest sha256:76a841ce67b750f5abf59477c391f1701384a5f1f84053f4ac5afb112a199483); fix 02a979ebbb0d 2.49GB (sha256:02a979ebbb0d5dab1455d079a993baebee8119ea210ea75622afd31e60e63d3d). Cmd `sleep infinity`, user root, amd64.
- `MSYS_NO_PATHCONV=1 docker run --rm n132/arvo:42482847-vul arvo` -> exit 1; `ERROR: AddressSanitizer: heap-buffer-overflow`; #0 ucl_lex_json_string /src/libucl/src/ucl_parser.c:1036:8, #1 ucl_parse_key ucl_parser.c:1375, #2 ucl_state_machine ucl_parser.c:2427, #3 ucl_parser_add_chunk_full ucl_parser.c:2947, #4 LLVMFuzzerTestOneInput tests/fuzzers/ucl_add_string_fuzzer.c:17.
- `docker run --rm n132/arvo:42482847-fix arvo` -> exit 0; `Executed /tmp/poc in 1 ms`, no ASan error.

## 2026-11-16 Person B: step 4 (run harness on our own mounted input)
- `cat /bin/arvo` (vul image) -> bash script: exports ASAN_OPTIONS, then `/out/ucl_add_string_fuzzer /tmp/poc`. /out holds only ucl_add_string_fuzzer (uid 1000). /tmp/poc = 2 bytes `"\` (22 5c), sha256 386cf314...4431f.
- Copied the PoC out with `docker create` + `docker cp` -> targets/libucl/inputs/arvo_42482847.poc. Wrote harmless input targets/libucl/inputs/harmless.ucl (47 bytes, valid UCL).
- `python -I harness/arvo_mount_test.py targets/libucl/inputs` (PowerShell; Docker via subprocess, absolute Windows path in -v; flags: --network none --read-only --tmpfs /tmp --user 1000:1000 --cpus 1 --memory 1g --pids-limit 64 --cap-drop ALL no-new-privileges; entrypoint /out/ucl_add_string_fuzzer -runs=1 /in/input):
  - vul <- arvo_42482847.poc: exit=1 0.5s, heap-buffer-overflow, frames ucl_lex_json_string ucl_parser.c:1036 / ucl_parse_key :1375 / ucl_state_machine :2427 / ucl_parser_add_chunk_full :2947; `Running: /in/input`
  - vul <- harmless.ucl: exit=0 0.4s, `Executed /in/input in 2 ms`
  - fix <- arvo_42482847.poc: exit=0 0.3s, `Executed /in/input in 2 ms`
  - fix <- harmless.ucl: exit=0 0.3s, `Executed /in/input in 3 ms`
- Ran twice (scratch copy, then repo copy): identical results. STEP 4 PASSES; no fallback needed.
- Not verified: other 9 libucl cases, 3x repeat logic, timeout on hanging input, 64 KB cap. Recorded in docs/DECISIONS.md.

## 2026-11-16 Person B: push + 5 more libucl cases
- First `git push -u origin sandbox` -> 403 (credential was GitHub user urvij28). User fixed the credential; `git fetch` then `git status -sb` -> `sandbox...origin/sandbox`, origin/sandbox = 8d300df.
- Disk before pulling: C: 271G free; Docker images 6.04GB; Docker disk image docker_data.vhdx 7.75GB (grows to about 1TB, shrinks only by manual compaction). Estimate 5 pairs <= 30GB -> fits.
- `docker pull -q` x10: all succeeded (6s-117s each). After: Docker images 29.75GB total, C: 243G free. Digests in docs/DECISIONS.md.
- New harness/arvo_case_check.py (extract /tmp/poc, 3x vul + 1x fix + harmless on both, sandbox flags, absolute Windows mount paths).
- First pass (libFuzzer flags `-runs=1 -timeout=25 -rss_limit_mb=900` + path): 42482847, 42482848, 42486194, 42490132, 42497487 PASS. 42512369: vul 3/3 HBO in ucl_hash.c:460, but fix image TIMEOUT 60s on both ARVO input and harmless.
- Diagnosis: `docker ps` showed 2 leftover 42512369-fix containers still running after the Python timeout (killed with `docker kill`). `docker run ... 42512369-fix arvo` -> "Reading 2421 bytes from /tmp/poc / Execution successful." exit 0 in 1s: the fix build uses the AFL++ driver (aflpp_driver.c), which treats `-runs=1` as a file and then waits on stdin. With only `/in/input`: harmless exit 0; ARVO input without detect_leaks=0 -> LeakSanitizer 2603 bytes leaked, exit 1.
- Fix to checker: pass only `/in/input`; `--name` each container plus `docker kill` on timeout; record the engine. 42486194 harness = honggfuzz ("Accepting input from '/in/input'").
- Rerun `python -I harness/arvo_case_check.py 42482847 42482848 42486194 42490132 42497487 42512369` -> SUMMARY all 6 PASS; vul 3/3 heap-buffer-overflow with library frames, fix clean, harmless clean on both; 0.4-0.8s per run; `docker ps` count after = 0.
