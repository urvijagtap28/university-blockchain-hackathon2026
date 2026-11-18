# README sections: sandbox, results, weaknesses, security (Person B draft)

Draft for Liezeil to merge into README.md. Written by Person B (sandbox, verifier, backtest). Every number below comes from a file in this repo; the source is named next to it. "Verified by builder only (x86_64)" means Person B ran it on their own amd64 machine and nobody else has re-run it.

## 1. Sandbox and verifier

### What `verifier/verify.py` does

`python3 verifier/verify.py <input_file> [--case <id>]` prints one line of JSON, `{"verdict": "...", "detail": "..."}`, and always exits 0 (contract and changes: [docs/INTERFACES.md](INTERFACES.md)). For one submitted input file it:

1. Checks the case id. `--case` must match `^[0-9]{1,12}$` and be listed in `verifier/cases.json`. Anything else (empty, `../x`, `42;ls`, 5000 characters, non-ASCII digits) returns `inconclusive` before any Docker call. The server picks the case (`VERIFIER_CASE`); the sender cannot.
2. Checks the input: it must exist and be at most 65,536 bytes (64 KB).
3. Checks both images are present locally and are `linux/amd64`. It never pulls.
4. Copies the input into a private temporary directory (or under `VERIFY_TMPDIR` if set) and mounts that copy read-only.
5. Runs the harness **3 times on the vulnerable image**. It stops early if the runs disagree.
6. Only if all 3 vulnerable runs show the case's expected ASan error, it runs the input **once on the fixed image** as a control.

A run counts as a "crash" only if it reports the expected ASan error type (`heap-buffer-overflow` for all six cases) **and** at least one stack frame is in libucl's own source (`/src/libucl/`, not the fuzz harness under `tests/`; libucl's bundled headers count).

### The three verdicts

| Verdict | When | Bond |
|---|---|---|
| `reproduced` | 3/3 vulnerable runs crash as above, and the fixed-image control run is clean | returned ($0 settled) |
| `not_reproduced` | 3/3 vulnerable runs are clean (the control is not run) | forfeited ($0.25 settled) |
| `inconclusive` | anything else: mixed runs, a different error type (for example a SEGV), crash on both images, timeout, a killed container (exit 137), a missing image, a bad case id, an oversized or missing input, any verifier error | returned ($0 settled) |

An environment failure can never forfeit a bond: every error path is `inconclusive`.

### Lockdown: the exact `docker run` per run

From `docker_run()` in `verifier/verify.py` (sha256 `1bd695e02decdd8557216ba69f6479154c14edd97af33af10d5f4d0bd6a9d432`):

```
docker run --rm --name verify-<16 hex> --pull never
  --network none --read-only --tmpfs /tmp:rw,size=16m
  --user 1000:1000 --cpus 1 --memory 1g --memory-swap 1g
  --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges
  -e ASAN_OPTIONS=alloc_dealloc_mismatch=0:allocator_may_return_null=1:detect_leaks=0:detect_stack_use_after_return=1:fast_unwind_on_fatal=0:handle_abort=1:handle_segv=1:symbolize=1:print_scariness=1:dedup_token_length=3
  --mount type=bind,src=<private copy of the input>,dst=/in/input,readonly
  --entrypoint /out/ucl_add_string_fuzzer n132/arvo@sha256:<digest> /in/input
```

- The harness gets only the input path. The images use three different fuzzing engines (libFuzzer for four cases, honggfuzz for 42486194, the AFL++ driver for 42512369), and extra libFuzzer flags made the AFL++ build hang on stdin.
- `detect_leaks=0`: the harness leaks its parser when parsing fails, so leak reports would look like crashes. The fixed images ship `/out/ucl_add_string_fuzzer.options` with the same setting.
- No host environment variables are passed in. The container sees only the image's own build variables (`CC`, `CFLAGS`, `SANITIZER` and so on) plus `ASAN_OPTIONS`. None of the 12 images has a secret-like variable name (checked with `docker image inspect`; [docs/SANDBOX_HANDOFF.md](SANDBOX_HANDOFF.md)).

### Time cap, kill and cleanup

- The whole `verify.py` call has a **60 s** cap measured from start. Each run gets the remaining time **minus a 5 s reserve**, so a hanging run is stopped at about **55 s**.
- On timeout, the named container gets `docker kill` (3 s), then **always** a best-effort `docker rm -f` (2 s), with errors ignored. `--rm` alone only removes a container after it stops, so if a kill failed the container could outlive the call. The verdict is `inconclusive` either way.
- Measured with an INDUCED hang (`sleep 300` as the "harness"; no real hanging libucl input exists): killed at 55.23 s and 55.30 s in two runs of `bash scripts/sandbox_cap_test.sh --full`, with no `verify-*` container left (evidence: [docs/evidence/sandbox-amd64-2026-11-17/](evidence/sandbox-amd64-2026-11-17/), [docs/evidence/verify-rmf-2026-11-17/](evidence/verify-rmf-2026-11-17/)). A third run on the final `verify.py` (sha256 `1bd695e0...`) gave 55.34 s; its output was sent to Liezeil and is not committed.
- The server enforces its own 60 s cap separately. That server-side cap was not tested with the real verifier.

