# Status (update after every milestone)

Last updated: Mon Nov 16 night (orchestrator: server skeleton merged, gate unverified on Mac).
Last updated: Mon Nov 16 night (F-001 VERIFY_TMPDIR, --self-test, merged orchestrator-setup on sandbox).

## Checklist
- [x] Environment check: macOS 26.6 arm64, node v26.10.0, npm 11.19.1, python3 3.14.7. docker 29.10.0 and pnpm 11.1.1 now present (checked 2026-11-16); gh not checked
- [x] Repo on GitHub (urvijagtap28/university-blockchain-hackathon2026); branches `main`, `sandbox` (Person B), `orchestrator-setup` (Person A, pushed)
- [x] Smoke test passed on the public RPC, running spike code from ~/upto-spike, not repo code. ($0 settle on devnet, 2026-11-16 18:19 ET. Deposit tx cg4eW131ZwxbUx2PtNyLNSnV5rZcbP572oudefLYTUPRChmBoDiXFPGDD2AGop1qBs3o2YfUNHWcS5hSGc176wA; settle tx 2BJgYDWZT7EWTfduwR4cGd7rt4JvJoGM37GRAbD1MzYejBMDBc2LGu79envuGNJ15KBzVmE3pNVqdxamJa9Hhhe7; both checked via RPC getTransaction, full 0.25 refunded, buyer SOL delta 0.)
  - Proven: self-hosted upto facilitator + spike server + spike client settle $0 on Solana devnet and refund the full deposit.
  - NOT proven: dedicated RPC (SVM_RPC_URL unset; spike hit 429s on the public RPC twice), CDP-hosted facilitator, any code in this repo (server/ and agent/ are empty), error-path settles, concurrent or repeated runs (one run only).
- [x] Stub verifier written and tested (verifier/verify.py, inputs in test-inputs/): fixed one-line JSON contract; ran it on 3 filenames -> not_reproduced / inconclusive / reproduced, plus bad verdict and missing file -> inconclusive. It routes on filename and emits "stub": true. NOT the real verifier: no Docker, ASan or control run.
- [x] Dedicated RPC configured (QuickNode devnet, $0 settle passed on it 2026-11-16 19:33 ET, tx 2geKqEpp...bqeU8; key rotated by user 2026-11-16, check-env OK); devnet SOL and USDC funded (buyer 19.36 USDC, 2.5 SOL)
- [x] Target library chosen: libucl via ARVO prebuilt images (n132/arvo:42482847-vul/-fix pulled, not built). See docs/DECISIONS.md.
- [ ] GATE: REPORTED passed by Person B on a Windows x86_64 box, NOT independently verified. QE on the Mac (arm64, Colima 8 GiB) could not reproduce: ASan harness exits 137 under amd64 emulation, test_verify 6/18, no trace or timing (BUILD_LOG.md). Needs a rerun on an x86_64 machine. Person B's report: ARVO 42482847 vul image gives heap-buffer-overflow in src/ucl_parser.c:1036 on a host-mounted input under no-network/read-only/non-root; fix image clean; harmless input clean on both.
- [ ] verify.py returns all three verdicts with control run: written by Person B (18/18 tests reported on their box); 6/18 on the Mac, unverified here. Stub is verifier/verify_stub.py. Stub moved to verifier/verify_stub.py.
- [ ] /report skeleton (server/) settled $0 and 0.25 on devnet against the stub incl. 3 error paths (BUILD_LOG.md); real verifier, handler-exception, concurrency, settlement_pending polling NOT done. /report endpoint settles $0 or full correctly, including error paths
- [ ] Agent script with budget, allowlist, approval limits
- [ ] Signed verdict log
- [x] Backtest run, backtest/RESULTS.md generated (2026-11-16, f2af4bf): real bugs 6/6 reproduced, 0 wrongly forfeited; 7 hand-made fakes 7/7 forfeited; 30 cross-case real inputs 17 reproduced / 8 forfeited / 5 inconclusive; 0 failures. No genuine crash-on-both or flaky result found (not faked).
- [ ] One-command demo passes on a clean machine
- [ ] README complete
- [ ] Demo video (under 3:00)
- [ ] Devpost submitted

## Decisions made
- Target library: libucl, using ARVO (n132/arvo) vul/fix image pairs and libucl's OSS-Fuzz harness ucl_add_string_fuzzer (approved deviations, docs/DECISIONS.md). Original criteria: small C library, parser-style entry point reading a file, >=3 fixed memory bugs whose fix commits added a regression-test input, builds in minutes under ASan; switch immediately if it fights us).

## Open items
- Person A to choose: how the verdict log gets case ID + digests (docs/INTERFACES.md, Option A recommended: read verifier/cases.json; Option B: --meta-out).
- Person B: 6/6 libucl ARVO cases in ucl_parser.c/ucl_util.c/ucl_hash.c confirmed (3/3 vul, fix clean; docs/DECISIONS.md). verify.py done. Caveat: ARVO fix images are a later libucl version, not the per-bug fix commit (5 of 6 share 45997ad), so the control run means 'gone in a later libucl' (docs/DECISIONS.md). Backtest done (backtest/RESULTS.md). Not yet run: bundled-header cases, a real hanging input.
- Open human items: H-006 where the real verifier runs (arm64 Mac cannot run the amd64 ASan images), `.env.example` port edit, repo `.env` keys (spike keys copied to keys/ by user).
- Spike used self-hosted facilitator; CDP-hosted facilitator untested (see docs/SPIKE_NOTES.md).
- Devnet tx signatures for README: stub-verifier runs only (server skeleton, BUILD_LOG.md); none yet from the real verifier, so no README-grade returned/forfeited pair.
- curl primary-source numbers: not fetched.
- Prior-art check: not done.

## Guardrails to implement
- DONE in server/ (stub refused unless ALLOW_STUB_VERIFIER=1, settled $0 on devnet, BUILD_LOG.md); still to re-test with the real verifier. /report must fail closed: if verifier output has `"stub": true` outside test mode, settle $0 and return an error. (verifier/verify_stub.py is the filename-routed stub; verifier/verify.py is real and never emits stub.)

## Next action
1. Decide H-006 (run real verifier on an x86_64 box vs try Rosetta on the Mac); rerun the gate there and record the ASan trace and timing against the 60 s cap.
2. Person B: push docs/SANDBOX_HANDOFF.md, add VERIFY_TMPDIR, cases.json. Person A: wire server/ to the real verifier with server-config --case, then agent/ with budget, allowlist, approval limits.
