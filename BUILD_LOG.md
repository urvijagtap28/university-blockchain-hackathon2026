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
