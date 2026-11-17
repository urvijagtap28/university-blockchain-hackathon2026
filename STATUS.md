# Status (update after every milestone)

Last updated: Tue Nov 17 (payments hardened, submitter agent built; all verified on devnet against the STUB verifier only; real verifier still needs an amd64 host).

## Checklist
- [x] Environment check: macOS 26.6 arm64, node v26.10.0, npm 11.19.1, python3 3.14.7. docker 29.10.0 and pnpm 11.1.1 now present (checked 2026-11-16); gh not checked
- [x] Repo on GitHub (urvijagtap28/university-blockchain-hackathon2026); branches `main`, `sandbox` (Person B), `orchestrator-setup` (Person A, pushed)
- [x] Smoke test passed on the public RPC, running spike code from ~/upto-spike, not repo code. ($0 settle on devnet, 2026-11-16 18:19 ET. Deposit tx cg4eW131ZwxbUx2PtNyLNSnV5rZcbP572oudefLYTUPRChmBoDiXFPGDD2AGop1qBs3o2YfUNHWcS5hSGc176wA; settle tx 2BJgYDWZT7EWTfduwR4cGd7rt4JvJoGM37GRAbD1MzYejBMDBc2LGu79envuGNJ15KBzVmE3pNVqdxamJa9Hhhe7; both checked via RPC getTransaction, full 0.25 refunded, buyer SOL delta 0.)
  - Proven: self-hosted upto facilitator + spike server + spike client settle $0 on Solana devnet and refund the full deposit.
  - NOT proven: dedicated RPC (SVM_RPC_URL unset; spike hit 429s on the public RPC twice), CDP-hosted facilitator, any code in this repo (server/ and agent/ are empty), error-path settles, concurrent or repeated runs (one run only).
- [x] Stub verifier written and tested (verifier/verify.py, inputs in test-inputs/): fixed one-line JSON contract; ran it on 3 filenames -> not_reproduced / inconclusive / reproduced, plus bad verdict and missing file -> inconclusive. It routes on filename and emits "stub": true. NOT the real verifier: no Docker, ASan or control run.
- [x] Dedicated RPC configured (QuickNode devnet, $0 settle passed on it 2026-11-16 19:33 ET, tx 2geKqEpp...bqeU8; key rotated by user 2026-11-16, check-env OK); devnet SOL and USDC funded (buyer 19.36 USDC, 2.5 SOL)
- [x] Target library chosen: libucl via ARVO prebuilt images (n132/arvo:42482847-vul/-fix pulled, not built). See docs/DECISIONS.md.
- [x] GATE: verified by builder only (Person B, x86_64 Windows, native amd64): vul 3/3 heap-buffer-overflow at ucl_lex_json_string ucl_parser.c:1036 (frames in libucl), fix clean, ~4 s per verdict. NOT reproduced by us: QE on the Mac (arm64, QEMU emulation) gets exit 137, no trace. Cause is emulation. See BUILD_LOG.md.
- [x] verify.py returns all three verdicts with control run: verified by builder only (Person B, 34/34 tests, backtest 6/6 real reproduced, 7/7 hand-made fakes forfeited, on x86_64). Not run by us (Mac cannot). Server treats it as amd64-only.
- [x] /report endpoint against the stub/fake verifiers (BUILD_LOG.md): $0 settle on handler exception (incl. escaped throw), verifier timeout at the 60 s cap, bad output; settle clamped to cap; settlement_pending polling (45 s) verified only via a proxy simulating the pending status; concurrency cap 2 (3rd concurrent request got busy, settled $0); per-wallet rate limit 1/10 s (limited paid request settled $0); 64 KB cap (413). NOT done: real Docker verifier through the server, real settlement_pending from the facilitator, gate release after timeout on devnet. Unconfirmed settle returns 402 settle_failed and the bond only returns via facilitator abandon_close (~10 min).
- [x] Agent script (agent/): per-report cap, session budget, allowlist, approval prompt, 429/busy backoff, JSON-lines decision log; `node test/unit.ts` prints agent unit ok; devnet (stub): reproduced refund, not_reproduced forfeit, refusals before signing, approval n/y. NOT verified: prompt on a real interactive terminal, busy retry live, redirects against a real server, any non-localhost endpoint.
- [ ] Signed verdict log (Option A decided 2026-11-17: read verifier/cases.json; separate devnet-only signing key)
- [ ] OPTIONAL, only after real verifier, verdict log, demo runner and clean-machine test all pass: tiny static results page rendering RESULTS.md with explorer links to tx signatures (user wants it on the list; first on the cut list)
- [x] Backtest run, backtest/RESULTS.md generated (2026-11-16, f2af4bf): real bugs 6/6 reproduced, 0 wrongly forfeited; 7 hand-made fakes 7/7 forfeited; 30 cross-case real inputs 17 reproduced / 8 forfeited / 5 inconclusive; 0 failures. No genuine crash-on-both or flaky result found (not faked).
- [ ] One-command demo passes on a clean machine
- [ ] README complete
- [ ] Demo video (under 3:00)
- [ ] Devpost submitted

