# Devpost draft (paste field by field; every TODO must be resolved or deleted before submitting)

Not yet fact-checked by FACT_CHECKER. Wording rules: docs/verified-facts.md. Do not add "first", "novel" or "stops spam".

## Project name
BugBond   (the repo and README currently say "Prove-It Bond": pick one name and use it everywhere)

## Short description (tagline)
An AI agent posts a refundable $0.25 bond over x402 on Solana with a bug report's proof file. A sandbox runs the proof and the bond is returned or kept based on whether the bug reproduces.

## About the project (paste into the Markdown box)

## Inspiration
Maintainers of widely used open source projects are drowning in low-quality, AI-generated vulnerability reports. curl's maintainer wrote when ending the project's bug bounty (effective January 31, 2026) that the share of submissions that were confirmed vulnerabilities fell from "somewhere north of 15%" in previous years to "below 5%" starting in 2025. Refundable deposits for bug reports are an existing idea (Cantina and Decred describe them, and a published proposal argues for them), but a human has to judge each report. We wanted to see how far a bond can go when the first filter is a machine: run the submitted proof and let the result decide the money.

## What it does
To submit a report, an agent calls our `POST /report` endpoint with a proof input file. The server answers HTTP 402 and asks for a flat $0.25 bond using the x402 `upto` payment scheme on Solana devnet. The agent signs and the USDC is escrowed on-chain before our handler runs. A sandbox then runs the proof against a pinned vulnerable build of one C library under AddressSanitizer:

- **reproduced:** three vulnerable runs show the expected ASan error with a stack frame in the library, and a fixed-build control run is clean. The bond is returned ($0 settled).
- **not reproduced:** three vulnerable runs are clean. The bond is forfeited ($0.25 settled).
- **inconclusive** (mixed results, timeout, sandbox error): the bond is returned.

The settle happens in the same HTTP request, so nothing depends on a maintainer acting later. The sandbox is a filter, not a judge: a human still triages reproduced reports.

## How we built it
- **Payments:** x402 `upto` on Solana devnet through a self-hosted facilitator (the upstream x402 example at a pinned commit), Express server, a dedicated RPC. Every error path (exception, crash, timeout) settles $0, the settle amount is clamped to the cap, and a `settlement_pending` result is polled on-chain before it is called a failure.
- **Agent:** a submitter agent that enforces its safety limits in code: $0.25 per report, a $2.00 session budget, an allowlist of our one endpoint, a human-approval prompt above a threshold, one bounded retry on rate limits, and a JSON-lines decision log.
- **Sandbox:** separate Docker containers with no network, CPU and memory limits, a read-only filesystem except scratch, a non-root user, and no secrets. Target: libucl, using prebuilt vulnerable and fixed ASan images from the ARVO dataset and libucl's OSS-Fuzz harness.
- **Abuse limits:** 64 KB input cap, at most 2 concurrent verifier runs, one request per 10 s per wallet, a 60 s hard cap.
- **Audit log:** every paid outcome is appended to an ed25519-signed, hash-chained log; a script verifies it. It cannot detect deletion of the last records unless the head hash is published elsewhere, and the README says so.

## Results so far
- Backtest on a Windows/x86_64 host (Person B): 6 of 6 real libucl bugs reproduced and none wrongly forfeited; 7 of 7 hand-made fake inputs forfeited; 30 real inputs sent against the wrong pinned case gave 17 reproduced, 8 forfeited and 5 inconclusive; 0 failures. The fakes are hand-made, not collected from the wild, and this does not show that spam is stopped.
- Payment path verified on Solana devnet against a stub verifier: refunds and forfeits settled and checked on-chain, including error paths, a concurrency cap and a rate limit.
- TODO(real run): real-verifier run through the payment server. Returned-bond transaction: TODO. Forfeited-bond transaction: TODO. Do not publish this section until the real transaction signatures exist.

## Challenges
- The ASan images are linux/amd64. On an Apple-silicon Mac they were killed under emulation (exit 137, no trace), so the real verifier runs on a teammate's x86_64 machine.
- If a settle cannot be confirmed, the server returns an error and the bond only comes back when the facilitator abandons the escrow, about 10 minutes later. We found this by testing it, and we list it as a limitation.
- The public devnet RPC rate-limited us, so everything runs on a dedicated RPC.
- Our backtest found no genuine flaky or crash-on-both case, so the demo does not show one. We did not fake one.

## What we learned
x402 `upto` lets the amount settled be anything from $0 up to the authorized cap, which is what makes a "return or keep" bond possible without a custom escrow program. Failure paths matter more than the happy path: a skipped settle strands the bond.

## What makes it different
Refundable bug-report deposits already exist. In the sources we checked (not an exhaustive search) we found no project that combines an agent-paid x402 `upto` bond on Solana, an automated AddressSanitizer reproduction, and a same-request settle that decides the refund. Related work we reviewed: Cantina deposits, Decred's bounty deposit, a published deposit proposal, Firedancer's non-refundable burn, x402r, Pact Network and ERC-8183 (see the README).

## Limitations
Most low-quality reports are written by humans pasting chatbot output, not by x402 agents. A $0.25 bond does not deter a committed spammer chasing a large bounty, and a sender can test locally first, so the bond mainly filters "didn't try". Only crash-style, input-reproducible bugs are covered. We self-host the facilitator and have not tested Coinbase's hosted one. The verifier executes untrusted input; in production it would run on the maintainer's own infrastructure, and we do not claim the sandbox is escape-proof.

## What's next
Multi-project support, maintainer-side verifier deployment, more bug classes than ASan crashes, and testing the hosted facilitator and settlement delays beyond 300 seconds.

## Built with (tags)
Solana, x402, USDC, TypeScript, Node.js, Express, Python, Docker, AddressSanitizer, C, libucl, ARVO, QuickNode, pnpm, Claude Code

## "Try it out" links
- GitHub: https://github.com/urvijagtap28/university-blockchain-hackathon2026   (TODO: confirm the repo is public and the default branch has the final code)
- Demo site: none. There is no hosted app: the demo is a one-command local run (`bash scripts/demo.sh`). Do not add a fake demo link.

## Video demo link
TODO: YouTube or Vimeo URL (Devpost field), under 3:00 and accessible to judges.

## Image gallery ideas (after the real run)
1. Architecture diagram from the README.
2. Terminal output of the demo run with the verdicts table.
3. Solana Explorer page for a returned-bond transaction and one for a forfeited-bond transaction.
4. The RESULTS.md table.