### Cases pinned by digest

`verifier/cases.json` lists six libucl cases (42482847 default, 42482848, 42486194, 42490132, 42497487, 42512369). Each has a vulnerable and a fixed image referenced only as `n132/arvo@sha256:<64 hex>`, the libucl commit inside each image, the expected error type and the confirmed library frame. `verify.py` refuses any entry that is a tag instead of a digest. All values were read from Docker and from `git rev-parse` inside each image, not typed by hand.

### The harness and credits

The harness is libucl's own OSS-Fuzz target, `tests/fuzzers/ucl_add_string_fuzzer.c`, built into each image as `/out/ucl_add_string_fuzzer`. It calls `ucl_parser_new(0)` and then `ucl_parser_add_string(parser, data, size)` on the whole input file. Its source is identical in all 12 images. A 0-byte input returns immediately, so it is always clean.

The vulnerable and fixed images, the crashing inputs and the case metadata come from **ARVO** (an atlas of reproducible OSS-Fuzz vulnerabilities): <https://github.com/n132/ARVO>, metadata from the ARVO-Meta v3.0.0 release (`arvo.db`). The harness belongs to the libucl project (<https://github.com/vstakhov/libucl>) and its OSS-Fuzz integration. We did not write the harness or build the images.

Verifier tests: `python3 verifier/test_verify.py`: 34/34 end-to-end plus all no-Docker and fake-Docker tests pass (verified by builder only, x86_64; last run on the final `verify.py`: [docs/evidence/verify-rmf-2026-11-17/](evidence/verify-rmf-2026-11-17/)). `python3 verifier/verify.py --self-test` checks whether a host can run the harness at all.

## 2. Backtest and real runs

### Backtest (real verifier, no payments)

From [backtest/RESULTS.md](../backtest/RESULTS.md): 43 `verify.py` calls, 2.0 to 3.6 s each, commit `282056d`, `verify.py` sha256 `8022c685...`, Windows 11 AMD64 with Docker 29.9.3. Verified by builder only (x86_64).

| Set | Inputs | reproduced | not_reproduced | inconclusive | failures |
|---|---|---|---|---|---|
| A. Real bugs, each against its own case | 6 | 6 | 0 | 0 | 0 |
| B. Hand-made fakes, default case 42482847 | 7 | 0 | 7 | 0 | 0 |
| C. Real bug inputs against a different case | 30 | 17 | 8 | 5 | 0 |

- Wrongly forfeited real bugs (set A): **0 of 6**. Hand-made fakes judged reproduced (set B): **0 of 7**.
- Set C: 17 real inputs were `reproduced` on another case whose vulnerable build also had that bug, which shows the control run means "gone in a later libucl". 8 were forfeited because that case's vulnerable build ran them clean. 5 were `inconclusive`: ARVO 42512369's input gives a SEGV (not a heap-buffer-overflow) on every older vulnerable build.

### Real devnet runs (`bash scripts/demo.sh --real`)

Both runs were made by Person B on the same laptop (WSL2 Ubuntu x86_64, Docker 29.9.3 linux/amd64), Solana devnet, dedicated RPC, 5 reports each: 2 ARVO crashing inputs and 3 hand-made fakes.

| | Run 1 | Run 2 (clean-machine clone) |
|---|---|---|
| When (ET, 2026-11-17) | 19:14:40 to 19:16:09 | 20:49:56 to 20:51:20 |
| Repo commit / `verify.py` sha256 | `4262375` / `8022c685...` | `92b8e8a` / `1bd695e0...` |
| Reproduced (bond returned) | 2 | 2 |
| Not reproduced (bond forfeited) | 3 (all hand-made fakes) | 3 (all hand-made fakes) |
| Wrongly forfeited real bugs | 0 | 0 |
| Inconclusive / errors | 0 / 0 | 0 / 0 |
| Signed log | 5 records, OK with pinned key `ASYuieG7nRUN7ecnLVGGUtoeLSER8KEwCq5qYmt1C3Cx` | same key, OK |
| Log head (seq 4, sha256 of last line) | `302a6a41f75b6cc926bd00a78f51acb77cf38e56c3c1c8b9f0005d55740277d3` | `7606cb75fb21edef17948c5d812d3b2dbd1a030620dde33e6c596cf30aca85a2` |
| Buyer USDC | 20.00 -> 19.25 | 19.25 -> 18.50 |
| Exit / checks | 0, "ALL CHECKS PASSED" | 0, "ALL CHECKS PASSED" |

Run 1's files and Liezeil's independent check of its log and five settle transactions are in [docs/evidence/real-run-2026-11-17/](evidence/real-run-2026-11-17/). Run 2's `RESULTS.md`, `verdicts.jsonl` and terminal output were sent to Liezeil but are **not yet committed** to the repo. Run 2 was made from a fresh clone following the README; at that time the README needed three outside steps (installing `server/` and `agent/` dependencies, exporting `FACILITATOR_DIR`, `python3` instead of `python`), which commit `deb2d15` then added to the README. That updated README has not been re-tested.

