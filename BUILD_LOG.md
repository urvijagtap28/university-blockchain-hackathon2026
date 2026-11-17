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
