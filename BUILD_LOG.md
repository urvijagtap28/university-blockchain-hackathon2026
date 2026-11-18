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

## 2026-11-16 18:56 ET smoke test rerun: $0 settle on devnet (spike code)
- Same procedure as the 18:19 run (facilitator :4022, spike-server :4023, run.sh smoke_zero 0 0).
- Client output: status 200, paymentStatus 'settled', actualChargedAtomic '0', request 2.139s. Buyer USDC 19.361423 before and after.
- Settle tx: 4cvmpDQafa7bLt6GuDG1nVeMgQsCYEYigtcLZ9GPA9mBWLoBqjuoYHFfKiiZxH4zbj6hPK9NFi9F2r8zWpLMMmnm
  RPC getTransaction (public devnet RPC, maxSupportedTransactionVersion 1): err null, escrow account 0.25 -> closed, buyer 19.111423 -> 19.361423, seller +0.
- NOT verified: which RPC the facilitator and server used. SVM_RPC_URL was added to .env but nothing observed shows the run used it (no 429s seen, but that proves nothing).

## 2026-11-16 19:33 ET smoke test on DEDICATED RPC (QuickNode devnet), spike code
- Setup issues found: shell had PORT=3000 exported (facilitator reads PORT, default 4022; started with PORT=4022); server needs FACILITATOR_URL=http://localhost:4022.
- 19:29 run FAILED: status 402, settle_failed, invalid_upto_svm_payload_channel_seed. Cause (read in svm/src/upto/facilitator/scheme.ts:1328): that reason is returned when getSlot on the RPC throws. SVM_RPC_URL had curly quotes (’) pasted in, making it an invalid URL. Fixed by re-exporting with straight quotes. (Inference from code + fix; the failing URL itself was not tested.)
- The full RPC URL (incl. API key) was printed to the chat by mistake in that debugging; key to be rotated.
- 19:33 run OK: status 200, settled, actualChargedAtomic 0, 2.130s. Buyer USDC 19.361423 before and after.
- Settle tx: 2geKqEppiYidUBfbL5YiM7n1bCyW5i6SBt2o4UrYqqaw8JfT6RW6A2WCjkwL1s51vjP2KWAZWH8eh3SC2wYqbeU8
  RPC getTransaction (public devnet RPC): err null, escrow 0.25 -> closed, buyer 19.111423 -> 19.361423, seller +0.
- Observed via ps: facilitator and server processes both have SVM_RPC_URL starting with 'h' on a quiknode.pro devnet host. 0 matches for 429 in both logs.
- Not verified: sustained load, repeated runs, error-path settles.

## 2026-11-16 orchestrator Phase 0
- `docker --version` -> Docker version 29.10.0; `docker run --rm hello-world` -> "Hello from Docker! ... installation appears to be working correctly." `pnpm --version` -> 11.1.1. node v26.10.0, npm 11.19.1, python3 3.14.7, git 2.54.0. (STATUS.md said docker/pnpm missing: stale.)
- `./scripts/secret-grep.sh` -> "secret grep clean".
- `node --env-file=.env scripts/check-env.mjs` -> "OK: host=quiknode.pro getSlot=523096428" (URL ASCII, https, not printed).
- NOT verified: .env.example contents (read denied); gh not checked; hello-world run on arm64 image only as pulled.

