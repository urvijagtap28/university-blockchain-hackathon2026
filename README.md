# Prove-It Bond

Hackathon project (UBC 2026, Agentic Payments & AI, Solana). A sender agent posts a $0.25 refundable bond over x402 `upto` (Solana devnet) with a proof input file. A sandbox runs it against a pinned vulnerable build of one small C library under AddressSanitizer. Reproduced or inconclusive: bond returned. Not reproduced: bond forfeited. The sandbox is a filter, not a judge.

Status: setup. See [STATUS.md](STATUS.md). Full README to come.

## Layout
- `server/` Express + x402 `POST /report`
- `agent/` sender agent (budget, allowlist, approval)
- `verifier/` `verify.py` (currently a STUB) + Docker images; (test inputs in `test-inputs/`)
- `harness/` fixed C harness; `targets/` pinned library; `backtest/` historical reproducers
- `spike/` x402 `upto` spike logs and scripts; notes in `docs/`
