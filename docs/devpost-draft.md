# Devpost draft (paste field by field; every TODO must be resolved or deleted before submitting)

Not yet fact-checked by FACT_CHECKER. Wording rules: docs/verified-facts.md. Do not add "first", "novel" or "stops spam".

## Project name
BugBond   (the repo and README still say "Prove-It Bond": rename them to match before submitting)

## Tagline
An AI agent posts a refundable $0.25 bond with its bug report. A sandbox runs the proof and decides whether the bond comes back.

## About the project (paste into the Markdown box)

## Inspiration
Open source maintainers get buried in low-quality bug reports, many written by AI. When curl ended its bug bounty (effective January 31, 2026), its maintainer wrote that the share of reports that turned out to be real vulnerabilities fell from somewhere north of 15% in earlier years to below 5% starting in 2025.

Asking reporters to put down a refundable deposit is an old idea, and some programs already do it. But a person still has to read every report to decide who gets the money back. We wondered what happens if the first check is a machine: run the proof the sender attached, and let the result decide.

## What it does
An agent sends a bug report to our server with a proof file. The server asks for a $0.25 bond, paid in USDC on Solana devnet using the x402 payment protocol. The bond is held in escrow before anything runs.

Then a sandbox runs the proof against a vulnerable build of one C library (libucl) with AddressSanitizer turned on:

- If the bug reproduces, the bond goes back to the sender.
- If the input does nothing, the sender loses the $0.25.
- If something goes wrong or the result is unclear, the bond goes back.

Everything happens in one request, so nobody has to approve anything later. The sandbox only filters. A person still reviews the reports that reproduce.

## How we built it
- **Payments:** x402's `upto` scheme on Solana devnet, which lets us charge anything from $0 up to the $0.25 we escrowed. The server is Express and the facilitator is the upstream x402 example. Any error, crash or timeout returns the full bond.
- **The agent:** a script that pays and submits for us. Its limits are enforced in code: $0.25 per report, a $2.00 budget per session, only our own endpoint, a prompt for human approval above a threshold, and a log of every decision it makes.
- **The sandbox:** each proof runs three times against the vulnerable build and once against a fixed build, all in Docker containers with no network, limited CPU and memory, a read-only filesystem and no secrets. We used prebuilt libucl images from the ARVO dataset.
- **Abuse limits:** a 64 KB input cap, two verifier runs at a time, one request per 10 seconds per wallet, and a 60 second hard cap.
- **A signed log:** every paid report is written to a signed, hash-linked log that a script can check.

## Challenges we ran into
- The sandbox images only run on x86 machines. On an Apple-silicon Mac they were killed under emulation, so the real verifier runs on my teammate's x86 laptop.
- If a payment can't be confirmed, the bond only comes back when the facilitator cleans up the escrow, about ten minutes later. We found this by testing it, so we list it as a limitation.
- The public devnet RPC kept rate-limiting us, so we moved to a dedicated one.
- We looked for a flaky or crash-on-both-builds example and didn't find a genuine one, so our demo doesn't show one. We didn't make one up.

## Accomplishments that we're proud of
- Backtested on real libucl bugs: all 6 reproduced and none were wrongly forfeited. All 7 of our hand-made fake inputs were forfeited. The fakes are made up by us, so this doesn't show spam is stopped.
- The payment path works on devnet. We checked refunds, forfeits and the error cases on-chain, along with the rate limit and concurrency cap. These runs used a stub verifier.
- TODO (real run): a real bond returned and a real bond forfeited through the sandbox, with both transaction links. Do not publish this section until we have them.
- We wrote down what we did not verify instead of hiding it.

## What we learned
x402's `upto` makes a "return or keep" bond possible without writing our own escrow program. We also learned that the failure paths matter more than the happy path, since one skipped settle leaves someone's bond stuck.

## What's next for BugBond
- Let a maintainer run the verifier on their own infrastructure, separate from the payment server. Running other people's input on a machine next to keys isn't safe, and we don't claim our sandbox is escape-proof.
- Support more than one project and more kinds of bugs.
- Test Coinbase's hosted facilitator, which we haven't tried, and settlement delays beyond five minutes.

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