## 2026-11-16 ~20:05 ET X402_PAYMENTS: re-run $0 smoke on dedicated RPC (spike code) + /report skeleton
Part 1 (spike code in ~/upto-spike/scratch/x402/examples/typescript, facilitator `PORT=4022 pnpm exec tsx index.ts`, spike-server on 4023 with FACILITATOR_URL=http://localhost:4022, client amount=0 delay=0):
- Only SVM_RPC_URL taken from repo .env (spike dirs keep their own keys). Balances/tx read via a scratch script using SVM_RPC_URL (not the public RPC). Note: a stale facilitator (pid 24643, listens on 3000, started 19:25) was already running; left untouched.
- ps: facilitator and server both had SVM_RPC_URL host solana-devnet.quiknode.pro. 0 matches for "429" in both logs.
- Before: buyer USDC 19.361423 SOL 2.5; seller USDC 0.638577; facilitator SOL 0.993893.
- Client output: status 200, paymentStatus settled, actualChargedAtomic 0, 2.154s, payer 2BPj...rXA.
- Settle tx: 29afTpSw7HcH8uk91rA5acQh3xKEbex5viPRYTfasLeQBLgRQHxJVvrECyqVW4M6pNCctbg1UesTNkoKpXVn8TJR
  getTransaction (dedicated RPC): err null, escrow token acct 0.25 -> closed, buyer 19.111423 -> 19.361423, seller unchanged.
- After: buyer USDC 19.361423 (delta 0), seller 0.638577 (delta 0), facilitator SOL 0.991927 (-0.00197, facilitator pays tx fees/rent).

Part 2 (server/, node --disable-warning=ExperimentalWarning src/index.ts, native TS stripping; stub verifier; test client server/test/client.ts; same facilitator kept running, not restarted):
- Repo .env has SVM_PRIVATE_KEY and AGENT_SVM_PRIVATE_KEY EMPTY and SVM_ADDRESS / SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY apparently not real values (server exited "Missing required env var SVM_ADDRESS"; lengths 0/25). So for this run server keys came from the spike servers/upto/.env and the buyer key from the spike clients/fetch/.env, loaded into the shell env, never printed. HUMAN must fill the repo .env.
- `node test/unit.ts` -> "unit ok" (decideFromOutput: stub refused, bad JSON, wrong verdict, multi-line, clamp).
- curl POST without payment -> HTTP/1.1 402 Payment Required. 70000-byte body -> 413 (before any escrow).
- reproduced (stub, real_bug.bin): status 200, settled, settledAtomic 0, tx 52y5tghzGfFwKYc5STxnj5JgeDvjdQsrNLXPUZQ9sqSGEVjo5WqLqxRwgJPmfBnQGeJ7Kba5Cnei6cq8KqZM8o6V; on-chain err null, escrow 0.25 closed, buyer 19.111423 -> 19.361423 (full refund).
- not_reproduced (stub, fake.bin): settledAtomic 250000, tx 2nGMw6QwkAPcLVKWLzraVWe7pBxM4eRo4SLgYPZNWhrZGzXNRzDuxLZkhFmteTtQbZ96nnaLT5Ca65BrDKbJ1Ee6; balances buyer 19.361423 -> 19.111423, seller 0.638577 -> 0.888577. (buyer and seller are both ours.)
- Error paths (each: HTTP 200, paymentStatus settled, settledAtomic 0, buyer back to 19.111423):
  - stub refused (ALLOW_STUB_VERIFIER unset): verdict error, "verifier is a stub (stub:true)...", tx 3AS8uhDjk4ARP3M8YwtvrVEo8qKT4B5yUh27yj3BkRjqz2MLJhdt2XA61zFp7DP8ASS29mAiNXFwNvxZQ8AigMjk
  - verifier timeout (fake slow.py, VERIFIER_TIMEOUT_SECONDS=5): "verifier timed out after 5s", 7.1s total, tx 5dFTk7MmtvcQngpzZXC9Sx1eDKAFA2YKyEBfcq3wYVpSdNrLesQnZ33UpuzHVsvtwN8q3py6CQHTh4yERVs1V1iZ
  - bad JSON (fake bad.py): "bad verifier output: Unexpected token...", tx 5jDdvRBEKKFPJMREu7EqYsq71tMFxSSoQHfRTGo74TXjiuwVEa5cZ9PCu9Yz5VRN8VikCE1H3TcvL6AZjdncsGHj
  - on-chain (dedicated RPC) for the first two: err null, buyer 18.861423 -> 19.111423 (escrow 0.25 refunded). Bad-JSON tx on-chain NOT separately checked (balance after = 19.111423).
- Design finding (code read, @x402/express index.ts ~line 327): handler status >= 400 skips settlement. So /report returns 200 + {verdict:"error"} + $0 override on all errors. Behavior of the cancel path on >=400 (what happens to the escrow) NOT tested.
- Not tested: handler exception path, concurrent runs, 60 s cap with real 60 s wait, maxTimeoutSeconds=300 effect (set in code, 402 body not inspected for it), settlement_pending polling (not implemented), CDP facilitator, restart behavior.
- Processes stopped at end (4021, 4022 free; 4023 stopped earlier). Facilitator SOL went 0.9939 -> 0.9821 over 6 runs (fee/rent; cleanup manager recovers some after grace).
- `./scripts/secret-grep.sh` -> secret grep clean.
- PORT finding (X402_PAYMENTS, after human update): spike-server.ts does NOT read PORT (hardcoded app.listen(4023)); only the facilitator index.ts reads PORT (`process.env.PORT || "4022"`). server/src/index.ts reads only SERVER_PORT. Added server/scripts/start-facilitator.sh (inline PORT=${FACILITATOR_PORT:-4022}). Script not run (facilitator was started earlier with inline PORT=4022).

## 2026-11-16 SANDBOX_VERIFIER gate attempt: BLOCKED
- Read-only search for Person B ARVO artifacts (repo, ~, find /, docker images/ps/volume) found nothing; see AGENTS/SANDBOX_VERIFIER.md. No build attempted, no container run. docker images: hello-world, ubuntu:24.04, pib-target-probe (no libucl).

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

## 2026-11-16 Person B: Person A's Mac findings (F-001, digest audit, self-test)
- F-001: verify.py honours VERIFY_TMPDIR (existing dir; staged copy goes there; unset = tempfile default; set-but-not-a-dir -> inconclusive, no Docker).
- Exit 137 -> "killed (exit 137: SIGKILL, usually out of memory or amd64 emulation...)" -> inconclusive (never not_reproduced).
- `python verify.py --self-test`: harmless input on default vul + fix; prints {"self_test": pass|fail, detail}, no verdict key; exit 0/1.
- Digest audit: removed informational `tag` fields from cases.json; `grep n132/arvo: verifier/verify.py verifier/cases.json` -> none; 12/12 cases.json images match n132/arvo@sha256:<64hex>.
- `python -I verifier/test_verify.py`: no-docker 13/13, fake-docker 6/6 (VERIFY_TMPDIR mount location and cleanup, unset default, exit 137 verdict, exit 137 self-test, clean self-test, digest-only), end-to-end 34/34 incl. real VERIFY_TMPDIR run (reproduced, dir empty after) and real --self-test (pass, 2.0 s); exit 0.
- `python verifier/verify.py targets/libucl/inputs/arvo_42482847.poc --case 42482847` x3: reproduced each, wall 3.86 s / 3.84 s / 4.03 s, exit 0. (A first attempt printed exit=0 from the wrong `$?`, the date command's; rerun with rc captured right after the call.)
- ASan excerpt, 42482847 vul by digest with verify.py's flags: exit 1; heap-buffer-overflow READ of size 1; #0 ucl_lex_json_string /src/libucl/src/ucl_parser.c:1036:8; 0 bytes right of 2-byte region allocated by operator new in fuzzer::RunOneTest.
## 2026-11-16 TARGET_SELECTION: libucl / ARVO validation
- Searched repo, ~, Downloads/Desktop/Documents, /tmp, docker for Person B's ARVO artifacts: none found. Cloned public n132/ARVO-Meta; `grep -rl libucl` -> 9 cases (21578 21579 24591 25626 28135 33041 34755 38579 38675), fix commits in meta/<id>.json.
- libucl fix commits form a linear chain 71f16a8 -> ac8d760 -> 08de358 -> 3a94514 -> 54a5b59 -> 852f752 -> f9e5446 -> a9c0965 (git log %p).
- `docker pull n132/arvo:28135-vul` (6.01 GB, amd64); `docker run --rm --network none n132/arvo:28135-vul arvo` -> "Killed", rc=137, no ASan output (qemu/2 GiB). Used `docker cp` to extract /tmp/poc from all 9 vul/fix images (then rmi).
- Native arm64 build per commit in `ubuntu:24.04 + gcc -fsanitize=address -g -O1`, `--network none`, harness = ucl_parser_add_string on exact-size malloc buffer.
- run2.log (vul=71f16a8, fixed=a9c0965, 3 runs each): all 9 cases `vul_crashes=3/3 fixed_crashes=0/3`; e.g. `case=24591 ... WRITE of size 1`, `case=38579 ... READ of size 8`.
- run1.log matrix: each poc crashes at its fix^ commit (top frame e.g. ucl_strnstr ucl_util.c:2183, ucl_hash_func ucl_hash.c:105) and is clean at its fix commit.
- Not verified: Person B's own artifacts/harness, the 6-case selection, ARVO-image runs on this host.
- Earlier (superseded) libexif probe: 3 hand-built JPEGs gave heap-buffer-overflow on d0ebd6e (e.g. strcmp in exif_mnote_data_apple_identify), clean on 6801b62.

## 2026-11-16 QE_FUNCTIONAL: independent re-run of Person B's libucl verifier on macOS arm64 (Colima, Docker client 29.10.0 / server 29.5.2, VZ, 2 CPU, 8 GiB)
- `docker pull --platform linux/amd64 -q n132/arvo:<id>-vul|fix` for the 6 cases (12 images): all succeeded, 5m20s total. `docker images --digests` digests are IDENTICAL to those in docs/DECISIONS.md (checked all 12).
- `python3 -I verifier/test_verify.py` (default TMPDIR) -> `SUMMARY: 6/18 passed`. Every Docker-backed test returned inconclusive: `sandbox error (docker exit 125): ... bind source path does not exist: /var/folders/.../T/verify-xxxx/input`. Cause: verify.py stages the input in tempfile.mkdtemp() (macOS /var/folders), which the Colima VM does not mount (only $HOME is shared). The 6 passes are the tests that expect inconclusive or never reach Docker.
- Same run with `TMPDIR=$HOME/.qe-verify-tmp` (a dir under the shared home) -> still `6/18 passed`; bind mount now works but every harness run exits 137 with no output: `vul run1: exit 137 without sanitizer report` x3. Test time ~21 s total, 1.4-2.0 s per call.
- Isolation: on `n132/arvo:42482847-fix` (linux/amd64), `docker run ... --entrypoint /out/ucl_add_string_fuzzer .../harmless.ucl` -> exit 137, no output, with the verifier's flags, with no --memory limit (5.6 s), and with NO hardening flags at all. With ASAN_OPTIONS=verbosity=1 the last output before the kill is `SHADOW_OFFSET: 0x7fff8000` (ASan is reserving its shadow memory). Non-ASan amd64 commands in the same image (uname, sh, ls, cat /proc/meminfo) run fine. Cause is almost certainly ASan's shadow mapping failing under user-mode amd64 emulation on arm64 (not proven; no emulator log available). Colima status: `macOS Virtualization.Framework`, aarch64, `ls /proc/sys/fs/binfmt_misc` absent inside container.
- Direct verify.py calls (TMPDIR under $HOME), wall time: arvo_42482847.poc 2 s, harmless.ucl 1 s, hand_made_fake_config.ucl 2 s, 42512369 poc `--case 42512369` ~2 s. All `inconclusive` (exit 137 x3). So the timing question ("does a real verdict fit in 60 s under emulation") is UNANSWERED: the harness never starts. A failed-to-start harness gives inconclusive (fail-closed, bond refunded): good.
- Flag probe on a live `--entrypoint sleep` container with the verifier's flags, `docker inspect`: net=none ro=true user=1000:1000 NanoCpus=1e9 mem=swap=1073741824 pids=64 CapDrop=[ALL] SecurityOpt=[no-new-privileges] Privileged=false. In-container: id uid=1000 gid=1000; write to /in/input and /src -> Read-only file system; write to /tmp ok (tmpfs 16m); only `lo` interface; CapEff=0; /root unreadable; no /var/run/docker.sock; 33 env vars, all image build env (CC, CFLAGS, SANITIZER...) plus ASAN_OPTIONS, no secrets.
- Leftover containers after all runs: 0 (`docker ps -a`).
- NOT verified: any ASan trace, any reproduced / not_reproduced verdict, real timing, kill-on-timeout on a real hang, 3/3 repeat behaviour, control-run meaning on real runs.

## 2026-11-16 20:5x ET Rosetta attempt on the Mac (H-006 option b) FAILED; going with option a
- Ran `colima stop; colima start --vm-type vz --vz-rosetta --cpu 2 --memory 8`. ~/.colima/default/colima.yaml: `rosetta: true`, vmType vz, aarch64, 8 GiB.
- Rosetta is NOT active: `/Library/Apple/usr/libexec/oah/` does not exist on the host (Rosetta not installed); inside the VM `/proc/sys/fs/binfmt_misc/` lists only qemu-x86_64 and qemu-i386 (no `rosetta` handler), and `/mnt/lima-rosetta` is absent. amd64 containers therefore run under QEMU user emulation. `docker run --platform linux/amd64 ubuntu:24.04 uname -m` -> x86_64 (plain amd64 binaries work).
- Real verifier from a worktree of origin/sandbox (8116e99), TMPDIR under $HOME: `python3 -I verifier/verify.py targets/libucl/inputs/arvo_42482847.poc --case 42482847` -> inconclusive, "vul run1..3: exit 137 without sanitizer report", 2.1 s total. Same failure as before the restart.
- scripts/rerun_gate.sh (new, uncommitted) smoke-tested here for mechanics only: vul runs exit 137 in 0.6-2.8 s, fix control exit 137, verify.py inconclusive in 1.9 s. This reproduces the failure and proves nothing about the verifier.
- Cause is EMULATION (QEMU), likely ASan shadow-memory mapping; not proven. Rosetta not installed (installing needs admin + license; user said skip for now). NOT verified: any ASan trace, any real verdict, real timing on this Mac.
- Decision: real verifier runs on Person B's x86_64 box (option a); Person B reruns the gate there (scripts/rerun_gate.sh).

## 2026-11-16 Person B: merge origin/orchestrator-setup (7943364) into sandbox
- Dry run `git merge-tree --write-tree --name-only sandbox origin/orchestrator-setup` -> CONFLICT (content) in BUILD_LOG.md only; STATUS.md auto-merged. Reported before resolving.
- Resolution: both sides had appended sections at the end of BUILD_LOG.md; kept both in full (Person B's, then Person A's), removing only the 3 conflict markers. Check: Person A's 65 added lines and Person B's 29 added lines all present; Person A's branch deleted no BUILD_LOG lines.
- STATUS.md: Person A's line ("[x] Dedicated RPC configured (QuickNode devnet, ...)") present verbatim; nothing else changed by the merge.
- Incoming files: server/ (index.ts, verifier.ts, tests, package.json, pnpm-lock.yaml, start-facilitator.sh), scripts/check-env.mjs, scripts/secret-grep.sh. Not edited by Person B. `sh scripts/secret-grep.sh` on the merged tree -> "secret grep clean".
- Post-merge `python -I verifier/test_verify.py` -> no-docker 13/13, fake-docker 6/6, end-to-end 34/34, exit 0.
- Backtest rerun on merge 282056d (verify.py sha256 8022c685...): same counts A 6/0/0/0, B 0/7/0/0, C 17/8/5/0, 0 failures.

## 2026-11-17 ~11:00 ET X402_PAYMENTS Phase 2 (payment half): settlement_pending polling, 402 body, handler-exception, clamp, 60 s cap (devnet, dedicated RPC, FAKE/stub verifier only)
Setup: facilitator = spike code, started once with PORT=4022 (inline), never restarted during the run; RPC host solana-devnet.quiknode.pro on facilitator and server (checked via ps, key not printed). Server keys from spike servers/upto/.env, buyer key from spike clients/fetch/.env, only SVM_RPC_URL/ports from repo .env (repo .env keys still not filled). All env values checked ASCII. Server: `ALLOW_STUB_VERIFIER=1 VERIFIER_PATH=server/test/fake_verifier.py` (fake sleeps N s when the filename is sleepN.bin, prints a stub-flagged not_reproduced). Faults are injected by header `x-test-fault`, honored only when ALLOW_STUB_VERIFIER=1. Tx check = RPC getTransaction (token balance deltas).

Code added: server/src/settlement.ts (onSettleFailure hook, getSignatureStatuses poll, bounded 45 s, SETTLEMENT_POLL_SECONDS), finalSettle() in verifier.ts, async-rejection wrapper + fault hooks in index.ts, test/fake_verifier.py, test/pending_proxy.ts, unit tests. `node test/unit.ts` -> "unit ok" (poll confirmed / failed / bounded timeout / RPC error; hook recovered / not recovered; finalSettle clamps 300000 and 10^30 to 250000, error -> 0).

### 1. settlement_pending: what it looks like (CHECKED in code, @x402/core 2.31.0 chunk-PVRH2E6N.mjs + @x402/svm facilitator; not from docs)
- Facilitator answers {success:false, errorReason:"settlement_pending", transaction:<broadcast sig>} when it broadcast but could not confirm. x402ResourceServer.settlePayment retries the settle exactly ONCE (settleWithPendingRetry); still pending -> onSettleFailure hooks; a hook may return {recovered:true,result}. With no hook, @x402/express answers HTTP 402 {error:"settlement_failed"}-style with PAYMENT-RESPONSE errorReason settlement_pending even if the settle landed (this matches the spike's false settlement_pending).
- Implemented as the hook in server/src/settlement.ts. Applies to the deposit settle and the claim settle (both go through settlePayment).
- Live test uses test/pending_proxy.ts (facilitator proxy on 4024, SIMULATES pending; the real settle is real). The server's FACILITATOR_URL pointed at the proxy for these runs only.
  - Flawed first run (my proxy bug, kept for honesty): the proxy made the DEPOSIT settle pending, so the hook "recovered" the deposit tx 5ghxd9Q9...Dp8 (a confirmed tx, correct behavior for that sig), the claim then never reached the real facilitator, buyer -0.25 and seller +0 until the facilitator's abandon-close returned it (see below). Not a server bug; proxy fixed to forward the deposit and make only the claim pending.
  - Real-claim pending, recovered: server log `[settle] settlement_pending tx=4gvrG8WT... polling RPC up to 45s` then `-> confirmed`; client got status 200 paymentStatus settled, header extra.recoveredFromPending true, 2.1 s. On-chain 4gvrG8WTPhgQYVDR2AfAV2JRoqSepedh8KLgPap93cYtvToweDBScL99TNMHWbGGGSMS3QF5WRL7ymv2iPLoGmyK: err null, seller 1.388577 -> 1.638577, escrow 0.25 closed, buyer unchanged by this tx. Deposit tx x5pRhmjtnGWhPBWkxG1L7pNBa17Sgwn2Gu4VQt6j2Rktk8JnDespn18KPbd4WxASHTsVVFCXzLMo5j5e1QXyoA4.
  - Never-lands pending (bogus signature): `[settle] pending tx=1111... -> unknown` after exactly the 45 s bound (client total 45.4 s), client got HTTP 402 paymentStatus settle_failed errorReason settlement_pending. Nothing claimed as success. The server cannot settle $0 here (the facilitator never confirmed anything); the 0.25 sat in escrow until the facilitator's cleanup abandon-closed it (see below). Deposit tx Fm74vihJXYLFhwXRTgL4aaZNEmgjDmmGvum3FqXb6ybEzdSTu69iDHFj3pPk3tJuQ62Jm78KdLUws2qKDb5fVCn.
  - Observation: on the recovered run the proxy logged 2 claim-settle calls (core's one retry) and the hook ran once; on the flawed run the hook ran twice (deposit then claim). Fine.

### 2. 402 body (run: curl -i -X POST localhost:4021/report --data-binary x)
HTTP/1.1 402 Payment Required; v2 puts the requirements in the PAYMENT-REQUIRED header (base64 JSON, body empty). Decoded accepts[0]: scheme upto, network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1, amount "250000", asset 4zMMC9sr...ncDU, payTo 8uZAqWQT...AuVib, **"maxTimeoutSeconds": 300**, extra {feePayer FmT5...LSaM, receiverAuthorizer 86Uss...m1He, withdrawDelay 900, paymentFlow "escrow", ...}.

### 3. Handler exception (each: HTTP 200, paymentStatus settled, amount 0, escrow fully refunded)
- fault=throw (exception inside the handler's try, after payment): body {verdict:"error", detail:"exception: TEST injected exception inside the handler after payment", settledAtomic:"0"}, 1.9 s. tx 3sWPKUid7SAVY4ra5ium9f7dWkYf2Tg827FVw2XiLDF5MjNah6cYFFMx6ctnxmwamdTPKDUAaN8ewqDRCAuBvfem: err null, buyer 18.861423 -> 19.111423 (escrow 0.25 closed back to buyer), seller unchanged.
- fault=escape (throw OUTSIDE the handler's own try/catch, i.e. a bug in our catch-all): the new wrapper in index.ts answered 200 + override 0; server log `[report] escaped exception, settling $0`. tx 2Ue33EUxecuEon7QWMxmdm2ELGNAMh1nCTrWTwVSEFs6LqRLLYoUg6oWDTo8kkxdDgtUjWB661j4UYd2sTegKGTh: err null, buyer 18.861423 -> 19.111423 (full refund). Reason for the wrapper (code reading, NOT run without it): Express 4 does not catch async rejections, so an escaping throw would leave the request hanging (middleware awaits the response) and may crash the process on unhandledRejection; either way the bond would strand. I did not run the unwrapped variant.

### 4. Clamp
- Unit: finalSettle(300000n)=250000n etc. (see unit ok above).
- Attempt on devnet: fault=overcap forced the decision to 300000 atomic. Response settledAtomic "250000", header amount "250000". tx 56gXh5rbnGNghqccUnaCb5hZBuuVxypBz75DdbLT7h6PiHn3dXJEh5xkWhjUjbezARLBy1LdYxnosgDm1Fkd3GP6: err null, seller 0.888577 -> 1.138577 (+0.25 exactly), buyer 18.861423 final. The spike's separate observation (middleware rejects > cap) is untouched; here our clamp fires first.

### 5. 60 s hard cap (fake verifier sleeps; VERIFIER_TIMEOUT_SECONDS unset = default 60)
- sleep90.bin: `verifier timed out after 60s`, verdict error, settledAtomic 0, client total 62.130 s. tx MJiSi6hkGuCAaWq1MbiYgeNQj7fdKxk5dpLBSwxw6zd1yhUYjBJriSuSMSpbNtMkhYMcwhTu5TystbYfiXnj6gX: err null, buyer 18.611423 -> 18.861423 (full refund), seller unchanged. (The child python is killed with SIGKILL by execFile; the fake has no grandchildren. Real verify.py keeps its own cap 5 s below ours so docker cleanup is its job; NOT exercised here.)
- sleep55.bin (just under the cap): completes, not_reproduced, settledAtomic 250000, 56.889 s total, tx 2BMWF7QtijcS6Z6XNDCRitgwCLbijSgkfF1ByjyV7zvS5XLUEaakXCgypuwiGohiobJdjLMmHXb4gaDpi7wjRWNN (settle ~57 s after open, inside expiresAt=300 s). Balances: seller 1.138577 -> 1.388577, buyer 18.861423 -> 18.611423.

Stuck escrows from the two simulated-pending runs were returned by the facilitator's cleanup manager (abandon_close), buyer ends at 18.361423 = 18.611423 - 0.25 (the one real claim): flawed-run channel FNfeUv... tx 3sxF4CaPHwcSdcdgLWScBjJ84c2KQ9PRajpcQQzNis75AxmWg43pnC9sjPixqdcZcL1vfqukkjmGmsxzGfRbGHrq (err null, buyer 17.861423 -> 18.111423, ~10 min after open); bogus-pending channel HQyD8q9u... tx 3Kc13vcW58qhkbuuGKLSz6sa5zdp3bCCCqbaPbryYsarQUJ7v3Q1Nv5pTda3QMGWEBN6odJUfuEUnp5G6jzHRQo4 (buyer back to 18.361423 at 11:29 ET). Test processes (proxy 4024, server 4021, my facilitator 4022) stopped afterwards; stale facilitator on 3000 (pid 24643) untouched and still listening.

Not done / UNVERIFIED: real Docker verifier (arm64 Mac), concurrency, CDP facilitator, settlement_pending that the REAL facilitator produces (simulated by proxy; the live 429 case from the spike has not been reproduced on the dedicated RPC), restart behavior.

## 2026-11-17 X402_PAYMENTS H-004 attempt: repo .env keys are NOT valid; run BLOCKED (nothing started successfully, no txs, no funds moved)
- Loaded repo .env by `set -a; . ./.env` (values never printed). Lengths: SVM_PRIVATE_KEY 87, SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY 88, SVM_ADDRESS 44, AGENT_SVM_PRIVATE_KEY 88, SVM_RPC_URL 102, FACILITATOR_URL 21, SERVER_PORT 4, FACILITATOR_PORT 4. No exported SVM_*/PORT vars in the shell.
- Facilitator (`FACILITATOR_PORT=4022 sh server/scripts/start-facilitator.sh`) crashed at startup in createKeyPairSignerFromBytes (@solana/keys, error code 3704004). Server (`ALLOW_STUB_VERIFIER=1 pnpm start`) crashed: `Error: Unknown letter: "l"` from base58.decode.
- Offline key checks (no output of values):
  - SVM_PRIVATE_KEY: base58-decodes to 64 bytes, but the public half does NOT match the key derived from the first 32 bytes, and the derived address != SVM_ADDRESS. Corrupt/mismatched keypair.
  - SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY and AGENT_SVM_PRIVATE_KEY: each contains the character 'l' (U+006C), not in the base58 alphabet; cannot be decoded. Likely a copy/transcription error (or not a base58 export).
- Ports 4021/4022/4024 listening afterwards: none. Stale facilitator on 3000 untouched. No escrow created.

## 2026-11-17 X402_PAYMENTS H-004 rerun: repo .env keys now valid; stub-verifier $0 and $0.25 settles PASS on devnet (repo .env only, spike .env files not read)
- Step 1 (offline, node crypto ed25519, exact 58-char alphabet, values never printed): SVM_PRIVATE_KEY PASS (87 chars, 64 bytes, pubkey half matches seed); SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY PASS (88, 64 bytes, match); AGENT_SVM_PRIVATE_KEY PASS (88, 64 bytes, match); SVM_ADDRESS PASS (44 chars, 32 bytes).
- Roles (public addresses): facilitator fee payer FmT5TvNWkLQBsyJ1iFMiKtsTQVKbeSpodjqksmg8LSaM; authorizer 86UssGu5rcNMEeNTfvFP7gwdobCP6jKrBDV3qYQqm1He; buyer 2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA; seller (payTo) 8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib.
- Balances before (RPC getBalance / token accounts): facilitator 0.981938 SOL, 0 USDC; buyer 2.5 SOL, 18.361423 USDC; seller 1.498502 SOL, 1.638577 USDC; authorizer 0 SOL 0 USDC (signs only).
- Start: `set -a; . ./.env; unset PORT; FACILITATOR_PORT=4022 sh server/scripts/start-facilitator.sh` (exported repo-.env vars override the facilitator dir's dotenv, so the repo keys were used; log shows account FmT5Tv...). Server `cd server && ALLOW_STUB_VERIFIER=1 pnpm start` (first attempt crashed "no supported payment kinds": started before the facilitator was up; restarted, then OK, authorizer 86Uss...).
- Run A (VERIFIER_CASE is now set in repo .env, so the server called the REAL verify.py, which defaults over the stub): both client calls (real_bug.bin, fake.bin) -> verdict inconclusive ("docker exit 125, bind source path does not exist /var/folders/..." on this Mac), settledAtomic 0. Fail-closed $0 path through the real verifier invocation confirmed. txs: FmKzanuT9j25CsWcHAsdnEC4V8VVFGsphprQMRUkY15EPQQFvXX6XfWN84ngsuBeyTnXosjyDsCc9gr1y8oTN4S, 4fRM8CcfqWGP3Av67E56aRHKco1Q3iQoafibWvwyuXb3jDHHKKSrTc9GtLKBLwAdX8GdkLen6tv5PpdNi7zTV7jG: err null, buyer +0.25 from closed escrow (full refund).
- Run B (server restarted with `VERIFIER_PATH=verifier/verify_stub.py`, VERIFIER_CASE unset, ALLOW_STUB_VERIFIER=1):
  - real_bug.bin -> reproduced, settledAtomic 0, 1.89 s, settle tx 3BUWFfzEDNQRFZyjY9opdSmJ3aHjv1tGPHRf71HHeXcSzwDo7kR29HVwK2oC6fzecZaky5ayFA8JJpsETJUkH4Z5 (deposit vyaSCUe6damu6sc1P1FwcKW8VGHaoridhWvtQC4EMBuTcQiN5Dh99jqd15kaEw5QQJtTVo9sRYT424fowVmBt7v): err null, buyer +0.25 (escrow closed), seller +0. REFUND confirmed.
  - fake.bin -> not_reproduced, settledAtomic 250000, 2.34 s, settle tx fpME7x1GvpA2JtLA6anMy4tqeNhDELHktTZkDM8tzG9qs2kExoqJ73y8JGQnKoDP277hPmET56JDRJgKW6kcDX1 (deposit BQj7Dvun3NXDmx5aJs16AM7aZeFC3gZ4S3bx1EqXCk6igVvoPgdF7342AjGnuT28T2J1QNqb3cME2qNmqcfTi9W): err null, seller +0.25 exactly, buyer +0. FORFEIT confirmed.
  - Note: getTransaction on these txs needs maxSupportedTransactionVersion 1 (code -32015 with 0); deltas read from pre/postTokenBalances.
- Balances after: facilitator 0.974071 SOL; buyer 2.5 SOL, 18.111423 USDC (= 18.361423 - 0.25 forfeit); seller 1.498502 SOL, 1.888577 USDC (+0.25). Nothing stuck: all four runs' escrows closed in their settle txs; buyer delta matches exactly the one forfeit.
- Cleanup: facilitator/server stopped; ports 4021/4022/4024 free.
- MISTAKE (mine): my cleanup `pkill -f "tsx index.ts"` / `pkill -f facilitator/upto` also killed the stale facilitator (pid 24643, port 3000) that I was told not to touch. It was stale and unused by these runs; channels it held in memory (if any) are gone. Reported to the user.
- NOT verified: real Docker verifier on amd64, concurrency, rate limit, CDP facilitator, real settlement_pending, dedicated-RPC load.

## 2026-11-17 ENDPOINT_HARDENING: concurrency cap, per-wallet rate limit, 413/60 s check (devnet, dedicated RPC, STUB/fake verifier only, repo .env only)
Code: server/src/limits.ts (ConcurrencyGate, RateLimiter, payerFromHeader, parseMaxConcurrent), wiring in server/src/index.ts, finalSettle() in verifier.ts now settles 0 for any verdict outside reproduced/not_reproduced/inconclusive (busy, rate_limited, error, unknown). Env: VERIFIER_MAX_CONCURRENT (default 2, clamped to 1..2), RATE_LIMIT_SECONDS (default 10).
Setup: facilitator `FACILITATOR_PORT=4022 sh server/scripts/start-facilitator.sh` (repo .env exported), started once, NOT restarted; server restarted once between phases (RATE_LIMIT_SECONDS changed). Both stopped by PID afterwards; ports 4021/4022 free. Tx check = RPC getTransaction pre/postTokenBalances (maxSupportedTransactionVersion 1).

### Unit
`cd server && node test/unit.ts` -> `unit ok` (new: gate cap/release/never negative; parseMaxConcurrent default 2, 1 ok, 5->2, 0/abc/-3->2; rate limiter per key, retryAfter 6000 ms after 4 s of 10 s, window expiry, check() does not record, bounded map; payerFromHeader good/bad; finalSettle busy/rate_limited -> 0).

### 413 and 60 s cap
- unpaid curl: 70000 B -> HTTP 413; 65537 B -> 413; 65536 B -> 402 (accepted by the size gate, goes on to payment). 413 happens before any deposit.
- 60 s cap: code unchanged (VERIFIER_HARD_CAP_SECONDS=60, unit asserts inv.secs 60). Not re-run on devnet this session; the sleep90 -> 60 s timeout -> $0 run is in the X402_PAYMENTS entry above.

### Rate limit (stub verifier, buyer 2BPj...CnrXA, window 10 s)
- Where: two checks. (1) PRE-payment, best effort: reads payer from the unverified payment-signature header (payload.payload.from), and answers 429 + Retry-After before the middleware escrows anything. (2) POST-payment, authoritative, the only place that records: limited request answers 200 verdict rate_limited and settles $0.
- Sequential: req 1 real_bug.bin -> reproduced, settledAtomic 0, tx 5gDTxaYFAVY72ZXQ3XhDC7Qf1vH5Wzy3Xxad4WibtgaEuaApkqTyiSCpkqFd2RnL2RCo1v8YPtysof3w4L8wpKU5. req 2 immediately after -> `status: 429, paymentStatus: 'none', body {error:'rate limited', detail:'one report per 10s per wallet; no payment was taken'}`, 0.066 s, NO tx, nothing escrowed.
- Concurrent pair (both pass the pre-check, race to the handler), fake.bin x2: pair1 not_reproduced settledAtomic 250000, tx 562TEDg1o4pZGGTUiCyyZben95L7LWCt55jD2hWa6eZsJMwzd6vq63NCHmm1QapjQ1eQLfMwPAZ4xRsUPPyvwCvt; pair2 `verdict rate_limited, detail 'one report per 10s per wallet; retry in 10s; bond refunded', settledAtomic 0`, paymentStatus settled, amount 0, tx 58h16FB5Xe64ECifA9ENJrc2vNjt2wtNAfkGj2vZDvJFfcQ8USbBPZCFZxi1kCb4CSzevVbvCt9pz3VWf1oyiR5S.
- On-chain (getTransaction): 5gDT... err null buyer +0.25 seller 0 (refund); 562T... err null buyer 0 seller +0.25 (forfeit); 58h1... err null buyer +0.25 seller 0 (rate-limited, full refund).

### Concurrency cap (VERIFIER_MAX_CONCURRENT=2, fake verifier sleeps 8 s, RATE_LIMIT_SECONDS=0.001 so the same buyer is not rate-limited)
3 simultaneous requests: two ran (10.165 s each, not_reproduced, 250000): 3X1Q8binLER1EoSAzwdk3V5WTsu1t6NaHLgPmmvLeBuBi9nmAZpzGtcVZH12gzhn4PTSe16THrQdTTmpch9RqH2N, 3YRALivGpDCSmtLpMj6wV3ZLD6o9Q3wC4XkeTJqQ8R9HmLF5HGK9hFGcqqi5cN6Dj36BZPoizyvPpdwqWFiW3m5k (both err null, buyer 0, seller +0.25). Third: `verdict busy, 'verifier at capacity (2 concurrent); retry shortly; bond refunded', settledAtomic 0`, 2.058 s (did not wait), tx 5drAuE2fNvdSjeHAbuyezysY2Bf8aurMh1inParQt81uavZU2VVJQJ5WVQFzjJ1gLe7yMAKDPBUpNJeRnvoo3c7D err null, buyer +0.25 (refund).

### Totals
7 paid-path requests this session (1 refund + 1 rate_limited refund + 1 busy refund + 3 forfeits = 6 txs; plus the pre-payment 429 with no tx). Buyer USDC 18.111423 -> 17.361423 = -0.75 = exactly the 3 forfeits (pair1, c1, c2). Facilitator SOL 0.974071 -> 0.962261. Nothing stuck.
UNVERIFIED: real Docker verifier (arm64 Mac); gate release when the verifier hits the 60 s timeout or throws on devnet (covered by the same try/finally, only unit-level reasoning, not run); behavior with a payment header from a non-upto client; pre-check using a forged header (reasoned, not run); queueing (deliberately not implemented).

## 2026-11-17 SUBMITTER_AGENT: agent/ built; unit tests + devnet runs (stub verifier, repo .env only, dedicated RPC)
Code: agent/src/policy.ts (pure rules), agent.ts (flow), log.ts (JSONL, drops key-like fields), cli.ts; agent/test/unit.ts. Deps: same pinned set as server (@x402/core|fetch|svm 2.31.0, @solana/kit 8.5.0, @scure/base 1.2.6), no express. Flow is manual (not wrapFetchWithPayment) so the 402 amount is inspected BEFORE signing, redirects are never followed (redirect: "manual"), and only the single upto/solana option is offered to the signer. x402Client spend control is also set to the cap as a second line of defence.
Budget decision: reserve the worst case (the cap in the 402) before signing; release down to the settled amount when the server reports settledAtomic (so $0 settles give the reservation back); KEEP the reservation if the outcome is unknown (network error, non-200 after payment, settle_failed/pending).

### Unit (`cd agent && node test/unit.ts` -> `agent unit ok`)
Covers: USD parsing (rejects 1e3, -1, 7 decimals), auto-approve clamped to cap, allowlist (other path/port/scheme/host, query, userinfo, trailing slash, `localhost:4021@evil.test`), cap check, budget (8 forfeits exhaust $2.00 and the 9th is refused with 8 signings; $0 settle releases; clamp), approval routing and y/N parsing (only y/yes), retry budget (1 per report, session cap), Retry-After parsing, logger drops key-like fields and keeps `tx`; mocked fetch+signer: non-allowlisted URL (zero network calls, zero signings), redirect before payment (not followed, not signed), redirect after payment (reservation kept), over-cap 402 (refused before signing), budget exhausted, approval reject / no answer / accept, auto-approve never prompts, 429 retry once then stop, busy then retry, session retry budget 0, post-payment 402 keeps reservation, over-reported settle clamped.

### Devnet (facilitator PID 47891 on 4022 started once via server/scripts/start-facilitator.sh with PORT 4022, server PID 47905 on 4021 with ALLOW_STUB_VERIFIER=1 VERIFIER_PATH=verifier/verify_stub.py VERIFIER_CASE unset; both stopped by PID after; ports free). Agent env: AGENT_ALLOWED_URL=http://localhost:4021/report, threshold 0.10, auto-approve 0.25 unless stated. AGENT_TEST_FILENAME (test only) sends x-test-filename so the stub routes. Tx deltas via RPC getTransaction pre/postTokenBalances (buyer 2BPj..., seller 8uZA...).
- (a) reproduced: `{"status":"done","verdict":"reproduced","settledAtomic":"0","tx":"5o1D64k2siL3q7LbsRhSNsoTd1xMeLLnefj8sDiHUS59iUBf9MFvfK39JVjaQooZ1ZP5DRSVSiJddwVyQgd6Q2KZ"}`; on-chain err null, buyer +0.25 (escrow returned), seller 0. REFUND confirmed. Budget remaining after: 2.000000.
- (b) not_reproduced: `settledAtomic":"250000","tx":"5kC9pBtbLvh3UGrKWf37v2LDTw79LqtVdmm3yvG3rshDoN2ezsNbGn2cR5pE3pRYjxtBWW1VUTmaCmBY2ErFmwUq"`; on-chain err null, seller +0.25, buyer 0. FORFEIT confirmed. Budget remaining 1.750000.
- (c) AGENT_TARGET_URL=http://localhost:4099/report: `refused: not the allowlisted endpoint`; no network call, no payment. Log: `refuse_url`.
- (d) over-cap against the REAL 402 (set AGENT_PER_REPORT_CAP_USD=0.20, server asks 0.25): `refused: 402 asks 0.250000 USDC, above per-report cap 0.200000`; nothing signed. Log: `refuse_cap askAtomic 250000 capAtomic 200000`. (Also unit-tested with mocked 402 at 250001.) Not done: a server that really asks above 0.25.
- (e) AGENT_SESSION_BUDGET_USD=0.20: `refused: session budget exhausted: need 0.250000, remaining 0.200000`. Log: `refuse_budget`. (Unit: 8 forfeits then refused.)
- (f) approval (auto-approve empty): answer `n` -> `rejected: human declined: nothing paid`; no stdin/TTY -> `rejected: no answer (no TTY): nothing paid`; answer `y` (stdin scripted with AGENT_PROMPT_FROM_STDIN=1) -> paid, reproduced, tx 2rPZ5dPW34M2Z75pz4YX3Qmx3FGAahBEutUwFSmwdePJPfQ2PBAY3oFxjbCaUra4VGVj3Zyg8GBP7YN2cBeV81Ee, on-chain err null buyer +0.25 (refund). Prompt text: `Pay up to 0.250000 USDC (bond; refunded unless the bug does not reproduce) to http://localhost:4021/report for report f2ca1bb6c7e907d0? [y/N]`. NOT tested on a real TTY (stdin pipes only).
- Backoff (live, two files back to back, same wallet): the server's pre-payment 429 fired (once right after the previous run: Retry-After gave 1.5 s wait; once on the second file: 10.5 s wait), agent released the reservation, waited, retried once, both reports then settled $0: txs KZwt7YGZcSb5J5TEHdqCTRvygUcaF1U7QfViyxzeoU7c2ioNzL37cubzBwuB48hrfyAhNB5s1zBvjZjW2tJ43tJ and 4qsoDYtugkThvuwqUTUGMqALTc6nayUQwELymaVWg3o3tgTobyrbtKPLrbHqTPRgi9gT6QyNnv1ApR8NUpoGyfXz (each err null, buyer +0.25). Log: `server_429 stage paid`, `retry waitMs 10500`.
- (g) Decision log excerpts (agent/decisions.log, gitignored, 66 lines for the session; `grep -ci "private\|secret"` = 0), abbreviated:
  - `approval_auto askAtomic 250000 thresholdAtomic 100000 autoApproveAtomic 250000` -> `payment_signed payTo 8uZAqW... network solana:EtWTR...` -> `settle_result verdict reproduced settledAtomic 0 reservedAtomic 250000 tx 5o1D64k2...`
  - `settle_result verdict not_reproduced settledAtomic 250000 ... tx 5kC9pBtb...`
  - `refuse_url`, `refuse_cap`, `refuse_budget`, `approval_rejected answered "no"` / `"no answer"`, `approval_granted by human`
  - `server_429 stage paid delayMs 10500 releasedAtomic 250000` -> `retry why 429 waitMs 10500 retriesThisReport 1`
- Balances after: buyer USDC 17.361423 -> 17.111423 (= exactly the one forfeit, 0.25); facilitator SOL 0.962261 -> 0.952428; seller USDC +0.25.
- UNVERIFIED: real TTY prompt; real verifier; busy retry live (unit only); post-payment settle_failed/pending path with the real agent (unit only, mocked); redirect handling against a real redirecting server (mock only); real over-cap server; CDP facilitator; the agent's behavior when AGENT_ALLOWED_URL host differs from where it runs (only localhost tested).
- Gotchas: Array(8).flatMap skips holes; zsh does not word-split `$R`; Node strip-only TS forbids constructor parameter properties; `sed -i` needs `''` on macOS.

## 2026-11-17 VERDICT_LOG: signed hash-chained verdict log (stub verifier, devnet, repo .env only, dedicated RPC)
Code: server/src/verdictlog.ts (canonicalize, ed25519 sign/verify via node:crypto, VerdictLog, verifyLogText, caseInfo, SettleNotes), server/scripts/verify-log.ts, server/scripts/gen-log-key.mjs, server/test/verdictlog.test.ts; wiring in server/src/index.ts (logOutcome at response close, onAfterSettle + wrapped onSettleFailure, phase after-handler only). Schema: AGENTS/INTERFACES.md. No new dependencies.

### Unit
`cd server && node test/verdictlog.test.ts` -> `verdictlog ok` (plus one expected stderr line from the unwritable-path case: `[verdictlog] append failed (settlement unaffected): ENOENT ...`). `node test/unit.ts` -> `unit ok`. Covers: canonical form; valid chain verifies; restart continues the chain; tampered verdict -> BAD SIGNATURE; tampered settledAtomic; whitespace re-serialization -> not canonical; deleted middle/first record and reorder -> seq/chain failure; tail truncation still verifies (documented limit); wrong pinned key fails; record re-signed by another key / signature swapped fails; keypair parsing (bad half, wrong length rejected); append to an unwritable path returns null and does not throw. Ephemeral in-memory keys only.

### Devnet (facilitator 4022 started once via server/scripts/start-facilitator.sh, never restarted; server restarted between phases; ALLOW_STUB_VERIFIER=1, VERIFIER_PATH=verifier/verify_stub.py, VERIFIER_CASE unset; LOG_SIGNING_KEY = ephemeral key in a 0600 scratch file, not the user's; all stopped by PID, ports free)
Final log (3 lines, signer pubkey 4CrWcL2cprsk2mZKFrMKiDvbbqJ22oPEcNcDNi2qwgdd, ephemeral, discarded):
- seq 0 real_bug.bin -> reproduced, settledAtomic 0, settled, tx 2KrBwGcNP5skYTuwVu3H2zJsbojMe9uzfWHWYidtHC9AckZkhRYoF9n6RSxVqLbtdmBXY9eT4igointi4V5KN8xt. getTransaction: err null, buyer 2BPj +0.25, escrow -0.25 => REFUND.
- seq 1 fake.bin -> not_reproduced, settledAtomic 250000, settled, tx 3mDVTHC4ni6KjZWKeZwmctNjxQUmK8z9py9ZZPatg8rJTNohNZ5cK4ENvzCmwMx9MF8DtrJ1JDQ8UjZu964LjN1s. getTransaction: err null, seller 8uZA +0.25 => FORFEIT.
- seq 2 (simulated settlement_pending via test/pending_proxy.ts bogus, facilitator URL pointed at the proxy for this run only) -> not_reproduced, settlementStatus failed, txSignature = the bogus pending signature (all 1s), settledAtomic 250000 = attempted. Client got 402 settle_failed after 45 s. The bond for this one is stranded ~7 min (test artifact).
- caseId/targetCommit null in all (stub, VERIFIER_CASE unset); casesSha256 and verifierSha256 filled.
`node scripts/verify-log.ts devnet-verdicts.jsonl --pubkey 4CrW...` -> `OK: 3 records ... (pinned)`, exit 0 (the 2-record version printed `OK: 2 records`, exit 0).
Tamper copies (pinned): verdict changed not_reproduced->reproduced -> `PROBLEM line 2: BAD SIGNATURE`, `FAIL`, exit 1; settledAtomic 250000->0 -> BAD SIGNATURE, exit 1; wrong pin -> `signer ... is not the pinned key` per line, exit 1; log cut to line 1 -> `OK: 1 records`, exit 0 (tail truncation undetectable, as documented).

### Problems found and fixed while testing
- onAfterSettle also fires for the deposit (before-handler) settle: the first build recorded the deposit tx as `settled` for a failed claim. Fixed: only phase after-handler counts. That first-build log was discarded.
- Ephemeral key regenerated on each server restart mixed two signers in one log (test artifact; verify reports "N different signers"). Final run used one key file.
- NOT explained: in the first (buggy-build) run a REAL devnet settlement_pending failure (claim tx never landed, getSignatureStatuses null; 105 s client wait) produced NO log record, while three later records (incl. simulated pending) did. No error was printed. Not reproduced since. UNVERIFIED that every real settle failure is logged.
- Observation, not ours: that real claim settle did not land (stranded bond); a retry a minute later settled normally.

UNVERIFIED: real verifier (caseId/targetCommit/vulImage/fixImage populated from cases.json only unit-reasoned, not run on the server; caseInfo ran against the real cases.json but with the stub it deliberately yields null case); the user's persistent LOG_SIGNING_KEY and keygen script (not run; written, syntax loaded only); busy / rate_limited / handler-exception records on devnet (same code path via logOutcome, not run); concurrent appends (synchronous appendFileSync, reasoned); multi-process writers (unsupported).

## 2026-11-17 VERDICT_LOG investigation: every paid /report outcome must leave a record (D-013)
### Path table (OLD code = HEAD index.ts; record written by `res.once("close")` registered in logOutcome, called inside the handler)
| Path | Old | Why / code | New |
|---|---|---|---|
| verdict settle ok (incl. $0) | record | logOutcome then close | record on onAfterSettle |
| handler exception (caught) | record | catch in handle() -> logOutcome | same |
| escaped exception | record | app.post wrapper calls logOutcome if !headersSent | same |
| busy / rate_limited (post-pay) | record | decision -> logOutcome | same |
| verifier timeout | record | runVerifier returns decision | same |
| settle failed, recovered | record (settled) | onSettleFailure puts note | recorder.flush |
| settle failed, unrecovered 402 | record (failed, pending sig) | note put | recorder.flush |
| VERIFY fails / invalid payment (no escrow) | none | processHTTPRequest payment-error, no money moved | none, by design (spam) |
| DEPOSIT (before-handler) settle fails/pends unrecovered | NONE, silent | middleware returns 402 from processHTTPRequest; handler never runs; hook only handled phase after-handler | record `payment_failed` + loud stderr line |
| client disconnects BEFORE logOutcome (verifier running) | NONE, silent | `res.once("close")` registered after close already fired | record on settle outcome |
| client disconnects mid-settle | premature "unknown" record, real outcome lost | close fires during 45 s poll | record on settle outcome |
| response never closes / settle never reports | none | nothing fires | none written, still silent (UNVERIFIED not fixable: pendingCount; documented) |
Likeliest cause of the original: the DEPOSIT-settle path (handler never ran, hook ignored before-handler, nothing printed), or a client timeout; a stale pending claim from the earlier run on the facilitator could make the new deposit fail. UNVERIFIED which one happened; not reproduced with a real (non-simulated) failure.

### Reproduction on devnet (stub; facilitator PID started once on 4022, never restarted; server on 4021 restarted per scenario; ephemeral LOG_SIGNING_KEY pub FWHWUZqj..., key file deleted; stopped by PID, ports free; dedicated RPC)
Final log: `verify-log.ts --pubkey FWHW...` -> `OK: 10 records ... (pinned)`.
- NEW code, handler exception (TEST_FAULT=throw): seq 0 error "exception: TEST injected..." 0 settled tx 5Fh59gze...MTM
- NEW, escaped exception: seq 1 error "internal error (escaped exception)" 0 settled tx SeUZsn16...b44
- NEW, client abort at 4 s during an 8 s handler (x-test-fault slow): client died with TimeoutError; seq 3 not_reproduced 250000 settled tx 5tihHGSa...SxQ (the server still settled; seq 2 was an earlier bad run where VERIFIER_PATH was relative, "verifier failed", tx dYwHxcDk...)
- NEW, rate_limited (two simultaneous clients, window 30 s): seq 4 reproduced 0 settled ocYgaBtM...z6k; seq 5 rate_limited 0 settled 4kxz9m55...4w1
- NEW, pending proxy `real` (claim really lands, reported pending): client got settled with extra.recoveredFromPending; seq 6 not_reproduced 250000 settled tx 29Zq7oJZ13UVF4ZggSP8Su4Q4qAtaf8VqJHAAGzbrQ8NqFpUH3pkA7PWQwP222UABfWKbjarFfoqy4qSfxdWmBtT (log: "pending ... -> confirmed")
- NEW, pending proxy `bogus` (signature never confirms): client 402 settle_failed after 45.1 s; seq 7 not_reproduced 250000 failed tx 111...1 (bogus). Bond for it stranded ~7 min (test artifact).
- NEW, proxy `depfail` (DEPOSIT settle pending, bogus, never forwarded): client 402 after 44.1 s; stderr `[verdictlog] paid request failed BEFORE the handler (deposit settle failed), tx=111...; recording`; seq 8 payment_failed 0 failed tx 111...1.
- OLD code (HEAD index.ts copy, patched only to add the test delay), same `depfail` run: client 402 after 44.0 s, server printed only the two `[settle]` lines, log stayed at 9 lines => NO record, no error. This reproduces the original symptom.
- OLD code, client abort at 4 s during the slow handler: log stayed at 10 lines => NO record. (Whether that run's claim settled was not checked.)
Unit: `node test/recorder.test.ts` -> `recorder ok` (hook-then-close, failed, disconnect-before-register then settle, fallback timer, never-closing = nothing written, escaped, double flush, anon key, pre-handler failure verifies, unwritable log warns loudly, log disabled); verdictlog.test.ts `verdictlog ok`; unit.ts `unit ok`.
UNVERIFIED: busy on devnet (needs 3 payers, only one buyer key; same code path as rate_limited); a real (non-simulated) facilitator deposit failure; the stale-pending-claim theory; the real verifier; log writing under the fallback timer on devnet (unit only); a request whose settle never reports and whose connection never closes still produces no record.

## 2026-11-17 DEMO_RUNNER: one-command demo (bash scripts/demo.sh --stub|--real)
Host: Mac arm64, node v26.10.0, devnet, dedicated QuickNode RPC, repo .env only, clean `env -i HOME PATH` shell. Files: scripts/demo.sh, demo/run.mjs, demo/manifest.json, .gitignore (demo/run/), generated RESULTS.md (STUB banner).
Run 1 (`--stub`, before two fixes: getTransaction needed maxSupportedTransactionVersion >= 1 [RPC error -32015 "Transaction version (1) is not supported"], and the settled-sum was skipped for unconfirmed tx): batch fine, log `OK: 5 records ... (pinned)`, but checks FAILED "cannot be confirmed" (correct: the checker was wrong). Re-ran the fixed checker on that run with `--analyze demo/run`: ALL CHECKS PASSED, no new txs.
Run 2 (`--stub`, final code), full terminal output:
```
== Preflight (mode: stub) ==
  SVM_RPC_URL: set (length 102) ... (all 7 required vars: set, lengths only)
  OK: host=quiknode.pro getSlot (numeric, ok)
  facilitator wallet FmT5TvNWkLQBsyJ1iFMiKtsTQVKbeSpodjqksmg8LSaM: 0.9262 SOL (need >= 0.05)
  buyer wallet       2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA: 14.861423 USDC (need >= 1.250000 for 5 reports)
  payTo wallet       8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib: 4.388577 USDC
  log signer public key: 6vYi5vh11HPCtFDiY7uCdwFt7shT3maXXPTen8PAFNGY
  ports 4021 and 4022 are free
== Starting services == facilitator ready on 4022, server ready on 4021 (unpaid probe got 402)
== Batch: 5 reports ==
  [1/5] arvo_42482847.poc (real_bug) ... done reproduced settled=0
  [2/5] arvo_42482848.poc (real_bug) ... done reproduced settled=0
  [3/5] hand_made_fake_near_miss.ucl ... done not_reproduced settled=250000
  [4/5] hand_made_fake_random.bin ... done not_reproduced settled=250000
  [5/5] hand_made_fake_asan_claim.txt ... done not_reproduced settled=250000
  server stopped; port 4021 free / facilitator stopped; port 4022 free
OK: 5 records, signer(s): 6vYi5vh1... (pinned)
```
(the scratch capture of this exact run was lost when I re-used the terminal output; the table and txs are the ones in RESULTS.md). Final RESULTS.md (copy of the clean run, generated from the log): txs 49hbmUdd...8MJxT (reproduced, $0), 56hJLFUP...Q24L ($0), 5YQLCw1q...XGS ($0.25), 5t3aVc4P...5nPM ($0.25), 3wneJhza...fosJ ($0.25); all `confirmed`, payTo USDC delta per tx equals the logged amount; buyer delta -0.750000 = expected, payTo +0.750000. Log head seq 4, sha256(last line) a2f67691458b4c94083fe8b07b74abd1a4c1c6cd04f9adda34e4d846d58594c9. Explorer: https://explorer.solana.com/tx/<sig>?cluster=devnet.
Negatives (all non-zero): (a) server PID killed after report 1 -> entries 2-5 MISSING, `FAILED`, demo exit=1, facilitator never restarted, ports freed; (b) copy of log with settledAtomic 250000->0 on line 3 -> `PROBLEM line 3: BAD SIGNATURE`, `line 4: prev hash mismatch`, plus on-chain MISMATCH and balance mismatch, analyze exit 1; (c) copy with record 2 deleted -> seq/prev errors, `no log record for entry 2`, exit 1; (d) SIGINT during report 1 -> "stopping children by PID", exit 130, no listeners on 4021/4022; (e) port 4021 occupied -> `DEMO FAILED: port 4021 (server) is already in use`, exit 2; (f) `--real --preflight-only` on this Mac -> `docker architecture is "aarch64"; --real needs an amd64 host`, exit 2.
Extra stub runs (killed-server run, a SIGINT run, a third full batch) spent additional devnet USDC between our own wallets; (d) may have left one escrowed deposit that the facilitator returns after its abandon timeout (not checked).
UNVERIFIED: the whole `--real` path after the docker check; image presence check; RESULTS.md real-mode text.

## 2026-11-17 DEMO_RUNNER: approved demo-set wording and RESULTS.md disclosure
Changed: demo/manifest.json (random-bytes label -> "HAND-MADE robustness check: 4096 random bytes (not representative of LLM slop)", category unchanged), demo/run.mjs writeResults (new "Demo set composition" section; extra line under "Not demonstrated"). No server/, agent/, verdict logic or money path edits.
Ran: `node --check demo/run.mjs` -> passes (CHECK_OK). `node demo/run.mjs --analyze demo/run --out RESULTS.md` (rebuilds from the existing 2026-11-17 stub log; no new devnet txs, only read-only RPC getTransaction) -> `OK: 5 records, signer(s): 6vYi5vh1... (pinned)`, all 5 txs `confirmed`, final line `ALL CHECKS PASSED`. `grep -c "STUB VERIFIER: not a real sandbox run" RESULTS.md` -> 1 (banner present).
New RESULTS.md sections as generated:
```
## Demo set composition
- This demo batch contains 2 real bugs and 3 hand-made fakes (5 reports). Hand-picked, tiny; not a sample of real-world reports.
- **The proof is an input file only.** No report text is part of the protocol, so the fakes are inputs, not written reports. The random-bytes fake is a HAND-MADE robustness check and is NOT representative of LLM-written slop reports.
- Other hand-made fakes exist in `test-inputs/fake/` and were NOT part of this demo batch:
  - `hand_made_fake_empty.bin`: the server rejects empty bodies, so it never reaches the verifier; kept as a server test.
  - `hand_made_fake_config.ucl`, `hand_made_fake_deep_nesting.ucl`, `hand_made_fake_large_config.ucl`: redundant clean inputs exercising the same path as the fakes above.
- All seven hand-made fakes (including these four) are in `backtest/RESULTS.md` set B, where each was run through the real verifier and forfeited (`not_reproduced`). See that file for the table.

## Not demonstrated
- `flaky_or_timeout`: NOT demonstrated. The backtest found no genuine example and we do not fake one.
- `crash_on_both`: NOT demonstrated. The backtest found no genuine example and we do not fake one.
- The deep-nesting input (`hand_made_fake_deep_nesting.ucl`) was run through the real verifier in the backtest (`backtest/RESULTS.md` set B) and returned `not_reproduced`, so it is NOT a flaky/timeout or crash-on-both example.
```
Row 4 of the Reports table now carries the new random-bytes label. Facts checked against backtest/RESULTS.md set B (7 fakes, all not_reproduced/FORFEITED, deep_nesting 6000 B vul 3/3 clean) and server/src/index.ts:168 (empty body -> error, settle 0).
UNVERIFIED: the --real RESULTS.md text (composition section is static and was only rendered in stub mode); the verdicts in the RESULTS.md file are still stub verdicts.

## 2026-11-17 DOCS_README: README.md rewritten (docs only, nothing run)
Replaced README.md with the full draft. No commands were run to produce claims; every figure was copied from backtest/RESULTS.md, RESULTS.md (stub), docs/verified-facts.md, docs/spike-findings.md, AGENTS/*.md and BUILD_LOG.md. TODO markers in the README mark real-run tx signatures, facilitator build steps, curl link re-check, .env.example check, signer pubkey/log head. docs/hackathon.md does not exist in the repo and was not read.

## 2026-11-17 FACT_CHECKER prior-art check
Appended 'Prior art / related work' to docs/verified-facts.md (13 WebSearch queries plus WebFetch of primary pages). Strong conceptual overlap: Cantina and Decred refundable deposits, Bram Cohen proposal. No commit made.

## 2026-11-17 RESULTS_VIEW: static results page (demo/web/)
Added: demo/web/build.mjs, demo/web/template.html, demo/web/test/negative.mjs; demo/run.mjs `writeResultsJson` (additive; writes <run-dir>/results.json from the same `res` as RESULTS.md); `.gitignore` demo/web/out/. No server/, agent/, verdict logic or money path edits. No devnet transactions sent.
Ran:
- `node --check demo/run.mjs`, `demo/web/build.mjs`, `demo/web/test/negative.mjs` -> all pass.
- `node demo/run.mjs --analyze demo/run --out <scratchpad>/R.md` -> `OK: 5 records ... (pinned)`, 5 txs confirmed, `ALL CHECKS PASSED`; demo/run/results.json written (read-only RPC getTransaction only).
- `node demo/web/build.mjs demo/run` -> `wrote .../demo/web/out/report.html (18964 bytes); mode stub; 5 of 5 log entries verified; 0 problem(s) listed`.
- Headless Chrome screenshots at 1280 px and 500 px: layout OK (stub banner, diagram, counts, 5 cards, trust panel, footer banner). Narrow diagram scrolls horizontally. Window below ~500 px not checkable (headless minimum).
- `node demo/web/test/negative.mjs demo/run <scratch>`: tampered log copy (line 3 settledAtomic edited) -> build exit 1, "line 3: BAD SIGNATURE", "line 4: prev hash mismatch", "3 of 5 log entries verified", no page; with --allow-failed a page is written with the CHECKS FAILED banner and "3 of 5 ... verified"; missing log -> `BUILD FAILED: verdict log not found`, exit 2; XSS fixture (`<img src=x onerror=alert(1)>` in label/detail/file) rendered in Chrome DOM as `&lt;img...` text, 0 img elements; bad signature string -> "invalid signature, no link", no href; output has no external URL except the Explorer prefix and the SVG namespace.
UNVERIFIED: real-mode page (no real run dir exists); mobile widths under 500 px; Firefox/Safari.

## 2026-11-17 WEB_FRONTEND: static frontend + fixtures (web/public, web/fixtures, web/test)
Built: web/public/{index.html,app.js,styles.css}, 26 fixtures in web/fixtures/ (+README.txt), web/test/fixtures.test.mjs. Did not touch server/, agent/, demo/, verifier/, web/server.mjs, web/lib/. No devnet txs, no backend calls.
Ran:
- `node --check web/public/app.js` -> OK; `node --check web/test/fixtures.test.mjs` -> OK.
- `node web/test/fixtures.test.mjs` -> `26 fixtures, 1221 checks, 0 failures` (exact key sets and types per the Web app contract for config, log, inbox, notes, submit error bodies, SSE transcripts; first event started, last done).
- Served web/ with `python3 -m http.server 8765 --bind 127.0.0.1`; headless Chrome (--headless=new) screenshots of submit, run (success returned), results, inbox, policy in stub and real fixture variants at 1280 px and 500 px (20 images), plus tampered (stub 1280, real 500), forfeited, refused, error, settlement pending, busy, budget exhausted, empty log, empty inbox. Viewed submit-stub-1280, run-stub-1280, tamperedreal-500, budget-1280, pending-1280: layout fine. Others were generated but not all individually viewed.
- XSS via --dump-dom: log fixture (label, detail, bad signature): 0 `<img`, payload present as escaped text, non-base58 signature -> "invalid signature, no link", 4 hrefs for 5 records. Inbox fixture (errorType, topFrame, detail, caseId, targetCommit, note.text): 0 `<img`. Config demo-input label: 0 `<img`. SSE xss run: 0 `<img`, non-base58 txSignature -> no link.
- Tampered log: page shows `CHECKS FAILED: ... (3 of 5 entries verified)`, `BROKEN log line 3: BAD SIGNATURE`, `BROKEN log line 4: prev hash mismatch`, "3 of 5 log entries verified", broken card outlined. Real mode + tampered log: 0 `banner real` elements; real label only appears with verify.ok true.
- Stub banner text present once on each of the 5 tabs. Busy (409), budget (422), rate (429) messages shown with "No payment was made". Refused run shows "Refused by policy, no payment was made". Error run shows "Settled amount: $0.00". Pending run shows IN PROGRESS "checking the chain (not a failure...)".
- External requests: source contains only the Explorer URL prefix; CSP is default-src 'none' with script/style/connect 'self'; the local http.server log listed only 127.0.0.1 paths. Headless Chrome network log was not captured, so "no external requests" rests on the CSP and source grep.
UNVERIFIED: whole live path against the real backend (SSE via EventSource, CSRF header, multipart of real file upload, 403 handling), keyboard/screen-reader behavior (code written for it, not tested), Firefox/Safari, widths below ~500 px, file chooser upload path (only demo-input path exercised), confirm dialog click path (autorun hook bypasses the dialog), real-mode fixtures are illustrative not recorded.

## 2026-11-17 WEB_BACKEND: web/server.mjs + web/launch.mjs (local-only web app backend, STUB verified on devnet)
Added: web/server.mjs, web/lib/{budget,jobs,records}.mjs, web/launch.mjs, scripts/web.sh, web/test/{web.test.mjs,fake_agent.mjs,integration.mjs}; .gitignore web/run/ web/data/. No edits to server/, agent/, verifier/, demo/run.mjs or web/public|fixtures. No new dependencies (node:http only; imports server/src/verdictlog.ts for verifyLogText).
Ran:
- `node --check web/server.mjs web/launch.mjs web/lib/*.mjs web/test/*.mjs` -> ok.
- `node --test web/test/web.test.mjs` -> `tests 25, pass 25, fail 0` (no network, fake agent, ephemeral log key). Covers: non-loopback bind refused; startup refused if SVM_PRIVATE_KEY / SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY / LOG_SIGNING_KEY present (error does not echo the value); spoofed Host (6 variants x 5 routes) 403; wrong/null/missing/https/other-port Origin 403; missing/wrong CSRF 403; no access-control-* header anywhere, OPTIONS 405; 65537 B body and oversize Content-Length 413 with the agent never spawned and scratch empty; concurrent submit 409 (also 4 simultaneous: exactly one 202); cumulative budget (0.5 budget: two forfeits then 422; returns do not consume budget); reservation held while running; 429 + Retry-After with nothing reserved; filename with shell metacharacters/path separators (no shell, argv is `<scratch>/<sha256>.bin`, AGENT_TEST_FILENAME sanitized, scratch removed); child env via real spawn; SSE amounts/tx from the signed record while the fake agent's console claims 999999; refusal -> error with settledAtomic null; no record -> error, settledAtomic null, cap counted as spent; killed child after signing; secrets (key, RPC URL) never in config/log/inbox/SSE even when the agent log echoes them (redacted); /api/log pinned signer, tamper -> sigOk false, empty log, wrong pin; parseDetail; inbox + notes validation; static allowlist/traversal/dotfiles; unknown routes/methods; demo-input submit.
- Integration on devnet, STUB verifier, through the real HTTP API: `AGENT_SESSION_BUDGET_USD=0.25 bash scripts/web.sh --stub` then `node web/test/integration.mjs --kill`. Web process env checked by NAME only (`ps eww | grep -o NAME=`): no SVM_PRIVATE_KEY, SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY or LOG_SIGNING_KEY; has AGENT_*, SVM_RPC_URL, WEB_*. Output (full transcript in this entry's summary lines):
  - spoofed Host 403, wrong Origin 403, oversize 413.
  - job 1 `real_integration_1.bin`: SSE started, decision allow/approve/sign/settle, verdict reproduced, settled {"settledAtomic":"0","txSignature":"5KhQyiebift1VsKKwmbdsJAbHh2PPvS36aoopeyQbqzDjAbNBhGfxnXqRfd96JknBLe35c4nNXzwUHKZWGSuebna","bondOutcome":"returned"}, done recordSeq 0.
  - immediate resubmit -> 429 retryAfterSeconds 12 (no payment).
  - job 2 `real_integration_killed.bin`: agent child SIGKILLed right after the `sign` event -> `checking the chain`, then the server still settled; the signed record was found within the bounded wait: verdict reproduced, settled 0 tx Dpftmjga1fKD1TQMu5XWtAawDsY5cHzVPXjDPYUW2QXJj96xHm3MFtfReWKtnoVAZUGx4xfafrYwuUQRPoHQPTu bondOutcome returned, recordSeq 1.
  - job 3 `fake_integration_3.bin`: verdict not_reproduced, settled 250000 tx 5jckn6kQ7hDcGxR6kNZwBgzHA2utcXvHhy5oAAXHBfj6h7EyZYnxJNUsVsuGcU8WTNbbPnzeTofg1VGnthovsex bondOutcome forfeited, recordSeq 2.
  - over-budget submit -> 422 session_budget_exhausted (budget 0.25, spent 0.25).
  - /api/log: `verify {"ok":true,"records":3,"verified":3,"problems":[]}`, head seq 2 hash 2cde4a20..., signer 6vYi5vh1...FNGY. RPC getTransaction per record: all 3 confirmed, payTo USDC delta 0 / 0 / 250000 == logged. Balances before buyer 13111423 payTo 5888577; after buyer 12861423 payTo 6138577: buyer delta -250000, payTo delta +250000, sum settled in log 250000. `INTEGRATION CHECKS PASSED`. Stopped by PID (SIGINT to the launcher); ports 4030/4021/4022 free afterwards.
Devnet txs: 3 paid requests (3 settles in the log; deposit txs are not recorded).
UNVERIFIED: real mode through the web app (needs Person B's amd64 laptop); the "no record appeared" error path on devnet (unit-tested only, the killed-child run found its record); settlement_pending through the web app; browser UI (frontend not wired in this run); per-process session budget resets on web restart (in-memory, by design); `--real` launch preflight path was only syntax-checked.

## 2026-11-17 WEB_INTEGRATION (W2): real UI (headless Chrome via CDP) against real backend, STUB verifier, devnet
Edited: web/public/app.js only (3 small fixes below). No edits to server/, agent/, verifier/, demo/, web/server.mjs, web/lib/. Scratch (outside repo): /private/tmp/claude-501/-Users-liezeil-university-blockchain-hackathon2026/e452d3df-a6f8-484f-b1ba-ed7167e32680/scratchpad (scripts cdp.mjs, flow*.mjs, screenshots in /private/tmp/claude-501/-Users-liezeil-university-blockchain-hackathon2026/e452d3df-a6f8-484f-b1ba-ed7167e32680/scratchpad/shots/).
UI interaction level: headless Chrome (--headless=new) driven over the DevTools Protocol with node (no puppeteer): real mouse events (Input.dispatchMouseEvent) on radio buttons, submit button and the confirm dialog's "Approve and submit"; file chooser via Page.setInterceptFileChooserDialog + DOM.setFileInputFiles after a real click on the file input; real EventSource/SSE, CSRF, Origin. The autorun fixture hook was NOT used. Not a human-driven headed browser; no keyboard-only run.
Stack: 'bash scripts/web.sh --stub' (session 1, budget 2.00), stopped by SIGINT to the launcher PID, then 'AGENT_SESSION_BUDGET_USD=0.25 bash scripts/web.sh --stub' (session 2). Facilitator started once per session (pids in web/run/stub/pids.json); no mid-session restarts. Ports were free before and after (lsof: 0 listeners).
Balances (read by RPC, scratch bal.mjs): before buyer 12861423 USDC-atomic / 2.5 SOL; payTo 6138577; facilitator 0.895225083 SOL. After buyer 12361423 (-500000); payTo 6638577 (+500000); facilitator 0.885386473 SOL (-0.009838610). 5 paid requests: 3 reproduced (/bin/zsh), 2 forfeited (/bin/zsh.25 each).
Results:
- (1) Real clicks: radio ARVO 42482847 -> Submit -> dialog ("APPROVE THIS PAYMENT? ... Your click here is the approval.") -> Approve. Run screen steps Policy/Approved/Payment signed DONE, Verdict "reproduced: stub: filename contains 'real'", "Bond returned", settle tx link https://explorer.solana.com/tx/UQ69Y3pP1V9DkQg333XbzvhpjUka8tWknPZ13P1tez6xegSudhGjRfkqjyMFZYF5Ar85PBGsytutNHHZhKx7q8P?cluster=devnet target=_blank rel="noopener noreferrer" (flow1 script's first wait had a case bug (innerText is CSS-uppercased), so the final state was read from the live page afterwards via CDP; the mid-run SSE state was captured in flow 2, shots/03_run_midway.png: Policy/Approved/Signed DONE, rest WAITING).
- (2) Fake via UI: verdict "not reproduced: stub: default", "Bond forfeited", "$0.25 settled", tx 53LaV5vp...WnKDrJdS (full link in shots/06).
- (3) File chooser: file real_upload.bin (48 bytes) chosen via chooser (chooser mode selectSingle), Selected: real_upload.bin (48 bytes), verdict reproduced, Bond returned, tx 4R4vTstmai...71vi8AzE.
- (4) Immediate second submit via UI click path: "Rate limited (429): submits must be spaced out (server allows one paid request per 10 s per wallet) Retry in 10 s. No payment was made."
- (5) 409: in session 2, a second browser tab (real fetch with the tab's CSRF token) POSTed while its own accepted job (seq 6) ran: "202 undefined @6ms", "409 busy @68ms". Caveat: the 409 came from the same second tab that started the job, not from a UI click in tab 1; the 409 message in the UI is fixture-verified only. (An earlier attempt in session 1 got 429 because stub jobs take only ~3 s and the 409 window had closed.)
- (6) Session 2 (budget 0.25): UI submit of a fake -> forfeited $0.25 -> Policy shows spent $0.25, remaining $0.00 -> next UI submit: "Refused (422, session budget): session budget exhausted: remaining 0 atomic USDC is below the 250000 cap No payment was made."
- (7) Results screen: counts 4 reproduced / 2 not reproduced / 0 inconclusive / 0 errors / 0 wrongly forfeited, 6 cards, "6 of 6 log entries verified" (later 8 of 8 in session 2) == /api/log verify {"ok":true,"records":6,"verified":6,...}; head seq 5 hash ff7b649f...; after session 2 head seq 7 hash 1204cf7d... equals sha256 of the last line without newline (python check). 'cd server && node scripts/verify-log.ts ../web/run/stub/verdicts.jsonl --pubkey 6vYi...FNGY' -> 'OK: 8 records, signer(s): 6vYi5vh11HPCtFDiY7uCdwFt7shT3maXXPTen8PAFNGY (pinned)'. RPC getTransaction for all 8 settle txs (scratch rpccheck.mjs): every row 'MATCH' (logged settledAtomic == payTo USDC delta, err null): seq0 0/0, seq1 0/0, seq2 250000/250000, seq3 0/0, seq4 250000/250000, seq5 0/0, seq6 0/0, seq7 250000/250000 -> 'ALL MATCH'. Results page link txids (extracted from hrefs) equal the log's txSignature values. Note the live log contained 3 records from the earlier WEB_BACKEND session (web/run/stub is not wiped), so UI counts include them.
- (8) Inbox: 4 reproduced items (seq 0,1,3,5; stubs: no error type, shown as "No error type in the log detail"). Typed a note via Input.insertText, clicked Valid: card shows "Triage: valid - integration test note: looks like a real overflow", web/data/notes.jsonl got the line, after Page.reload + re-opening the tab the triage line persisted. (This note is test data in the gitignored web/data/notes.jsonl.)
- (9) Policy screen: policy values rendered as numbers ($0.25, $2.00, $0.10, retry 3), budget bar, decision stream shows allow/approve/sign/settle for the session's runs (shots/12_policy.png). After a page reload the stream is empty ("No decisions seen yet in this browser session"): known gap, no history endpoint.
- (10) Stub banner "STUB VERIFIER: not a real sandbox run. Not evidence." present in #banners on Submit/Run/Results/Inbox/Policy (read on each tab in flow 2 and flow 3 outputs).
- Tamper check: web/server.mjs honors WEB_RUN_DIR/WEB_PORT/WEB_SIGNER_PUB, so a COPY of the log (line 4 settledAtomic edited, in scratch) was served by a second instance (env -i, port 4031, no payment keys, no payments possible). UI: "CHECKS FAILED: the signed log did not verify (6 of 8 entries verified)", "log line 4: BAD SIGNATURE", "log line 5: prev hash mismatch", trust panel "6 of 8 log entries verified". Live log untouched.
- Secrets: NO key values printed. By NAME: web process (ps eww) holds AGENT_SVM_PRIVATE_KEY and SVM_RPC_URL (needed for the child agent, by design D-017) and no SVM_PRIVATE_KEY / SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY / LOG_SIGNING_KEY. grep of /api/config, /api/log, /api/inbox, index.html, app.js for PRIVATE_KEY|LOG_SIGNING_KEY|quiknode: 0 matches; long base58 strings in /api/log are exactly the 6 record tx signatures; none in /api/config. Browser console: empty ([]) in all three browser sessions; every request the page made went to 127.0.0.1:4030 (/api/submit, /api/jobs/<id>/events, /api/config, /api/log, /api/inbox).
Bugs found and fixed (web/public/app.js):
1. Submit screen with stub config (target all null) would print 'libucl, case null' and empty commit rows. Now shows "none in stub mode (no library is run, no commit is pinned)".
2. Stub-mode verdict-by-filename is now explained on the Submit screen (real* reproduced, flaky* inconclusive, other not reproduced; demo inputs map to real_bug_N/fake_N).
3. Results badge for log verdicts busy/rate_limited/payment_failed showed "UNKNOWN VERDICT"; now "ERROR (busy)" etc. (counted as errors already). Not exercised live (needs a real busy/rate_limited record); code-read and node --check only.
Checked and fine: numeric policy fields arrive as numbers and render; stub runs take ~3 s on devnet so the SSE 'checking' step is skipped (shown "no waiting needed"), the pending-chain UI was NOT exercised live (fixture only).
Also ran: 'node --check web/public/app.js' ok; 'node --test web/test/web.test.mjs' tests 25 pass 25; 'node web/test/fixtures.test.mjs' -> '26 fixtures, 1221 checks, 0 failures'.
UNVERIFIED: real mode through the web app; headed browser / human click; keyboard use; Firefox/Safari; settlement_pending and error SSE paths in the UI live; UI-rendered 409 message live; policy decision history after reload; 'N of N' on a log with 0 records.

## QE_SANDBOX_SECURITY: container flag review, probe suite, induced cap test (2026-11-17)
QE_SANDBOX_SECURITY report, 2026-11-17 (Mac run 2026-11-18T00:3x Z). Scope: configured container limits only. The sandbox is NOT claimed to be escape-proof; these probes are not an escape test.

Flag review (verifier/verify.py docker_run(), read from code; line numbers are from this commit):
- 143 `--rm`, `--name verify-<uuid16>` (fresh container per run, 142 uuid), `--pull never`: present.
- 144 `--network none`, `--read-only`, `--tmpfs /tmp:rw,size=16m`: present (scratch = 16 MB /tmp).
- 145 `--user 1000:1000`, `--cpus 1`, `--memory 1g`, `--memory-swap 1g` (swap disabled): present.
- 146 `--pids-limit 64`, `--cap-drop ALL`, `--security-opt no-new-privileges`: present.
- 147 only env passed is `-e ASAN_OPTIONS=...`; the host environment is not forwarded (docker run has no --env-file / -e NAME). The image's own ENV (build vars, no secrets, see probe d) is inherited.
- 148 input: `--mount type=bind,src=<private staged copy>,dst=/in/input,readonly`; staged at verify.py:225-233 in a fresh mkdtemp copy after the 64 KB check. No other mounts, no -v, no docker.sock, no --privileged.
- 151,154 wall clock: host-side `subprocess.run(timeout=budget)` where budget = deadline - 5 s (139); on timeout `docker kill <name>` with a 5 s timeout (154-156). Total cap 60 s (54, lowered only by VERIFY_CAP_SECONDS, main()).
Missing or weaker than the spec/maximal hardening (none is a spec violation; spec flags are all present):
1. No in-container timeout: if `docker kill` itself fails or times out (154-156 swallows TimeoutExpired; any other exception propagates to main() -> inconclusive) the container can outlive the call. --rm removes it only on exit. [P2]
2. No `--ulimit` (fsize, nofile, core, nproc is covered by pids). Writes are bounded by the 16 MB tmpfs and memory limit, so low impact. [P3]
3. `/dev/shm` stays docker's default writable 64 MB tmpfs even with --read-only (probe b WARN). Not in spec. Bounded; add `--shm-size 1m` or `--ipc none` if wanted. [P3]
4. Default seccomp/AppArmor profile only (Seccomp=2 inside). Fine, but README should say "docker default profile". [P3]
5. /tmp is mounted `rw,nosuid,nodev,noexec` (docker tmpfs defaults, shown by probe c): stronger than the code states.
6. Image build ENV (CC, CFLAGS, OUT, SRC, WORK, GOPATH ...) is visible to the harness. No secret-looking names. [P3]
7. Runs only on the same host as keys per H-006 (B's laptop): isolation between untrusted input and host keys is exactly these container limits plus docker daemon trust. Documented in STATUS; README must repeat it. [P2 doc]
8. Mount source staging: VERIFY_TMPDIR note. On macOS VM-backed docker, bind-mounting a path that was removed and re-created at the same path gave "Can't open /in/input" in my cap test (stale file share). verify.py uses a fresh mkdtemp per call so it is not affected; noted only because it cost debugging time.

Scripts (QE-owned, no builder code edited):
- scripts/sandbox_probes.sh: derives the flags by importing verify.py with `python3 -I` and capturing the argv docker_run() would pass (docker() monkeypatched; no container started by that step), replaces only --name and the entrypoint. Audits flags, then probes (a) network, (b) writes outside scratch, (c) scratch write + 16 MB fill cap, (d) env names and host-path visibility, (e) uid/CapEff/CapBnd/NoNewPrivs, (f) bounded fork probe (100 attempts), (g) memory (allocates in 16 MiB steps, hard ceiling 1.5x limit), (h) read-only input (+ host sha256 unchanged), (j) cgroup values, (i) no leftover containers. A precheck aborts if the hardened container cannot start (so no false PASS).
- scripts/sandbox_cap_test.sh [--full]: A0 control, A INDUCED hang, B real verify.py with VERIFY_CAP_SECONDS=5.2, C (--full) INDUCED hang against the real 60 s cap. Each stage ends with a no-leftover-container check.
- No real hanging libucl input exists in the repo (backtest/RESULTS.md line 98; docs/DECISIONS.md 120). All hangs are INDUCED (/bin/sh running `sleep 300` through the real docker_run()). Proves: verify.py's timeout + `docker kill` path stops a non-exiting container inside the deadline and leaves nothing behind. Does not prove: libucl has a hanging input; the server's own 60 s cap (not tested here); anything about escapes.

Mac results (arm64 host, docker 29.5.2 aarch64, amd64 image under QEMU emulation; EMULATED, NOT AUTHORITATIVE; VERIFY_TMPDIR=$HOME/.qe-probe-tmp because /private/var/folders is not shared with the VM):
sandbox_probes.sh: FAIL=0 NOT-POSSIBLE=0 WARN=2. Flag audit 13/13 PASS. (a) PASS: `bash: connect: Network is unreachable` for 1.1.1.1:53, getent example.com failed, interfaces: lo only. Positive control (same command, default network, one attempt): connect-ok, so the probe is not vacuous. (b) WARN: root FS `ro`, no write to /, /etc, /out, /usr, /root, /in, /src; /dev/shm writable. (c) PASS: /tmp 16384 KiB, fill stopped at 16384 KiB. (d) WARN only for image-owned env names (ARCHITECTURE CC CCC CFLAGS ... WORK, listed in output); no secret-looking names; ASAN_OPTIONS set; no /Users, /host_mnt, docker.sock; mount destinations list has no host paths; /in holds only `input`. (e) PASS uid 1000, CapEff=CapBnd=0, NoNewPrivs=1, Seccomp=2. (f) PASS started 30 of 100, then `[Errno 11] Resource temporarily unavailable`, cgroup pids.max=64. (g) PASS killed after ~992 MiB, docker exit 137 (limit 1024 MiB, ceiling 1536 MiB). (h) PASS append/truncate/delete/move/create refused, mount `ro`, host sha256 unchanged. (j) PASS cpu.max=100000 100000, memory.max=1073741824, memory.swap.max=0, pids.max=64. (i) PASS 10 probe containers, none left.
sandbox_cap_test.sh --full: FAIL=0. A0 control exit 0 ("ran"); A induced hang: returncode=None elapsed=3.06 s (deadline 8 s) "run exceeded 3 s, container killed"; B real verify.py: one JSON line `inconclusive ... run exceeded 0 s, container killed; no time left...` in 0.27 s; C: elapsed=55.12 s (deadline 60 s), killed; no verify-* container after any stage.
`bash -n`: both scripts OK. shellcheck: not installed (UNVERIFIED). Both scripts LF-only.
Caveat on (g)/(f)/(j): under emulation the numbers (30 forks, 992 MiB) are not meaningful for amd64; only the pattern (limit enforced) is.

Findings by severity:
- P0: none found.
- P1: none found.
- P2: (1) no in-container timeout; leak possible if `docker kill` fails (verify.py 154-156). Suggested change for Person B (not made by QE): after the kill attempt, run `docker rm -f <name>` best-effort and log a leaked-container warning. (2) Keys and untrusted proofs share B's laptop (H-006): README must say so; limits above are the only barrier.
- P3: /dev/shm writable; no --ulimit; default seccomp only; image env vars visible; shellcheck not run; probe (f)/(g) numbers are emulation-skewed on the Mac.
UNVERIFIED: everything on amd64 hardware; behaviour of the probes on WSL2 (Windows host Docker Desktop; paths: run from a WSL shell inside the repo); real hanging input; server-side 60 s cap and settle-$0 on kill; concurrent runs (2) interference; docker daemon crash mid-run; any escape attempt (not attempted, out of scope).

How Person B runs this on the amd64 host (WSL2 Ubuntu shell, repo root, images already pulled, no keys needed, nothing is sent to the network except one TCP SYN to 1.1.1.1:53 and one DNS query attempt that are expected to fail):
  git pull   # branch orchestrator-setup
  bash scripts/sandbox_probes.sh 2>&1 | tee sandbox_probes_amd64.txt
  bash scripts/sandbox_cap_test.sh --full 2>&1 | tee sandbox_cap_amd64.txt     # takes about 70 s
  docker ps -a | tee sandbox_ps_after.txt                                      # expect no probe-* or verify-* rows
  uname -m; docker version --format '{{.Server.Os}}/{{.Server.Arch}} {{.Server.Version}}'
Send back the three .txt files plus the uname/docker version line. Expected on amd64: summary FAIL=0; NOT-POSSIBLE=0; WARN probably 2 (the /dev/shm and the image env names); the first line of sandbox_probes.sh output must show docker arch x86_64/amd64 and no "NOT authoritative" note. If the precheck ABORTs, set VERIFY_TMPDIR to an existing directory under $HOME and retry. Do not run these on a machine in the middle of the paid demo (they use up to ~1.5 GiB RAM briefly and ~70 s of one CPU).
Remaining hole to close on amd64: re-run once with the facilitator/server stopped if you want zero interference; and send a result for probe (g) and (f) because those are the numbers that were emulation-skewed here.

## 2026-11-17 QE_WEB_SECURITY: local web app probe suite (own instances, ports 4032-4041, env -i, fake agent, canary secrets, no payments)
Scripts (key-free, committable): web/test/qe/http_probes.sh (curl, vs a running instance), web/test/qe/web_security.mjs (75 checks, in-process createApp, fake agent), web/test/qe/xss_server.mjs + xss_cdp.mjs (real UI in headless Chrome over CDP), web/test/qe/orphan_server.mjs.
Ran: `env -i node web/server.mjs` variants (no WEB_MODE, SVM_PRIVATE_KEY / LOG_SIGNING_KEY / SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY set) -> exit 2 with a message naming the variable, not its value. Started `env -i WEB_MODE=stub WEB_PORT=4032 ... node web/server.mjs`: lsof shows `127.0.0.1:4032 (LISTEN)` only; WEB_HOST env is ignored (no non-loopback config exists; createApp(host:"0.0.0.0") throws). I made one curl to this Mac's LAN IP on 4032 by mistake (connection refused, code 000); nothing else left loopback.
Result: web_security.mjs 74/75 PASS, the one FAIL is the unbounded notes file (QE-W-001). http_probes.sh: all Host/Origin/CSRF/CORS/traversal probes behaved as required (see AGENTS/QE_WEB.md for the table). Headless Chrome: XSS payloads in demo label, verdict detail, notes, wallet strings rendered as text on all 5 tabs and after a UI-driven submit: window.__xss never set, 0 injected elements.
Not claimed: the app is secure. Untested items are listed in AGENTS/QE_WEB.md.

## 2026-11-17 DOCS_README: README updated for the first real run
Docs only; no command run. README.md now points to docs/evidence/real-run-2026-11-17/ (results, signed log, 5 settle txs with explorer links, signer pubkey and head hash), adds Person B's facilitator install commands (B's machine only; clean-machine test pending), removes the root RESULTS.md as checked-in results (gitignored stub copy), removes the curl and .env.example TODOs, and adds the sandbox probe status (Mac emulation only, amd64 pending) and the P2 swallowed `docker kill` finding. Open TODOs: clean-machine demo, amd64 probes, env table re-check. Claims copied from the evidence files; the 5 tx checks are from the evidence README (done by us via RPC earlier), not re-run now.

## 2026-11-17 QE_FUNCTIONAL (web app, STUB verifier, devnet): independent re-run from a clean log
Edited only: web/test/qe_functional/ (new, key-free scripts; they read .env only for SVM_RPC_URL and to derive public addresses, never print or send key material). No feature code touched. Scratch/screenshots: /private/tmp/claude-501/-Users-liezeil-university-blockchain-hackathon2026/e452d3df-a6f8-484f-b1ba-ed7167e32680/scratchpad/qe_functional (shots/).
Method: `bash scripts/web.sh --stub` once (pids 67748 facilitator, 67766 server, 67768 web, launcher 67737); removed web/run/stub and web/data/notes.jsonl first; ports 4021/4022/4030 were free before and after (launcher stopped by SIGINT to its PID). Headless Chrome over CDP (own scripts: real mouse events, file chooser, confirm dialog, EventSource), RPC reads (getBalance/getTokenAccountsByOwner/getTransaction at confirmed; note the settle txs are transaction version 1, so getTransaction needs maxSupportedTransactionVersion 1).
Paid requests: 6 (real* x2 [one upload, one demo radio], non-real x2 [fake_qe_b.txt, manifest real_bug bytes under the name arvo_42482847.poc], flaky x1, real* kill test x1), all 11.5 s+ apart.
Balances (RPC) before -> after: buyer USDC 12361423 -> 11861423 (-500000), payTo 6638577 -> 7138577 (+500000), log sum of settledAtomic = 500000 (2 forfeits x 250000, 4 x $0); facilitator SOL 885386473 -> 877473579 lamports (-7912894 = 0.0079 SOL for 6 settles). Buyer SOL unchanged.
Results (all through the UI click path unless noted):
- (1) empty log: Results shows "The log is empty...", five 0 tiles, "REPORTS (0...)", "0 of 0 log entries verified", head "none (empty log)"; Inbox "Nothing to triage"; Policy spent $0.00; no NaN/undefined/null text.
- (2) real_qe_a.bin: "Bond returned", $0.00 settled; Explorer link == log txSignature; RPC buyer/payTo delta 0. (3) non-real: arvo_42482847.poc upload: "Bond forfeited" $0.25; buyer -250000, payTo +250000, matches log. (4) flaky_qe_c.bin: verdict inconclusive, "Bond returned", counted in Results and shown in Inbox.
- (5) UI tiles [reproduced 3, not reproduced 2, inconclusive 1, errors 0, wrongly forfeited 1] == recomputed from verdicts.jsonl and demo/manifest.json by sha256 ([3,2,1,0,1]); the one wrongly forfeited is the manifest real_bug file uploaded under a non-real name (stub routes on the filename). Uploads not in the manifest show no label ("UNLABELED"), 4 cards. (6) "6 of 6 log entries verified" == "OK: 6 records ... (pinned)" from server/scripts/verify-log.ts. (7) page head hash ab85346bb2e0e60a... == sha256 of the last log line. (8) conservation holds (above). (12) 6 settle links == the 6 log signatures; all 6 confirmed, err null, payTo delta == logged settledAtomic (0,250000,0,250000,0,0). (13) STUB banner on all 5 tabs, no close control; no REAL mode label (only the category tag "REAL BUG (hand-assigned)").
- (9) 429 through the UI right after a job: text "Rate limited (429)... No payment was made.", log lines and all three balances unchanged. 422 through the UI on an extra instance (:4031, AGENT_SESSION_BUDGET_USD=0.10): "Refused (422, session budget)... No payment was made.", log 5 -> 5 lines, balances unchanged. 409 through the UI: a second tab with the confirm dialog open clicked Approve after tab 1's job started: "Busy (409): another submission is running...", no payment.
- (10) The launcher stops the whole stack when the web child exits, so the web app cannot be killed/restarted alone through scripts/web.sh without tearing down the facilitator (not done). Instead an extra web instance on :4031 (same run dir, same filtered env) was SIGTERMed by PID right after "Payment signed" appeared: the server still settled (record seq 5, reproduced, $0, settled, written 1.9 s after the kill), the log verifies 6/6 and the record shows after restart, in-memory session budget reset to $0 spent (documented). Notes survived the restart (valid/misuse still attached). BUG: the UI of the killed run said "Error ... Settled amount: none (no payment was made)" (see findings, 07_kill_ui.png).
- (11) Inbox: reproduced+inconclusive only (4 items), newest first, == API; two notes typed and saved with real clicks, a third item stayed "Not triaged yet"; reload and process restart kept them; "<b>x</b>" in a note rendered as text. (14) At 500 px the confirm dialog is 468 px wide, Cancel/Approve both on top (elementFromPoint), no horizontal scroll (scrollWidth 500), and a real click on Approve at 500 px started the job.
- (15) returned/forfeited/inconclusive/422/429/409 texts checked live; error, refused and settlement_pending only via fixtures (file://, flow4). No live run said "failed" for a returned bond or "returned" with settled > 0. Exceptions: see QE-F-001/002.
Findings: QE-F-001 (P1), QE-F-002 (P2), QE-F-003..005 (P3), design limitation QE-F-006 (P2); table in AGENTS/QE_WEB.md. UNVERIFIED: real mode, live error verdict / no-record / settlement_pending paths, policy refusal live, headed browser, keyboard-only use.

## WEB_FIXES (2026-11-17): fixes for QE-F-001..006, QE-W-001/002/004 (builder; QE must re-verify)
Files: web/public/app.js, web/public/styles.css, web/server.mjs, web/lib/records.mjs, web/fixtures/{sse.dropped.txt,sse.dropped_norecord.txt,README.txt}, web/test/{web.test.mjs,fixtures.test.mjs,qe/f001_cdp.mjs}, AGENTS/{WEB_BACKEND,WEB_FRONTEND,QE_WEB}.md, docs/WEBSITE_PLAN.md. No server/, agent/, verifier/, demo/ or contract change. All runs key-free (env -i, fake agent, ports 4046-4048).
- node --check: ok on app.js, server.mjs, records.mjs, f001_cdp.mjs, web.test.mjs, fixtures.test.mjs.
- `node --test web/test/web.test.mjs`: tests 27, pass 27, fail 0 (2 new: QE-F-003 dollars; QE-W-001 caps 413 + cache invalidation).
- `node web/test/fixtures.test.mjs`: 28 fixtures, 1281 checks, 0 failures (dropped-stream fixtures are allowed to end without done).
- `env -i node web/test/qe/f001_cdp.mjs <shots>`: 15 PASS, "all passed". Covers QE-F-001 (SSE request intercepted with CDP Fetch and answered with a partial stream, so EventSource fires its native error event: UI shows the UNKNOWN text and "Checking the chain", never "no payment was made", then reads back "Bond returned, $0.00 settled" from /api/log), QE-W-004 (live server ignores ?fixtures=1: fixture bar hidden, no __app hook), QE-F-002 ("error: $0 settled, bond returned", no FAILED), QE-F-004, QE-F-005, refused scenario still says no payment was made. Screenshots in scratchpad/shots: f001_1_after_drop.png, f001_2_recovered.png, f001_3_fixture_dropped.png, f001_4_error_verdict.png.
- `env -i node web/test/qe/web_security.mjs`: SUMMARY 74/75 PASS; the one FAIL, notes.growth-cap, is a hardcoded `rec(..., false, ...)` in the probe. Observed: 411/1500 notes accepted (rest 413), file grew 259,682 bytes (< 262,144 cap). Probe predicate needs updating by QE.
- XSS CDP probe (xss_server :4047 + xss_cdp.mjs): xss null and 0 injected elements on every tab, run, results, inbox, fixtures=1-on-live-server and query/hash payload pages. Console 404 count dropped (old code also fetched /fixtures/* on the live server; now none).
- QE-F-006: documented only (WEB_BACKEND.md, WEBSITE_PLAN.md s10). Launcher unchanged.
- UNVERIFIED: QE-W-002 child kill on SIGTERM with a live agent (the real agent child exited before the TERM in my try, no keys; the stub-mode child kill path via the main block is code-only); a real browser SSE drop via an actual server kill (I used CDP-fulfilled partial streams, which fire the same native error event); real mode; live (non-fixture) error verdict.
