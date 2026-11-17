# Devpost draft (paste field by field; every TODO must be resolved or deleted before submitting)

Not yet fact-checked by FACT_CHECKER. Wording rules: docs/verified-facts.md. Do not add "first", "novel" or "stops spam".

## Project name
BugBond   (the repo and README still say "Prove-It Bond": rename them to match before submitting)

## Tagline
An AI agent posts a refundable $0.25 bond with its bug report. A sandbox runs the proof and decides whether the bond comes back.

## About the project (paste into the Markdown box)

## Inspiration
Maintainers are flooded with low-quality, often AI-written bug reports. When curl ended its bug bounty (effective January 31, 2026), its maintainer wrote that confirmed vulnerabilities fell from "somewhere north of 15%" of submissions in earlier years to "below 5%" starting in 2025. Refundable deposits for reports exist already, but a person has to judge each report. We tried a machine as the first filter: run the attached proof and let the result decide.

## What it does
An agent submits a bug report with a proof file. The server asks for a $0.25 bond in USDC on Solana devnet via x402, held in escrow before anything runs. A sandbox then runs the proof against a vulnerable build of one C library (libucl) under AddressSanitizer:

- Bug reproduces: bond returned.
- Nothing happens: bond forfeited ($0.25).
- Error, timeout or unclear result: bond returned.

It all settles in one request. The sandbox only filters, and a person still reviews reproduced reports.

## How we built it
- **Payments:** x402 `upto` on Solana devnet, so the amount charged can be anything from $0 to the $0.25 cap. Express server, upstream x402 facilitator. Every error path returns the bond.
- **Agent:** enforces in code a $0.25 per-report cap, a $2.00 session budget, an allowlist of our one endpoint, human approval above a threshold, and a decision log.
- **Sandbox:** three runs on the vulnerable build and one on the fixed build, in Docker with no network, resource limits, a read-only filesystem and no secrets. Images come from the ARVO dataset.
- **Abuse limits:** 64 KB input cap, two concurrent runs, one request per 10 s per wallet, 60 s hard cap.
- **Log:** every paid report goes into a signed, hash-linked log with a verify script.

## Challenges we ran into
- The sandbox images are x86-only and were killed under emulation on an Apple-silicon Mac, so the real verifier runs on my teammate's x86 laptop.
- If a payment can't be confirmed, the bond returns only after the facilitator cleans up, about ten minutes later.
- The public devnet RPC rate-limited us, so we use a dedicated one.
- We found no genuine flaky or crash-on-both case, so the demo doesn't show one.

## Accomplishments that we're proud of
- Backtest on real libucl bugs: 6 of 6 reproduced, none wrongly forfeited. All 7 of our hand-made fakes forfeited (made up by us, so this doesn't show spam is stopped).
- Refunds, forfeits, error paths, the rate limit and the concurrency cap work on devnet, checked on-chain. These runs used a stub verifier.
- TODO (real run): a real bond returned and a real bond forfeited through the sandbox, with transaction links. Do not publish this section until we have them.

## What we learned
x402 `upto` gives a "return or keep" bond without a custom escrow program. Failure paths matter most: one skipped settle strands a bond.

## What's next for BugBond
- Run the verifier on a maintainer's own infrastructure, apart from the payment server. We don't claim the sandbox is escape-proof.
- More projects and bug types.
- Test Coinbase's hosted facilitator and delays beyond five minutes, neither tried yet.

## Built with (tags)
Solana, x402, USDC, TypeScript, Node.js, Express, Python, Docker, AddressSanitizer, C, libucl, ARVO, QuickNode, pnpm, Claude Code

## "Try it out" links
- GitHub: https://github.com/urvijagtap28/university-blockchain-hackathon2026   (TODO: confirm the repo is public and the default branch has the final code)
- No demo site: the demo is a one-command local run (`bash scripts/demo.sh`). Do not add a fake demo link.

## Video demo link
TODO: YouTube or Vimeo URL, under 3:00, accessible to judges.

## Image gallery ideas (after the real run)
1. Architecture diagram from the README.
2. Terminal output of the demo run with the verdicts table.
3. Solana Explorer page for a returned-bond transaction and one for a forfeited-bond transaction.
4. The RESULTS.md table.
