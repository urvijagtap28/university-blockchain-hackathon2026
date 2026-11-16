# Status (update after every milestone)

Last updated: Mon Nov 16 evening (smoke test recorded).

## Checklist
- [x] Environment check: macOS 26.6 arm64, node v26.10.0, npm 11.19.1, python3 3.14.7. MISSING: docker, pnpm, gh (see Open items)
- [ ] Public repo created (local repo + spike files committed on branch `setup`; no remote yet, gh missing)
- [x] Smoke test passed on the public RPC, running spike code from ~/upto-spike, not repo code. ($0 settle on devnet, 2026-11-16 18:19 ET. Deposit tx cg4eW131ZwxbUx2PtNyLNSnV5rZcbP572oudefLYTUPRChmBoDiXFPGDD2AGop1qBs3o2YfUNHWcS5hSGc176wA; settle tx 2BJgYDWZT7EWTfduwR4cGd7rt4JvJoGM37GRAbD1MzYejBMDBc2LGu79envuGNJ15KBzVmE3pNVqdxamJa9Hhhe7; both checked via RPC getTransaction, full 0.25 refunded, buyer SOL delta 0.)
  - Proven: self-hosted upto facilitator + spike server + spike client settle $0 on Solana devnet and refund the full deposit.
  - NOT proven: dedicated RPC (SVM_RPC_URL unset; spike hit 429s on the public RPC twice), CDP-hosted facilitator, any code in this repo (server/ and agent/ are empty), error-path settles, concurrent or repeated runs (one run only).
- [ ] Dedicated RPC configured; devnet SOL and USDC funded
- [ ] Target library chosen; ASan images (vulnerable, fixed) built
- [ ] GATE: first real reproducer produces an ASan trace (if not tonight, STOP and report; fallbacks: Keyback or pay-by-accuracy labeling)
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
- Target library: TBD (criteria: small C library, parser-style entry point reading a file, >=3 fixed memory bugs whose fix commits added a regression-test input, builds in minutes under ASan; switch immediately if it fights us).

## Open items
- Install Docker Desktop (Person B, blocks ASan images) and pnpm (`npm i -g pnpm@<pinned>`), and gh or add remote manually.
- Spike used self-hosted facilitator; CDP-hosted facilitator untested (see docs/SPIKE_NOTES.md).
- Devnet tx signatures for README: none yet.
- curl primary-source numbers: not fetched.
- Prior-art check: not done.

## Next action
Install Docker + pnpm, add remote and push. Person A: configure dedicated RPC, port the spike server/client into server/ and agent/. Person B: choose target library.