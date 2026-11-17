# Status (update after every milestone)

Last updated: Mon Nov 16 night (ARVO/libucl gate passed on sandbox branch).

## Checklist
- [x] Environment check: macOS 26.6 arm64, node v26.10.0, npm 11.19.1, python3 3.14.7. MISSING: docker, pnpm, gh (see Open items)
- [ ] Public repo created (local repo + spike files committed on branch `setup`; no remote yet, gh missing)
- [x] Smoke test passed on the public RPC, running spike code from ~/upto-spike, not repo code. ($0 settle on devnet, 2026-11-16 18:19 ET. Deposit tx cg4eW131ZwxbUx2PtNyLNSnV5rZcbP572oudefLYTUPRChmBoDiXFPGDD2AGop1qBs3o2YfUNHWcS5hSGc176wA; settle tx 2BJgYDWZT7EWTfduwR4cGd7rt4JvJoGM37GRAbD1MzYejBMDBc2LGu79envuGNJ15KBzVmE3pNVqdxamJa9Hhhe7; both checked via RPC getTransaction, full 0.25 refunded, buyer SOL delta 0.)
  - Proven: self-hosted upto facilitator + spike server + spike client settle $0 on Solana devnet and refund the full deposit.
  - NOT proven: dedicated RPC (SVM_RPC_URL unset; spike hit 429s on the public RPC twice), CDP-hosted facilitator, any code in this repo (server/ and agent/ are empty), error-path settles, concurrent or repeated runs (one run only).
- [x] Stub verifier written and tested (verifier/verify.py, inputs in test-inputs/): fixed one-line JSON contract; ran it on 3 filenames -> not_reproduced / inconclusive / reproduced, plus bad verdict and missing file -> inconclusive. It routes on filename and emits "stub": true. NOT the real verifier: no Docker, ASan or control run.
- [ ] Dedicated RPC configured; devnet SOL and USDC funded
- [x] Target library chosen: libucl via ARVO prebuilt images (n132/arvo:42482847-vul/-fix pulled, not built). See docs/DECISIONS.md.
- [x] GATE passed 2026-11-16 (Windows box): ARVO 42482847 vul image gives heap-buffer-overflow in src/ucl_parser.c:1036 on a host-mounted input under no-network/read-only/non-root; fix image clean; harmless input clean on both.
- [ ] verify.py returns all three verdicts with control run
- [ ] /report endpoint settles $0 or full correctly, including error paths
- [ ] Agent script with budget, allowlist, approval limits
- [ ] Signed verdict log
- [ ] Backtest run, RESULTS.md generated
- [ ] One-command demo passes on a clean machine
- [ ] README complete
- [ ] Demo video (under 3:00)
- [ ] Devpost submitted

## Decisions made
- Target library: libucl, using ARVO (n132/arvo) vul/fix image pairs and libucl's OSS-Fuzz harness ucl_add_string_fuzzer (approved deviations, docs/DECISIONS.md). Original criteria: small C library, parser-style entry point reading a file, >=3 fixed memory bugs whose fix commits added a regression-test input, builds in minutes under ASan; switch immediately if it fights us).

## Open items
- Person B: pull and test the other libucl ARVO cases (prefer ucl_parser.c/ucl_util.c/ucl_hash.c crashes); then write the real verify.py (Docker from Python, absolute Windows paths).
- Install Docker Desktop (Person B, blocks ASan images) and pnpm (`npm i -g pnpm@<pinned>`), and gh or add remote manually.
- Spike used self-hosted facilitator; CDP-hosted facilitator untested (see docs/SPIKE_NOTES.md).
- Devnet tx signatures for README: none yet.
- curl primary-source numbers: not fetched.
- Prior-art check: not done.

## Guardrails to implement
- /report must fail closed: if verifier output has `"stub": true` outside test mode, settle $0 and return an error. (verifier/verify.py is a filename-routed stub.)

## Next action
Install Docker + pnpm, add remote and push. Person A: configure dedicated RPC, port the spike server/client into server/ and agent/. Person B: choose target library.