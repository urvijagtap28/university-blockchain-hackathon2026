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

## 2026-11-16 Person B: real verify.py
- `git mv verifier/verify.py verifier/verify_stub.py` (stub still emits "stub": true). New verifier/verify.py: `python verify.py <input_file> [--case <id>]`, default case 42482847, one JSON line {verdict, detail}; input path only, named containers with docker kill on timeout, detect_leaks=0, 60 s total cap, 64 KB limit, --pull never, read-only bind mount of a temp copy.
- Hand-made fake reports in test-inputs/fake/ (asan-claim prose, config, 4096 random bytes, 3000 nested braces).
- `python -I verifier/test_verify.py <scratch>` first run: 17/17 PASS. reproduced on all 6 cases (2.5-8.5 s; the first run was slow while the image cache was cold); not_reproduced on harmless + 4 fakes + 65536 B; inconclusive on 65537 B, missing file, unknown case, no args, VERIFY_CAP_SECONDS=6 ("vul run2: run exceeded 0 s, container killed"); 0 leftover containers.
- Cross-case check (other cases' ARVO inputs against default 42482847): 42482848, 42486194, 42490132, 42497487 -> reproduced (crash at ucl_parse_value :1811, ucl_expand_variable :547, ucl_strnstr ucl_util.c:2181, ucl_check_variable :375; fixed build clean). 42512369 -> inconclusive (SEGV at kh_get_ucl_hash_caseless_node ucl_hash.c:230, 3/3). 42482847 input vs --case 42512369 -> not_reproduced.
- `git log -1` in /src/libucl of every image: fix images 42482847/48/86194/90132/97487 are all 45997ad (2022-01-06 "Fix variables expansion"); 42512369-fix is 8a0294f (2025-06-04). Vul: 875c251 (42482847 and 42482848 both), ac5b370, 1de4f36, a2ea4ab, 95df30c. So ARVO fix images are a later libucl version, not the metadata fix_commit (ac8d760 for 42482847). DECISIONS.md corrected.
- Added the 42512369-input-vs-default test (a real inconclusive) -> rerun 18/18 PASS, 2.0-3.4 s per full verdict.

## 2026-11-16 Person B: backtest
- Note: CLAUDE.md has no "Data and honest backtest" section; used its honesty rules (label hand-made, count reproduced / forfeited / wrongly forfeited / inconclusive / failures).
- Edge-case search (scratch cross_matrix.py, every ARVO input x every other case via verify.py, 30 pairs): no crash-on-both verdict, no mixed 3-run result. ARVO 42512369 input -> SEGV kh_get_ucl_hash_caseless_node ucl_hash.c:230 on all 5 older vul builds (inconclusive, wrong error type).
- Direct run of the 42512369 input on 42497487-fix (libucl 45997ad): heap-buffer-overflow at ucl_hash_search ucl_hash.c:460, 16 lib frames. So the 45997ad "fixed" build still has bug 42512369. A crash-on-both verdict still isn't reachable, because the vul builds SEGV first.
- Added fakes: hand_made_fake_near_miss.ucl (`"\"`), hand_made_fake_empty.bin (0 B), hand_made_fake_large_config.ucl (40322 B). Total fakes 7.
- backtest/run_backtest.py: committed c37ed4a, then f2af4bf (dirty check ignores RESULTS.md). `python -I backtest/run_backtest.py` run 3 times (b78879b+dirty, c37ed4a+dirty, f2af4bf clean); identical counts every time:
  - A real bugs, own case: 6 -> reproduced 6, not_reproduced 0, inconclusive 0, failures 0
  - B hand-made fakes, default case: 7 -> reproduced 0, not_reproduced 7, inconclusive 0, failures 0
  - C real bug inputs vs other case: 30 -> reproduced 17, not_reproduced 8, inconclusive 5, failures 0
  - wrongly forfeited real bugs (A) 0/6; fakes judged reproduced 0/7; 43 calls, 2.0-3.9 s each, 123-137 s total.

## 2026-11-16 Person B: handoff values + Person A's conditions
- `docker version`: client 29.9.3 windows/amd64, server 29.9.3 linux/amd64; `docker info`: kernel 6.18.58.1-microsoft-standard-WSL2, Docker Desktop, cgroup v2.
- Per image (12): `docker image inspect` RepoDigests and Os/Arch (all linux/amd64), and `git -C /src/libucl rev-parse HEAD` plus commit date. Values in docs/SANDBOX_HANDOFF.md and verifier/cases.json (generated by script from Docker, not typed).
- Harness source sha256 prefix ec9232480c806b16 identical in all 12 images; it calls ucl_parser_new(0) + ucl_parser_add_string(parser, data, size); size 0 returns early. The fix images' /out/ucl_add_string_fuzzer.options = `[libfuzzer] detect_leaks=0`.
- `docker run --pull never ... n132/arvo@sha256:76a8...` -> runs by digest OK.
- Lockdown checked inside a container: uid=1000, /src read-only, /tmp writable, only `lo`, CapEff 0, NoNewPrivs 1, memory.max 1073741824, pids.max 64, cpu.max 100000 100000. Image env: build vars only; grep key|token|secret|pass|cred|auth over all 12 images -> none.
- verify.py now reads verifier/cases.json (digest-pinned images, expected error, harness, platform), validates --case `^[0-9]{1,12}$` before any lookup/Docker, refuses non-digest entries and non-linux/amd64 images, renders untrusted strings with ascii() (first test run crashed printing full-width digits to the cp1252 console: a bug in the test's printing, fixed with stdout errors=backslashreplace). The missing-config detail no longer includes the host path.
- `python -I verifier/test_verify.py`: no-docker tests 12/12 PASS (9 malformed --case incl. empty, ../x, 42;ls, 5000 chars, unicode digits, newline; unknown 999; tampered cases.json; missing cases.json; 0 docker calls each) + end-to-end 31/31 PASS; exit 0; 0 leftover containers.
- `python -I harness/measure_timing.py 5`: per run n=120 min 0.51 / median 0.67 / max 0.92 s; reproduced verdict n=5 3.65-3.79 s (median 3.77); not_reproduced n=5 2.30-2.49 s (median 2.40).
- Docs: docs/SANDBOX_HANDOFF.md, docs/INTERFACES.md (contract changes + case/digest logging proposal, not implemented), DECISIONS.md (amd64-only note).
- Backtest rerun on 71b0cfd (verify.py sha256 8744de8b...): identical counts A 6/0/0/0, B 0/7/0/0, C 17/8/5/0, 0 failures; 2.0-3.8 s per call.
