# Prove-It Bond

Hackathon project (UBC 2026, track: Agentic Payments & AI, chain award: Solana). A sender agent posts a $0.25 refundable bond over x402 `upto` (Solana devnet) with a proof input file. A sandbox runs it against a pinned vulnerable build of one small C library under AddressSanitizer (ASan). Reproduced or inconclusive: bond returned. Not reproduced: bond forfeited. The sandbox is a filter, not a judge; a human triages "reproduced" reports.

Deadline: Fri Nov 20, 12:00 PM CST (1:00 PM ET). Build target: done Wed Nov 18 night.

@STATUS.md

## How to work with us
- Team of 2
- Person A: x402, Solana, facilitator, agent client. Person B: Docker, ASan, harness, reproducers, backtest. Keep tasks parallelizable.
- Never claim something works unless you ran it and saw the output. After each milestone, report what you ran, the actual output, and anything unverified.
- If blocked >30 min, stop and report the exact error plus two options. Never silently expand scope.
- Log commands and outputs to BUILD_LOG.md. Commit after each milestone. Update STATUS.md after each milestone.
- If a fact about x402, Solana, or a facilitator drives a decision, verify by running it or against the docs, and say which. If you can't browse docs, ask us to paste them.
- Minimal dependencies, pinned versions. Devnet only. Never commit real keys.

## Architecture (decided)
- Server: Express + `@x402/express`, `POST /report`. 402 -> upto deposit ($0.25 cap, escrowed before the handler runs) -> verifier -> settle in the same request.
- Proof = an INPUT FILE fed to a fixed ~20-line C harness that calls the library's parse entry point. Not an arbitrary script.
- Verifier: `verify.py` invoking separate Docker containers (no network, CPU/mem limits, wall-clock timeout, read-only FS except scratch, non-root, no secrets). Two prebuilt ASan images: pinned VULNERABLE commit and FIXED commit.
- Verifier contract (fixed; the stub and the real verifier must match): `python verify.py <input_file>` prints exactly ONE line of JSON to stdout, `{"verdict": "...", "detail": "..."}`, where verdict is one of `reproduced`, `not_reproduced`, `inconclusive`. The real verifier must NOT emit `"stub": true`. The stub (`verifier/verify.py`) does emit it so the server can refuse it outside test mode.
- Verdicts:
  - reproduced: 3/3 vulnerable runs show the expected ASan error type with at least one stack frame in library source (not only the harness) AND the fixed-build control run is clean. Settle $0.
  - not_reproduced: 3/3 vulnerable runs clean. Settle full $0.25.
  - inconclusive: anything else (mixed, timeout, sandbox error, crash on both builds). Settle $0.
- Agent (`agent/`): handles the 402, signs the upto authorization, submits. Enforced in code: $0.25 per report, session budget ($2.00), allowlist of our one endpoint, human approval above a threshold, every decision logged.
- Log: append-only signed record per report (report hash, target commit, verdict, settled amount, tx signature, timestamp). Demo writes `RESULTS.md` from it.

## Money-path rules (non-negotiable)
1. `maxTimeoutSeconds` = 300. Hard cap 60 s for the whole verifier call, enforced by the server.
2. Settle $0 on EVERY error path (exception, crash, timeout). A skipped settle strands the bond ~7 min.
3. `settlement_pending` means check on-chain state, not failure. Poll before reporting failure.
4. Use a dedicated RPC via `SVM_RPC_URL` (QuickNode or Helius free tier). Never the public devnet RPC (429s).
5. Single-use authorization: the verdict decides the money. Nothing may depend on later maintainer action.
6. Self-hosted facilitator needs a funded devnet SOL key and its cleanup manager running. Channels are in memory: do not restart during the demo.
7. Keys only in gitignored env vars. Keep `.env.example` current.
8. Server clamps the settle amount to the cap before settling.
9. Abuse limits: 1-2 concurrent verifier runs, 64 KB input cap, per-wallet rate limit, 60 s hard cap.
- Fallback only if `upto` breaks and can't be fixed in ~1 hour: x402 `exact` into a vault wallet with server-sent refunds. Custodial; README must say so. It is a design change, not a cut.

## Scope (hard limits)
One small C library, one pinned vulnerable commit, one bug class (an ASan error), flat $0.25. NO reputation tiers, encrypted reports, multi-project support, maintainer approve/reject flow, custom escrow program, auth, or database.

## Security
The verifier executes untrusted input. Run it only in the keyless container. Never run submissions on a machine holding real keys. README says: production splits the verifier onto the maintainer's infrastructure; we do not claim the sandbox is escape-proof.

## Honesty rules for README, video, and Devpost text
- Hand-made fake reports are labeled hand-made. Report counts honestly (reproduced, forfeited, wrongly forfeited, inconclusive, failures). Never claim this proves spam is stopped.
- Verify every curl figure against curl's own announcement before quoting. Do not attribute objections to named people without a primary source.
- Do not claim novelty without a prior-art check. Known related work: x402r, ERC-8183, Pact Network.
- State what was NOT verified (see docs/spike-findings.md).

## Where to look (read on demand, not every session)
- `docs/spike-findings.md`: read before touching payments, facilitator, or settlement.
- `docs/hackathon.md`: read before README, video, or Devpost work.

## Cut order if behind
Web results page, then Solana memo, then maintainer-queue polish, then live payment in the demo (use a recorded devnet run; README still needs real devnet tx signatures). Never cut the sandbox verdicts or the honest backtest.