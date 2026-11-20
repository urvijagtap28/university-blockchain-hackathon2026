# BugBond

An AI agent posts a refundable $0.25 bond (x402 `upto`, Solana devnet) when it submits a bug report. A sandbox runs the report's proof input against a pinned vulnerable build of one C library (libucl) under AddressSanitizer. Reproduced or unclear: bond returned. Not reproduced: bond forfeited.

UBC 2026 hackathon, track Agentic Payments & AI, Solana chain award. Devnet only, fake money only.

The sandbox is a filter, not a judge. A human still triages every `reproduced` report. We do not claim this proves spam is stopped.

## Why

curl ended its bug bounty on January 31, 2026. Its maintainer wrote that confirmed vulnerabilities fell from north of 15% of submissions in earlier years to below 5% starting in 2025 ([source](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/)). curl then moved reports back to HackerOne without a bounty ([source](https://daniel.haxx.se/blog/2026/02/25/curl-security-moves-again/)).

The experiment: if a report must carry a small bond that only comes back when its proof reproduces, a report with no working proof costs its sender something.

## How it works

One request carries the whole loop:

1. The agent `POST`s a proof file (at most 64 KB) to `/report`.
2. The server answers `402` with an x402 `upto` requirement: cap $0.25 USDC, `maxTimeoutSeconds` 300.
3. The agent checks its own limits, signs, and retries. The deposit is escrowed on devnet before the handler runs.
4. The server runs `verifier/verify.py <file>` (hard cap 60 s).
5. The verdict settles the money in the same request. Any error, timeout or exception settles $0.
6. The server appends a signed record to the verdict log.

| Verdict | Condition | Bond |
|---|---|---|
| `reproduced` | 3/3 vulnerable runs show the expected ASan error with a frame in library source, and the fixed-build control run is clean | returned |
| `not_reproduced` | 3/3 vulnerable runs clean | forfeited ($0.25) |
| `inconclusive` | anything else (mixed, wrong error type, timeout, sandbox error, crash on both) | returned |

The proof is an input file fed to a fixed harness (libucl's OSS-Fuzz `ucl_add_string_fuzzer`), not a script and not report text. Targets are six pinned libucl ARVO cases (heap-buffer-overflow); the server config picks the case, never the sender. See [docs/DECISIONS.md](docs/DECISIONS.md).

Caveats:
- The ARVO "fixed" image is a later libucl version, not the per-bug fix commit. `reproduced` means the crash is gone in a later libucl.
- The images are `linux/amd64`. On an arm64 Mac they are killed under emulation (exit 137), so the verifier returns `inconclusive` there. The real verifier needs an amd64 host.

## The agent's limits

`agent/` enforces these in code, not by prompt: $0.25 per-report cap, $2.00 session budget, an allowlist of one endpoint (redirects refused), human approval above $0.10, 429/busy backoff, and a JSON-lines decision log with no keys in it. They are client-side, so a compromised host holding the agent key can bypass them. Tests: `cd agent && node test/unit.ts`.

## Signed verdict log

Each paid outcome is an ed25519-signed, hash-chained JSON line (proof hash, case, image digests, verdict, settled amount, tx signature). Check one with `cd server && node scripts/verify-log.ts <log> --pubkey <base58>`.

It detects edits, reordering and deletion from the middle. It cannot show tail truncation (so we publish the head below), that the server told the truth, or anything about unpaid requests. It is not third-party evidence.

First real run: signer `ASYuieG7nRUN7ecnLVGGUtoeLSER8KEwCq5qYmt1C3Cx`, head seq 4, last-line sha256 `302a6a41f75b6cc926bd00a78f51acb77cf38e56c3c1c8b9f0005d55740277d3`.

## Solana

x402 `upto` on devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`). The client escrows 0.25 USDC in a channel on the existing payment-channels program `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX` (we deploy no program). After the verdict the server signs a voucher for 0 or 250000 atomic units; the facilitator settles that to the receiver and refunds the rest. USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.

We run the upstream x402 `upto` facilitator ourselves, because the public x402.org facilitator has no Solana `upto`. The CDP-hosted facilitator is untested. A dedicated RPC (`SVM_RPC_URL`) is required; the public devnet RPC returned 429s.

## Results

### Backtest (real verifier, `verify.py` called directly, no payments)

Full tables: [backtest/RESULTS.md](backtest/RESULTS.md).

| Set | Inputs | reproduced | not_reproduced | inconclusive | failures |
|---|---|---|---|---|---|
| A. Real bugs, own case (in-sample) | 6 | 6 | 0 | 0 | 0 |
| B. Hand-made fakes | 7 | 0 | 7 | 0 | 0 |
| C. Real inputs vs a different case | 30 | 17 | 8 | 5 | 0 |

Set B is hand-made by us, not real spam, and easy. In set C, 8 real inputs were forfeited because the chosen build ran them clean: a real bug sent against the wrong pinned build loses its bond. Crash-on-both and flaky results were not produced.

### Demo run (real verifier, once, 2026-11-17)

Report: [docs/evidence/real-run-2026-11-17/RESULTS.md](docs/evidence/real-run-2026-11-17/RESULTS.md). Run by Person B on an amd64 laptop (WSL2, Docker); **we did not reproduce it**. 2 real bugs reproduced (bond returned), 3 hand-made fakes forfeited, 0 wrongly forfeited, 0 inconclusive, 0 errors. The batch is small and hand-picked; the fakes are hand-made, not LLM-written. Buyer and receiver wallets are both ours, so a forfeit is a transfer between our wallets.

### Devnet settle transactions from that run

Links: `https://explorer.solana.com/tx/<signature>?cluster=devnet`. These are settle transactions only; deposits were not recorded.

- Returned (`reproduced`, settled 0): [`5ywoH1tf…XfdeFdb`](https://explorer.solana.com/tx/5ywoH1tfvzUcA6K1E6wcW1GXoS7tvq31213V6ujGF7GLvKLqepJm8nDZRT2ej46v8jWE6YekCwWMjtVE8XfdeFdb?cluster=devnet)
- Forfeited (`not_reproduced`, settled 0.25): [`3wTyH7Sa…PUAcyHGL`](https://explorer.solana.com/tx/3wTyH7SaZWqnKwcqD6neJG8nCuz64enJDJpRUNUBH9vsY4W9iFayKtJ8scZ9qRi2pgPd2fjovT9wLwNvPUAcyHGL?cluster=devnet)

All five signatures, the on-chain checks and how to verify them are in [docs/evidence/real-run-2026-11-17/README.md](docs/evidence/real-run-2026-11-17/README.md).

## Run it

Prerequisites: Node v26.10.0, pnpm 11.1.1, Python 3, a dedicated devnet RPC, devnet SOL and USDC. The stub demo runs anywhere; `--real` needs an amd64 host with Docker and the `n132/arvo` images (`python verifier/verify.py --self-test` checks a host).

```
cp .env.example .env     # fill in; names documented there
bash scripts/demo.sh --preflight-only --stub
bash scripts/demo.sh --stub     # any machine, ~2.5 min
bash scripts/demo.sh --real     # amd64 + Docker + ARVO images
```

The demo starts the facilitator and server, submits 5 reports from `demo/manifest.json`, verifies the signed log and each transaction, and writes `RESULTS.md` (gitignored; never quote a stub run as results). Facilitator setup at the pinned x402 commit `f0de923456b89b11a77a1609c4b84a780edd1bd2`, and the full environment-variable table, are in [docs/README-full.md](docs/README-full.md). Do not restart the facilitator mid-demo: channels are in memory.

Tests: `python verifier/test_verify.py`, `cd server && node test/unit.ts`, `cd agent && node test/unit.ts`.

## Security

The verifier runs untrusted input in a container with no network, read-only filesystem, non-root user, 1 CPU, 1 GB, all capabilities dropped and no secrets. **We do not claim it is escape-proof.** Probes on amd64 passed (23 PASS, 2 WARN, 0 FAIL; [evidence](docs/evidence/sandbox-amd64-2026-11-17/)) but are not an escape test.

Production would run the verifier on the maintainer's infrastructure, split from any payment keys. Our demo host does not: proofs run on the same machine as the devnet-only keys.

Abuse limits: 64 KB input cap, 1 request per wallet per 10 s, 2 concurrent verifier runs, 60 s hard cap (all in memory).