## Decisions made
- Target library: libucl, using ARVO (n132/arvo) vul/fix image pairs and libucl's OSS-Fuzz harness ucl_add_string_fuzzer (approved deviations, docs/DECISIONS.md). Original criteria: small C library, parser-style entry point reading a file, >=3 fixed memory bugs whose fix commits added a regression-test input, builds in minutes under ASan; switch immediately if it fights us).

## Open items
- Person A to choose: how the verdict log gets case ID + digests (docs/INTERFACES.md, Option A recommended: read verifier/cases.json; Option B: --meta-out).
- Person B: 6/6 libucl ARVO cases in ucl_parser.c/ucl_util.c/ucl_hash.c confirmed (3/3 vul, fix clean; docs/DECISIONS.md). verify.py done. Caveat: ARVO fix images are a later libucl version, not the per-bug fix commit (5 of 6 share 45997ad), so the control run means 'gone in a later libucl' (docs/DECISIONS.md). Next: backtest design. Not yet run: bundled-header cases, a real hanging input.
- Open human items: H-005 (Person B setting up WSL Ubuntu + Docker, has not yet run scripts/rerun_gate.sh). Resolved 2026-11-17: H-006 (B's laptop hosts the real verifier and the recorded run, with new devnet-only keys; untrusted proofs run on the same machine as those keys, README must say so), H-007 (libucl via ARVO approved, fix-image caveat accepted), H-003, H-004. Verdict log signer public key on the Mac (stub runs only): 6vYi5vh11HPCtFDiY7uCdwFt7shT3maXXPTen8PAFNGY; the demo host needs its own LOG_SIGNING_KEY. Demo set (2 real bugs + 3 hand-made fakes, demo/manifest.json) approved by user 2026-11-17; hand-made wording: random-bytes fake is a robustness check, not a model of LLM slop; RESULTS.md must disclose the 0-byte, 6 KB and 40 KB fakes were dropped from the demo (still in backtest). H-005 PASSED (B, WSL clean clone, f38958e: vul 3/3 heap-buffer-overflow ucl_parser.c:1036, fix clean, verify.py reproduced). B wallets funded (buyer 20 USDC + 0.5 SOL, seller 20 USDC, facilitator 1 SOL; mint 4zMMC9sr...DncDU checked in explorer).
- Spike used self-hosted facilitator; CDP-hosted facilitator untested (see docs/SPIKE_NOTES.md).
- Devnet tx signatures for README: stub-verifier runs only (server skeleton, BUILD_LOG.md); none yet from the real verifier, so no README-grade returned/forfeited pair.
- curl primary-source numbers: not fetched.
- Prior-art check: not done.

## Guardrails to implement
- DONE in server/ (stub refused unless ALLOW_STUB_VERIFIER=1, settled $0 on devnet, BUILD_LOG.md); still to re-test with the real verifier. /report must fail closed: if verifier output has `"stub": true` outside test mode, settle $0 and return an error. (verifier/verify_stub.py is the filename-routed stub; verifier/verify.py is real and never emits stub.)

## Next action
1. Person B: H-005 gate re-run on x86; answer H-006 and H-007.
2. On the amd64 host: real verifier through the server end to end, verdict log with case id and digests (docs/INTERFACES.md), QE sandbox security probes, three-verdict run (reproduced, forfeited, flaky/timeout).
3. Set AGENT_AUTO_APPROVE_USD=0.25 in .env for non-interactive demo runs.
4. Then: demo runner, README (Solana section, known weaknesses, unverified list), video. A stale facilitator on port 3000 was killed by mistake on 2026-11-17 (unused).