### Caveats (read before quoting any number)

- **The real bugs are in-sample.** They are ARVO's own crashing inputs for the cases the verifier was built and tested on. 6/6 shows the pipeline works; it says nothing about unseen real-world reports.
- **The fakes are hand-made by us** (`test-inputs/fake/`): a near-miss of a real input, random bytes, prose claiming a crash, an empty file, valid configs, deep nesting. None of them crashes the parser, so they are easy. They are not real spam or LLM-written reports.
- **The control run is weaker than one commit per bug.** Five of the six "fixed" images are the same later libucl commit `45997ad` (2022-01-06); the sixth is `8a0294f` (2025-06-04). So `reproduced` means "this input triggers the expected ASan error in libucl code on the pinned vulnerable build, and the crash is gone in a later libucl", not "this exact fix was applied". The `45997ad` build still has bug 42512369.
- **No genuine crash-on-both or flaky case exists in our data**, and none was faked. Every run in the backtest and both demos gave identical results across its 3 vulnerable runs.
- These results do not show that spam is stopped.

## 3. Known weaknesses

Project-wide (from CLAUDE.md's design rules):
- **A filter, not a judge.** `reproduced` only means the input crashed the pinned build. A human still has to triage it. `not_reproduced` only means this one build ran the input clean.
- **One library, one bug class, flat $0.25.** Six pinned libucl cases, all heap-buffer-overflow.
- **Money-path dependencies.** A skipped settle leaves the bond in escrow until the facilitator's abandon-close (about 7 to 10 minutes, observed on devnet); `settlement_pending` needs on-chain polling; the self-hosted facilitator keeps channels in memory and must not be restarted mid-run; a dedicated RPC is required.
- **Abuse limits are in memory** (64 KB input cap, per-wallet rate limit, at most 2 concurrent verifier runs, 60 s cap). `verify.py` itself does not limit concurrency; the server does.

From the verifier:
- **A real bug submitted against the wrong case loses its bond.** Backtest set C: 8 of 30 cross-case pairs forfeited, because that case's vulnerable build does not have the bug.
- **amd64 only.** The ARVO images are `linux/amd64`. On an arm64 Mac under emulation the containers were killed with exit 137, so the verifier returns `inconclusive` there: no forfeits, but also no real verification.
- **Only crash-style, input-reproducible bugs.** The proof must be an input file that makes libucl's harness crash under ASan. Logic bugs, bugs that need a network, a script or a specific build, and anything not detected by ASan are out of scope.
- **One expected error type per case.** A real crash of another type (for example the SEGV in set C) is `inconclusive`: the bond comes back, but the bug is not credited.
- **The four ARVO libucl cases that crash in bundled headers** (42487344, 42495584, 42501732, 42501839) were never pulled or run.
- **No real hanging input was tested.** Every timeout test used an induced `sleep 300`.

## 4. Security note

- **`verify.py` runs untrusted input.** It feeds a stranger's file to a C parser built with ASan. The restrictions above limit what that code can do. **The sandbox is not claimed to be escape-proof.** It uses Docker's default seccomp and AppArmor profiles, no `--ulimit` settings, and images we did not build ourselves (ARVO's, pinned by digest).
- **What was probed** (`scripts/sandbox_probes.sh`, amd64, 2026-11-17; verified by builder only, x86_64): 23 PASS, 2 WARN, 0 FAIL, 0 NOT-POSSIBLE. Network unreachable (only `lo`); root filesystem, `/etc`, `/out`, `/usr`, `/root`, `/in` and `/src` read-only; uid 1000 with all capabilities zero and NoNewPrivs=1; fork refused after 62 of 100 attempts (pids 64); killed at about 1,008 MiB (memory 1 GiB, exit 137); `/tmp` capped at 16 MiB; input mount read-only and the host copy unchanged; cgroup limits as configured. These are checks of the configured limits, not an escape test.
- **The two WARNs.** (1) `/dev/shm` is writable: Docker gives every container a 64 MiB in-memory `/dev/shm`, and `--read-only` does not cover it. A submitted input could write up to 64 MiB there; it never reaches the host disk and disappears with the container. Closing it would need `--shm-size` or a small `--tmpfs /dev/shm`; not done. (2) The image's own build-time environment variable names are visible inside the container; none is a secret.
- **The demo host holds keys (H-006).** In both real runs, untrusted inputs were verified on the same laptop that ran the payment server and facilitator, which held devnet-only, fake-money keys. The container itself receives no keys and no host paths (probe (d)). This is acceptable for a devnet demo only.
- **Docker access is powerful.** `verify.py` calls the `docker` CLI, so whatever runs it must be able to control the Docker daemon, which on Linux is equivalent to root on that host.
- **Intended deployment.** The maintainer runs the verifier on their own infrastructure, separate from any machine that holds payment keys. Never run submissions on a machine that holds real keys. Run `python3 verifier/verify.py --self-test` first on any new host, and do not take payments where it fails.
