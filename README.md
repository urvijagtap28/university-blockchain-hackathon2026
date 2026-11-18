# Prove-It Bond

A refundable $0.25 bond that an AI agent posts, over x402 on Solana devnet, when it submits a bug report to an open-source maintainer. A sandbox runs the report's proof against a pinned vulnerable build of one small C library. If the bug reproduces, or the sandbox cannot tell, the bond is returned. If the proof does not reproduce, the bond is forfeited.

Hackathon project: UBC 2026, track Agentic Payments & AI, Solana chain award. Devnet only, fake money only.

The sandbox is a filter, not a judge. A human still triages every `reproduced` report. We do not claim this proves spam is stopped.

## Contents

1. [The problem](#1-the-problem)
2. [How it works](#2-how-it-works)
3. [Architecture](#3-architecture)
4. [The sender agent and its safety limits](#4-the-sender-agent-and-its-safety-limits)
5. [The verifier and the three verdicts](#5-the-verifier-and-the-three-verdicts)
6. [Signed verdict log](#6-signed-verdict-log)
7. [How Solana is used](#7-how-solana-is-used)
8. [Results](#8-results)
9. [Devnet transaction signatures](#9-devnet-transaction-signatures)
10. [Setup and run](#10-setup-and-run)
11. [Security note](#11-security-note)
12. [Known weaknesses](#12-known-weaknesses)
13. [What was NOT verified](#13-what-was-not-verified)
14. [Related work](#14-related-work)
15. [Credits](#15-credits)

Status legend used below: **stub** means the payment path ran but the verdict came from a filename-routed fake (`verifier/verify_stub.py`), so it says nothing about any bug. **real** means the Docker/ASan verifier produced the verdict. Real-verifier evidence is in [docs/evidence/real-run-2026-11-17/](docs/evidence/real-run-2026-11-17/).

## 1. The problem

curl ended its bug bounty effective January 31, 2026. Its maintainer wrote that the share of submissions that were confirmed vulnerabilities fell from somewhere north of 15% in previous years to below 5% starting in 2025.

curl did not leave HackerOne. On March 1, 2026 it moved reports back to HackerOne, without a bounty.

Sources (read from the maintainer's own posts; a team member re-opened the links on 2026-11-17 and confirmed the end date, the "below 5%" line and the 87 confirmed vulnerabilities; see [docs/verified-facts.md](docs/verified-facts.md)):
- https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/
- https://daniel.haxx.se/blog/2026/02/25/curl-security-moves-again/

The idea here: a maintainer is not paid to read a report that cannot be shown to crash anything. If the sender must put up a small refundable bond that only comes back when the proof actually reproduces (or the sandbox cannot decide), then a report with no working proof costs its sender something. It is an experiment in using a payment as a cheap pre-filter. It does not decide whether a report is good.

## 2. How it works

One HTTP request carries the whole loop:

1. The sender agent `POST`s a proof file (an input file, at most 64 KB) to `POST /report`.
2. The server answers `402 Payment Required` with an x402 `upto` requirement: cap $0.25 USDC, `maxTimeoutSeconds` 300.
3. The agent checks its own limits, signs, and retries. The deposit ($0.25) is escrowed on Solana devnet before the handler runs.
4. The server writes the file to a temp path and runs `verifier/verify.py <file>` (hard cap 60 s).
5. The verdict decides the money, in the same request:
   - `reproduced`: settle $0, the full deposit goes back to the sender.
   - `inconclusive`: settle $0, the full deposit goes back.
   - `not_reproduced`: settle $0.25, the bond is forfeited to the receiver.
   - any error, timeout or exception: settle $0.
6. The server appends a signed record to the verdict log and returns `{verdict, detail, settledAtomic, ...}`.

The proof is an input file fed to a fixed harness that calls the library's parse entry point. It is not an arbitrary script and not report text. No report prose is part of the protocol.

Single-use: the verdict decides the money. Nothing depends on a later maintainer action.

## 3. Architecture

```
  sender agent (agent/)                         our server (server/)
  +-----------------------+   POST /report    +----------------------------+
  | cap, budget, allowlist| ----------------> | body cap 64 KB, rate limit |
  | approval, backoff,    | <---- 402 ------- | concurrency cap (max 2)    |
  | decision log          |   upto $0.25      |                            |
  |                       | -- signed auth -> |  x402 middleware           |
  +-----------------------+                   |   deposit settle (escrow)  |
                                              |            |               |
                                              |            v               |
                                              |  verifier call, 60 s cap   |
                                              |            |               |
                                              |            v               |
                                              |  final settle: $0 or $0.25 |
                                              |  (clamped to cap; $0 on    |
                                              |   every error path)        |
                                              |            |               |
                                              |  signed verdict log        |
                                              +------|-----|---------------+
                                                     |     |
                         facilitator (self-hosted)   |     |  python3 verifier/verify.py <file>
                         x402 upto example, :4022 <--+     v
                                 |              +--------------------------------+
                                 v              | Docker, per run: no network,   |
                       Solana devnet            | read-only FS + tmpfs, non-root,|
                       payment-channels         | 1 CPU, 1 GB, pids 64, timeout  |
                       program + USDC           |  3x VULNERABLE image (ASan)    |
                                                |  1x FIXED image (control)      |
                                                +--------------------------------+
```

Directories: `server/` (Express + `@x402/express`), `agent/` (sender), `verifier/` (`verify.py` real, `verify_stub.py` stub, `cases.json`), `demo/` and `scripts/` (one-command demo), `backtest/`, `test-inputs/`, `targets/libucl/inputs/`, `harness/`, `docs/`, `AGENTS/` (working notes).

## 4. The sender agent and its safety limits

`agent/` handles the 402, signs the `upto` authorization and submits. These limits are enforced in code (`agent/src/policy.ts`, `agent/src/agent.ts`), not by prompt. Unit tests: `cd agent && node test/unit.ts` (mocked fetch and signer; see BUILD_LOG.md, entry "SUBMITTER_AGENT").

| Limit | Behaviour |
|---|---|
| Per-report cap | Refuses any 402 that asks for more than `AGENT_PER_REPORT_CAP_USD` (0.25). |
| Session budget | `AGENT_SESSION_BUDGET_USD` (2.00). The worst case (the cap in the 402) is reserved before signing and released to the settled amount afterwards. If the outcome is unknown, the reservation stays. |
| Allowlist | Pays only the exact origin and path in `AGENT_ALLOWED_URL`. Refuses redirects. Does not use `wrapFetchWithPayment`, because that signs whatever a 402 asks. |
| Human approval | Amounts above `AGENT_APPROVAL_THRESHOLD_USD` (0.10, decision D-006 in AGENTS/DECISIONS.md) need approval. The demo opts in with `AGENT_AUTO_APPROVE_USD=0.25`, and the decision log then says `approval_auto`. Otherwise a y/N prompt; no TTY, EOF or anything but y/yes means no payment. |
| Backoff | On HTTP 429 or a `busy`/`rate_limited` verdict: at most one retry per report, `AGENT_RETRY_BUDGET` (3) per session, waiting `Retry-After` (+0.5 s, max 30 s). |
| Decision log | Every decision is a JSON line in `agent/decisions.log` (gitignored): URL allow/refuse, cap/budget refusals, reservation, approval, payment signed, settle result, retry. It holds a 16-hex report hash, amounts and tx signatures, never keys or payment headers. |

This is the agent's own log of what it decided. It is not the signed verdict log in section 6; do not conflate them.

Limits of the limits: budget and approval are client-side code. A compromised host holding the agent key can bypass them. The budget is in memory and resets per process. The agent trusts the server's reported settled amount when releasing its reservation (it does not check on-chain).

Verified (stub verifier, Solana devnet, dedicated RPC): reproduced -> $0 refund, not_reproduced -> $0.25 forfeit, a non-allowlisted URL refused with no network call, over-cap refused, budget refused, approval n / no answer / y, one live 429 backoff retry that succeeded. Details in BUILD_LOG.md. Not verified: the prompt on a real interactive terminal (only piped stdin tested), a live `busy`/`rate_limited` retry. The agent also ran in the real-verifier demo on Person B's laptop (section 8), which we did not reproduce.

## 5. The verifier and the three verdicts

Contract: `python3 verifier/verify.py <input_file>` prints exactly one line of JSON, `{"verdict": "...", "detail": "..."}`, exit code 0. The real verifier never emits `"stub": true`; the server refuses a stub-flagged answer unless `ALLOW_STUB_VERIFIER=1` (test mode) and settles $0.

Target: libucl (a C library), using prebuilt ARVO images (`n132/arvo`, pulled by digest from `verifier/cases.json`) and libucl's OSS-Fuzz harness `ucl_add_string_fuzzer`. Six cases are pinned: 42482847, 42482848, 42486194, 42490132, 42497487, 42512369, all heap-buffer-overflow. The server config chooses the case (`VERIFIER_CASE`), never the sender. See [docs/DECISIONS.md](docs/DECISIONS.md).

Sandbox flags per run (from docs/DECISIONS.md and docs/INTERFACES.md): no network, read-only filesystem plus tmpfs `/tmp`, non-root user, 1 CPU, 1 GB, pids 64, all capabilities dropped, no-new-privileges, named container killed on timeout, no secrets in the container.

| Verdict | Condition | Bond |
|---|---|---|
| `reproduced` | 3 of 3 vulnerable runs show the expected ASan error type with at least one stack frame in library source (not only the harness) AND the fixed-build control run is clean | returned ($0 settle) |
| `not_reproduced` | 3 of 3 vulnerable runs are clean | forfeited ($0.25 settle) |
| `inconclusive` | anything else: mixed results, wrong error type, timeout, sandbox error (including exit 137), crash on both builds, bad case id | returned ($0 settle) |

The server clamps the settle amount to the cap and settles $0 on any exception, crash, timeout or invalid verifier output.

Important caveat on the control run: the ARVO "fixed" image is a later libucl version, not the per-bug fix commit. Five of the six fixed images share libucl commit `45997ad`. So `reproduced` means "this input triggers the expected ASan error in libucl code on the pinned vulnerable build, and the crash is gone in a later libucl". A fixed image is also not bug-free: ARVO 42512369's input still crashes the `45997ad` build (`backtest/RESULTS.md`).

Platform: the images are `linux/amd64`. On an arm64 Mac they run under emulation and were killed with exit 137, so the verifier returns `inconclusive` there and never `not_reproduced`. The real verifier needs an amd64 host. Verifier tests: `python3 verifier/test_verify.py` (34 tests, run by Person B on x86_64 Windows per STATUS.md; not run by the author of this README).

## 6. Signed verdict log

Every paid `/report` outcome is appended to a JSON-lines file (`server/verdicts.jsonl`, gitignored). Each record holds: sequence number, hash of the previous line, sha256 of the proof bytes, case id, target and fix commits, both image digests, sha256 of `cases.json` and of the verifier file used, verdict, detail, settled amount, settlement status, tx signature, timestamp, signer public key and an ed25519 signature over the canonical JSON (separate devnet-only key, `LOG_SIGNING_KEY`, not a payment key). Format: [AGENTS/INTERFACES.md](AGENTS/INTERFACES.md).

Check a log: `cd server && node scripts/verify-log.ts <log> --pubkey <base58>` (exit 0 ok, 1 tamper).

What it shows: records were not edited, reordered or deleted from the middle (tested with tampered copies: bad signature and chain breaks detected), and all records were signed by one key (and the one you pinned).

What it cannot show:
- Tail truncation. Dropping the last N records leaves a valid chain. Fix: publish the head hash and sequence number somewhere else.
- That a record is true. The server holds the key and is trusted; the log is not independent proof the server told the truth.
- Replacement by a whole new log signed with another key, unless the checker pins the public key obtained out of band.
- That a request that was never paid or failed before payment did not happen: those are not logged.

Published head of the first real run (2026-11-17, [docs/evidence/real-run-2026-11-17/](docs/evidence/real-run-2026-11-17/)), so that tail truncation of that log is detectable:

- Signer public key (ed25519): `ASYuieG7nRUN7ecnLVGGUtoeLSER8KEwCq5qYmt1C3Cx`
- Head: seq 4 (5 records), sha256 of the last line, without its trailing newline: `302a6a41f75b6cc926bd00a78f51acb77cf38e56c3c1c8b9f0005d55740277d3`

We re-ran the checker on the committed log from our Mac: `OK: 5 records ... (pinned)`, and the last-line hash matches the one above. A final run for submission would have its own key and head; those would need to be published the same way.

## 7. How Solana is used

Payments use the x402 `upto` scheme on Solana devnet. The client signs an `open` transaction on a payment-channels program that escrows the 0.25 USDC maximum in a channel account. The facilitator co-signs as fee payer and broadcasts it before the handler runs. After the verdict, the server signs a voucher for the actual amount (0 or 250000 atomic units); the facilitator settles that amount to the receiver and refunds the rest to the sender. The sender pays only the USDC deposit; the facilitator pays fees and rent (docs/spike-findings.md, observed on devnet).

- Network: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet).
- Payment-channels program ID: `CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX`. This is the existing program the x402 `upto` scheme uses for its escrow channels; we do not deploy our own program. Our spike notes (docs/spike-findings.md) record that `solana program show -u devnet` showed a program with this ID deployed on devnet (upgradeable). The hackathon guide only says to list the program IDs a project uses; it does not name this ID, so its origin is our project brief and the spike observation, not the guide.
- USDC mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Checked in the Solana Explorer on devnet by the team on 2026-11-17.
- Dedicated RPC (`SVM_RPC_URL`, a devnet endpoint). The public devnet RPC returned HTTP 429 twice during the spike and caused one failed settle, so the server refuses to use it.
- Timing: `maxTimeoutSeconds` 300, verifier hard cap 60 s. If a settle returns `settlement_pending` it polls the RPC for that signature for up to 45 s before reporting failure.
- We run the facilitator ourselves (the x402 upto example). The free public x402.org facilitator does not offer Solana `upto` (observed 2026-11-16, docs/spike-findings.md). The Coinbase CDP-hosted facilitator is untested.

## 8. Results

### Real verifier: backtest

Full tables: [backtest/RESULTS.md](backtest/RESULTS.md) (real Docker/ASan verdicts, Windows 11 AMD64, commit `282056d`, 43 verify.py calls, 2.0-3.6 s each). This calls `verify.py` directly; no x402 payments were made in the backtest.

| Set | Inputs | reproduced (bond returned) | not_reproduced (bond forfeited) | inconclusive (bond returned) | failures |
|---|---|---|---|---|---|
| A. Real bugs, own case | 6 | 6 | 0 | 0 | 0 |
| B. Hand-made fakes, default case 42482847 | 7 | 0 | 7 | 0 | 0 |
| C. Real bug inputs vs a different case | 30 | 17 | 8 | 5 | 0 |

- Wrongly forfeited real bugs (set A): 0 of 6.
- Hand-made fakes judged reproduced (set B): 0 of 7.
- Failures: 0.

Read these with care:
- Set A is in-sample: ARVO's own crashing inputs for the cases the verifier was built on.
- Set B is hand-made by us (listed in `test-inputs/fake/`), not real spam, and the inputs are easy. They are labeled hand-made everywhere.
- Set C: 8 real-bug inputs were forfeited because the chosen case's vulnerable build ran them clean. A real bug sent against the wrong pinned build loses its bond. We did not investigate why each build is clean.
- Crash-on-both and flaky/timeout results were not produced and we did not fake them.

### Demo run: real verifier, one run

Full report: [docs/evidence/real-run-2026-11-17/RESULTS.md](docs/evidence/real-run-2026-11-17/RESULTS.md), generated by `demo/run.mjs` from the signed log [verdicts.jsonl](docs/evidence/real-run-2026-11-17/verdicts.jsonl) in the same folder. Run once, on 2026-11-17, by Person B on an amd64 laptop (WSL2 Ubuntu, Docker linux/amd64), `bash scripts/demo.sh --real`, exit 0, Solana devnet, dedicated RPC. The run was **not reproduced by us**; we checked its log and transactions afterwards (section 9).

| Outcome | Count |
|---|---|
| Reproduced (bond returned) | 2 |
| Not reproduced (bond forfeited) | 3 |
| Wrongly forfeited real bugs | 0 |
| Hand-made fakes judged reproduced | 0 |
| Inconclusive | 0 |
| Errors or failures | 0 |

Read this with care:
- The batch is 2 real-bug inputs (ARVO crashing inputs, in-sample) and 3 inputs we made by hand (a near-miss of a real input, 4096 random bytes, prose claiming an ASan crash). It is a small, hand-picked batch, not a sample of real-world reports. The fakes are hand-made inputs, not LLM-written reports; the random-bytes one is a robustness check, not a model of LLM slop.
- Four other hand-made fakes exist and were not in this batch (empty, config, deep nesting, large config); all seven are in the backtest above.
- Flaky/timeout and crash-on-both verdicts were NOT demonstrated, in the demo or the backtest.
- Buyer and receiver wallets are both ours, so a forfeit is a transfer between our own wallets, not a payment to a third party.
- These results do not show that spam is stopped.

### Demo run: real verifier, second run (final verify.py)

A second clean-machine `--real` run, 2026-11-17 20:49 to 20:51 ET, by Person B (WSL2 Ubuntu x86_64, Docker 29.9.3), with `verifier/verify.py` sha256 `1bd695e02decdd8557216ba69f6479154c14edd97af33af10d5f4d0bd6a9d432`: 2 real bugs reproduced, 3 hand-made fakes forfeited, 0 wrongly forfeited, 0 inconclusive, 0 errors; signed log OK with pinned key `ASYuieG7nRUN7ecnLVGGUtoeLSER8KEwCq5qYmt1C3Cx`, head seq 4, sha256 `7606cb75fb21edef17948c5d812d3b2dbd1a030620dde33e6c596cf30aca85a2`. Balances: buyer 19.25 -> 18.50 USDC, payTo 20.75 -> 21.50. Settle transactions are in section 9. Provided by Person B, not reproduced by us. TODO: evidence files are not in the repo yet; to be committed under `docs/evidence/`.

The first run above and the backtest used `verify.py` sha256 `8022c685...5465` (full: `8022c68553836304c5ef074631ed9afe767f0802e40992edb660379eab959465`). The final file differs only by a best-effort `docker rm -f` after a kill (section 11); it is not claimed to fix a bug.

The root `RESULTS.md` is gitignored: it is whatever the last local demo run wrote, and the earlier copy was from a stub run. Do not quote a root `RESULTS.md` as results. Stub-routed verdicts are payment-plumbing evidence only, never sandbox results.

## 9. Devnet transaction signatures

Explorer links use `https://explorer.solana.com/tx/<signature>?cluster=devnet`.

### Real verifier, first real run (2026-11-17, verify.py 8022c685...)

These are the **settle transactions** from the real-verifier run in section 8. The demo recorded settle transactions only, not the deposit (open) transactions.

Returned bond (verdict `reproduced`, settled 0):
- [`5ywoH1tfvzUcA6K1E6wcW1GXoS7tvq31213V6ujGF7GLvKLqepJm8nDZRT2ej46v8jWE6YekCwWMjtVE8XfdeFdb`](https://explorer.solana.com/tx/5ywoH1tfvzUcA6K1E6wcW1GXoS7tvq31213V6ujGF7GLvKLqepJm8nDZRT2ej46v8jWE6YekCwWMjtVE8XfdeFdb?cluster=devnet)
- [`4tBpapbJPsyWS3eNay3WSukmVkRPY1jhB35L5bDTwkg3GHLb5Ku26dnJDvmG1gwRbtzJXQ1KYQuArMbi6NNr1hwv`](https://explorer.solana.com/tx/4tBpapbJPsyWS3eNay3WSukmVkRPY1jhB35L5bDTwkg3GHLb5Ku26dnJDvmG1gwRbtzJXQ1KYQuArMbi6NNr1hwv?cluster=devnet)

Forfeited bond (verdict `not_reproduced`, settled 0.25 USDC):
- [`3wTyH7SaZWqnKwcqD6neJG8nCuz64enJDJpRUNUBH9vsY4W9iFayKtJ8scZ9qRi2pgPd2fjovT9wLwNvPUAcyHGL`](https://explorer.solana.com/tx/3wTyH7SaZWqnKwcqD6neJG8nCuz64enJDJpRUNUBH9vsY4W9iFayKtJ8scZ9qRi2pgPd2fjovT9wLwNvPUAcyHGL?cluster=devnet)
- [`22oAjCovvAtB8GThk4swBAknCQ69cR9hvmqUdSRZ1Y2kMJU8ax59b1d8KvLuNrjobHnFaopmZUArfZAdZwj5yBbs`](https://explorer.solana.com/tx/22oAjCovvAtB8GThk4swBAknCQ69cR9hvmqUdSRZ1Y2kMJU8ax59b1d8KvLuNrjobHnFaopmZUArfZAdZwj5yBbs?cluster=devnet)
- [`3eLGnyA4LgGBorY6mR9FF5t51nvxpp2K1ETqfpd52ybQ68nXbWJwHdAZSx8htTG4QxU9SiiRt2WQC4UJusbazzdi`](https://explorer.solana.com/tx/3eLGnyA4LgGBorY6mR9FF5t51nvxpp2K1ETqfpd52ybQ68nXbWJwHdAZSx8htTG4QxU9SiiRt2WQC4UJusbazzdi?cluster=devnet)

We checked all five by RPC `getTransaction` from our Mac on 2026-11-17: no transaction error; for the two returned-bond transactions the buyer wallet's USDC rose by 0.25 (refund from escrow); for the three forfeit transactions the receiver (payTo) wallet's USDC rose by 0.25. Both wallets are ours.

To verify yourself: `cd server && node scripts/verify-log.ts ../docs/evidence/real-run-2026-11-17/verdicts.jsonl --pubkey ASYuieG7nRUN7ecnLVGGUtoeLSER8KEwCq5qYmt1C3Cx`, then fetch each signature with `getTransaction` on a devnet RPC (set `maxSupportedTransactionVersion` to 1) or open the links above. Details: [docs/evidence/real-run-2026-11-17/README.md](docs/evidence/real-run-2026-11-17/README.md).

### Real verifier, second real run (2026-11-17 20:49 to 20:51 ET, verify.py 1bd695e0...)

Settle transactions as reported by Person B (confirmed on chain per B's run; not re-checked by us). All five signatures below are the `txSignature` values in the signed log from this run (we re-verified that log with the pinned key and recomputed its head hash from B's `verdicts.jsonl`, and each signature decodes to 64 bytes); we did not re-read the transactions on chain for this second run. TODO: evidence files to be committed under `docs/evidence/`.

Returned bond (reproduced, settled 0):
- `24RCWjKpgWDjGXFUMpduLy1Syw8uiheezu8BuiRRAF2hWPN85F9jGxQSmA2MFXQ5icQFjgy2GiFW6MY8F7KZw4Bm`
- `56qVSojh4Csyy8DVVzirAW9yBu3VucATDdUiMWANzWxRAoAwXV1X7NWhQHYLy69Mg2Nqy4CTz8T6S8rjr1Bzk47x`

Forfeited bond (not_reproduced, 0.25 USDC each):
- `436MsnJZoYy6DNwRKdKiNFwEnuhBjLENdzMqme6X4EcwMaaLHTFWpWqQu19v8BsREosfvjnptmymSx9GhttwTdkf`
- `5Q7yXhBfrDrDnauph8WJBGmh7uygsMyEPZMrLmcZ8EXaXTX2FtkfMjWgYa4WpkRRJp5cSpAhG9ufeUnv3E4wwCRM`
- `55E93tcrdotXEGHLFgaofGVEdMDVsLvwhToqpGpA37WTWo1MxtKU7pp1w5U53Vj94de1LZF4irrTkd2PwuHw3jLV`

### Stub-verifier payment-path evidence only (NOT sandbox results)

From BUILD_LOG.md entry "X402_PAYMENTS H-004 rerun" (stub verifier, repo .env, dedicated RPC; each checked by RPC getTransaction):
- Stub "reproduced", $0 settle, escrow refunded to buyer: `3BUWFfzEDNQRFZyjY9opdSmJ3aHjv1tGPHRf71HHeXcSzwDo7kR29HVwK2oC6fzecZaky5ayFA8JJpsETJUkH4Z5`
- Stub "not_reproduced", $0.25 settle, seller +0.25: `fpME7x1GvpA2JtLA6anMy4tqeNhDELHktTZkDM8tzG9qs2kExoqJ73y8JGQnKoDP277hPmET56JDRJgKW6kcDX1`

The earlier five-report stub demo batch is not checked in as results.

## 10. Setup and run

### Prerequisites

- Node v26.10.0 (the server and agent run `.ts` directly), pnpm 11.1.1, `python3` (Ubuntu has no `python` command; use `python3` everywhere).
  - Node: download the official linux-x64 tarball for v26.10.0 from <https://nodejs.org/en/download> (all releases: <https://nodejs.org/dist/>), check it with `sha256sum` against `ca70e9e349de048b9522abb3adc05b3bd6f43c5ffd3ec57916c7da292f59f022`, extract it, and put its `bin` directory on `PATH`. These exact steps were not tested from scratch.
  - pnpm: `npm install -g pnpm@11.1.1` (needs a user-writable npm prefix, or use `sudo`).
- For the **stub** demo: any machine, including an arm64 Mac.
- For the **real** verifier: an **amd64 (x86_64) host** with Docker, and the 12 `n132/arvo` images from `verifier/cases.json`, pulled by digest with `sh scripts/pull-images.sh` (`--dry-run` lists them; the dry run was checked on the Mac, a real pull was not, and it needs network). The demo's `--real` mode refuses on a non-amd64 Docker. Use `python3 -I verifier/verify.py --self-test` to check a host; it fails on our arm64 Mac (emulation), and if it fails on a host, do not take payments there.
- A dedicated devnet RPC URL (QuickNode and Helius free tiers were suggested; the team used a QuickNode devnet endpoint).
- Devnet SOL (facilitator fee payer) and Circle devnet USDC (sender wallet). Devnet only; never put real keys in this repo.

Tested on: these steps were run once, literally, on a machine that already had Node 26.10.0, pnpm 11.1.1 and the 12 ARVO images, with wallets and `.env` reused. First-time Node/pnpm/image installs, key generation and faucets are untested.

### Install dependencies (repo)

```
cd server && pnpm install --frozen-lockfile && cd ..
cd agent  && pnpm install --frozen-lockfile && cd ..
cp .env.example .env     # then fill it in; .env.example is the source of truth for variable names
node --env-file=.env scripts/check-env.mjs     # plain `node scripts/check-env.mjs` does not read .env and fails
```

### Facilitator at the pinned commit

We run the upstream x402 `upto` facilitator example, unmodified, at x402-foundation/x402 commit `f0de923456b89b11a77a1609c4b84a780edd1bd2` (packages `@x402/svm`, `@x402/core`, `@x402/express`, `@x402/fetch` 2.31.0):

These are the commands that worked for Person B on WSL2 Ubuntu (x86_64), and they were followed again on a fresh clone (see "Tested on").

```
mkdir -p ~/upto-spike/scratch && cd ~/upto-spike/scratch
git clone https://github.com/x402-foundation/x402
cd x402 && git checkout f0de923456b89b11a77a1609c4b84a780edd1bd2
cd examples/typescript
pnpm install     # exit 0
pnpm build       # exit 1, see note below
```

The `pnpm build` exit 1 is only because the unrelated `fullstack/next` example needs `FACILITATOR_URL`; `packages/core`, `mechanisms/svm` and `mechanisms/evm` built fine.

Tell the demo where this clone is, from our repo root, before running it:

```
export FACILITATOR_DIR=~/upto-spike/scratch/x402/examples/typescript/facilitator/upto   # use your clone's path
```

If `FACILITATOR_DIR` is unset, the scripts silently fall back to `$HOME/upto-spike/scratch/x402/examples/typescript/facilitator/upto`, which can be an old install. The demo preflight prints the directory it will use and refuses if it has no `index.ts`. Do not start the facilitator by hand for the demo: the demo starts and stops its own facilitator and server, and a leftover facilitator on port 4022 makes the preflight refuse. The manual start is only for standalone tests of the server or agent:

```
set -a; . ./.env; set +a
server/scripts/start-facilitator.sh      # uses FACILITATOR_DIR
```

The facilitator reads its keys from the shell environment loaded from the repo `.env`; nothing is copied into the facilitator folder. The script sets `PORT` for the facilitator process only (it listens on `FACILITATOR_PORT`, default 4022).

The facilitator keeps open channels in memory and runs its own cleanup manager. Do not restart it mid-demo.

### Environment variables

Copy `.env.example` to `.env` and fill it. Names (values are never printed or committed):

| Variable | Used by | Meaning |
|---|---|---|
| `SVM_RPC_URL` | server, facilitator | dedicated devnet RPC (https, ASCII); check with `node --env-file=.env scripts/check-env.mjs` |
| `SVM_ADDRESS` | server | receiver (payTo) public key |
| `SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY` | server | signs settle vouchers |
| `SVM_PRIVATE_KEY` | facilitator | fee payer, needs devnet SOL |
| `FACILITATOR_URL`, `FACILITATOR_PORT` | server, scripts | `http://localhost:4022`, 4022 |
| `SERVER_PORT` | server | default 4021 (the demo fixes 4021, 4022 and web 4030) |
| `WEB_PORT` | web app | default 4030 |
| `RATE_LIMIT_SECONDS`, `SETTLEMENT_POLL_SECONDS` | server | per-wallet spacing (default 10 s); how long to poll an unconfirmed settle (default 45, max 120) |
| `AGENT_SVM_PRIVATE_KEY` | agent | sender wallet, needs devnet USDC |
| `AGENT_ALLOWED_URL` | agent | the one endpoint it may pay, e.g. `http://localhost:4021/report` |
| `AGENT_PER_REPORT_CAP_USD`, `AGENT_SESSION_BUDGET_USD`, `AGENT_APPROVAL_THRESHOLD_USD`, `AGENT_AUTO_APPROVE_USD`, `AGENT_RETRY_BUDGET` | agent | see section 4 |
| `AGENT_LOG_PATH` | agent | decision log; default `agent/decisions.log` (the demo uses `demo/run/agent-decisions.log`) |
| `VERIFIER_CASE`, `VERIFIER_PYTHON`, `VERIFIER_TIMEOUT_SECONDS`, `VERIFIER_MAX_CONCURRENT`, `MAX_INPUT_BYTES` | server | case id, python, 60 s cap, concurrency (max 2), 64 KB cap |
| `LOG_SIGNING_KEY`, `LOG_PATH` | server | verdict log key (generate with `node server/scripts/gen-log-key.mjs`) and path; default `server/verdicts.jsonl`. The demo sets `demo/run/verdicts.jsonl` and the web app `web/run/<stub or real>/verdicts.jsonl`, whatever `LOG_PATH` says |
| `ALLOW_STUB_VERIFIER` | server | test only; never set for real runs |

`.env.example` is the source of truth for names. This table was derived from the code and AGENTS/INTERFACES.md; we did not diff it against `.env.example` (the author cannot read that file).

### Run the demo

```
bash scripts/demo.sh --preflight-only --stub   # checks env, balances, ports; starts nothing
bash scripts/demo.sh --real --preflight-only   # same, plus Docker arch, images and python for the real verifier
bash scripts/demo.sh --stub                    # any machine; about 1.5 to 2.5 minutes (84 s was measured on one clean --real run)
bash scripts/demo.sh --real                    # amd64 + Docker + ARVO images
```

It starts the facilitator and server, runs one agent process per report from `demo/manifest.json` (2 real-bug inputs and 3 hand-made fakes, 11.5 s apart to respect the 10 s per-wallet limit), stops both by PID, verifies the signed log with a pinned key, checks each tx by RPC and compares wallet balance changes to the log, then writes `RESULTS.md`. Exit 0 means every check passed. The demo spends 0.75 USDC between our own wallets per batch.

Status: `--stub` ran end to end twice on an arm64 Mac (BUILD_LOG.md, "DEMO_RUNNER") with all checks passing, plus negative tests (killed server, tampered log, deleted record, SIGINT, occupied port all fail loudly). `--real` ran once, on Person B's amd64 laptop, exit 0 (section 8); on our arm64 Mac it refuses at the Docker preflight (exit 2). We have not run `--real` ourselves.

Individual tests: `cd server && node test/unit.ts`, `node test/verdictlog.test.ts`; `cd agent && node test/unit.ts`; `python3 verifier/test_verify.py`.

TODO: STATUS.md still lists the clean-machine demo as unchecked; update it from Person B's report.

## 11. Security note

The verifier executes untrusted input (it runs a C parser on a stranger's file under ASan). The sandbox has the restrictions listed in section 5, but **we do not claim it is escape-proof.**

Intended deployment: the maintainer runs the verifier on their own infrastructure, split from the machine that holds payment keys. Never run submissions on a machine that holds real keys.

Our demo host does not follow that split: it runs proofs on the same machine as the payment server and facilitator, which hold devnet-only fake-money keys. This is acceptable for a demo and not for production. The container itself receives no keys.

Container flags were reviewed from the code and probed by `scripts/sandbox_probes.sh` and `scripts/sandbox_cap_test.sh --full`. Person B ran them on amd64 (WSL2, Docker 29.9.3) on 2026-11-17: probes 23 PASS, 2 WARN, 0 FAIL; cap test 8 PASS, 0 FAIL; no leftover containers (output in [docs/evidence/sandbox-amd64-2026-11-17/](docs/evidence/sandbox-amd64-2026-11-17/)). The two warnings are a writable 64 MiB in-memory `/dev/shm` and the image's own build-time env var names. These checks show that the configured limits held; they are not an escape test, and the sandbox is not claimed escape-proof. The profile is Docker's default seccomp/AppArmor. Both kill tests used an INDUCED hang (`sleep 300`); no real hanging libucl input exists, and the server's own 60 s cap with the real verifier was not tested. One open P2 finding: if `docker kill` after a timeout fails, `verify.py` swallows the `TimeoutExpired` and the container can outlive the call (`--rm` removes it only when it exits); Person B added a best-effort `docker rm -f` after the kill (commit 9be5ef4, merged into this branch in a541f90; `verify.py` sha256 is now `1bd695e0...`). Their test run on that version passed (34/34 end-to-end, cap test FAIL=0, no leftover containers; [docs/evidence/verify-rmf-2026-11-17/](docs/evidence/verify-rmf-2026-11-17/)), and the real demo run and the backtest in this repository were made with the earlier `verify.py` (sha256 `8022c685...`).

Abuse limits in code: 64 KB input cap (HTTP 413 before any deposit), per-wallet rate limit (1 request per 10 s), at most 2 concurrent verifier runs (over the cap returns `busy`, $0), 60 s hard cap. The limits are in memory and reset on restart.

## 12. Known weaknesses

- Most spam senders are probably humans pasting chatbot output, not x402 agents. This fits agent-to-agent reporting and would need adoption by senders. We have no data on this.
- A small bond does not deter a committed spammer chasing a large bounty.
- Senders can run the proof locally first, so the bond filters "did not try", not "tried and failed".
- Only crash-style, input-reproducible bugs (an ASan error from an input file). Logic bugs, auth bugs and anything needing a network or a script are out of scope.
- One library, six pinned cases. A real bug sent against the wrong pinned build is forfeited (backtest set C: 8 of 30 cross-case pairs).
- The control run is a later libucl version, not the exact fix commit (section 5).
- Self-hosted facilitator only. The Coinbase CDP-hosted facilitator is untested.
- Delays beyond `maxTimeoutSeconds` 300 are untested. The longest delay tested was a fake verifier sleeping 55 s (completed) and 90 s (cut off at the 60 s cap, settled $0); the real verifier takes about 2-4 s.
- If a settle cannot be confirmed, the server returns HTTP 402 and the bond is returned only by the facilitator's abandon-close, observed about 7 to 10 minutes later on devnet. We cannot settle $0 in that case because the facilitator never confirmed anything.
- Errors are returned as HTTP 200 on purpose, because the x402 middleware skips settlement for handler statuses of 400 or above.
- Buyer and receiver wallets are both ours in every run so far; a "forfeit" is a transfer between our wallets.
- The first real run was run by Person B on the same laptop that held the devnet keys, so untrusted proofs and keys shared a machine (section 11).
- The log is signed by the server we run; it is not third-party evidence.

## 13. What was NOT verified

Taken from STATUS.md, BUILD_LOG.md and the agents' files as of 2026-11-17.

- Reproducing the real-verifier demo run ourselves. It was run once by Person B on an amd64 laptop; we checked its signed log and its five settle transactions on-chain from the Mac (section 9) but did not run it. Deposit transactions were not recorded. Records are server-signed.
- The real verifier on this repo's arm64 Mac: it cannot run the amd64 images (QEMU exit 137; a Rosetta attempt failed, BUILD_LOG.md). The Phase 1 gate and `verify.py` tests (34) are "verified by builder only" (Person B, x86_64 Windows). Person B's WSL clean-clone gate re-run (H-005, f38958e) is recorded as passed in STATUS.md; we have not run it ourselves.
- The server's own 60 s cap and concurrency with the real verifier, and any escape attempt against the sandbox. The sandbox probes themselves ran on amd64 (see section 11); the kill tests there were induced hangs.
- Server-side 60 s cap and settle $0 on kill with the real verifier.
- The Coinbase CDP-hosted facilitator.
- Concurrency and repeated load on the real verifier (backtest ran one call at a time); the concurrency cap and rate limit were tested against the stub only.
- A genuinely hanging input for the real verifier (the timeout path was tested with a lowered cap in `verifier/test_verify.py`), a flaky result, and a crash-on-both result.
- The four ARVO libucl cases that crash in bundled headers (not pulled).
- A `settlement_pending` produced by the real facilitator. Simulated with a proxy, plus one real occurrence in the spike on the public RPC (BUILD_LOG.md). Every real settle failure being logged is also unverified: one real failure in an early build produced no log record and was not explained (D-013 fixed the code paths found by reading and later tests, but the exact original run was not reproduced).
- The y/N approval prompt on a real interactive terminal.
- Restart behaviour of the server and facilitator (channels are in memory).
- Buyer-initiated recovery (`request_close`, `withdraw_payer`); only facilitator-driven recovery was observed.
- The facilitator's abandon-close timing is from observation on devnet, not from documentation.
- The program ID against the hackathon rules page (section 7).
- Clean-machine setup: section 10 was run once on Person B's machine, which already had Node, pnpm and the images (see "Tested on" there). First-time installs, key generation and faucets, and the real `scripts/pull-images.sh` pull, are untested.
- Prior-art search: not exhaustive (section 14).

## 14. Related work

We have not done an exhaustive prior-art search, and we make no claim of novelty. Sources and quotes are in [docs/verified-facts.md](docs/verified-facts.md) (section 'Prior art / related work'); that is the only place to take wording from.

- Refundable deposits for bug reports are not a new idea. Cantina and Decred describe them, and a published proposal argues for them. Firedancer charges a non-refundable burn per submission, which is a fee, not a refundable bond.
- x402r and Pact Network add refunds to x402 payments. Prove-It Bond applies the x402 `upto` scheme, where the settled amount may be 0, to a bug-report bond.
- ERC-8183 is a draft Ethereum standard in which an evaluator releases or refunds an escrow. Ours is a Solana devnet prototype.
- Reproducing a crash from an input file under a sanitizer follows the OSS-Fuzz reproducer workflow, and our images come from the ARVO dataset.

In the sources checked we found no project combining an x402 `upto` bond, a sandboxed AddressSanitizer verdict and a same-request settle. The search is not exhaustive: we did not search academic literature, the Immunefi, HackerOne or Bugcrowd policy pages, or Solana-native escrow programs. Several details are marked UNVERIFIED in the facts file and are deliberately left out here.

## 15. Credits

- x402 and its public examples, from x402-foundation/x402. The facilitator we run is the upstream `examples/typescript/facilitator/upto` at commit `f0de923456b89b11a77a1609c4b84a780edd1bd2`. Our server and agent were adapted from the upstream upto server example and our spike code.
- libucl, the target library.
- The ARVO dataset (`n132/arvo` images) for the vulnerable and fixed libucl builds, and OSS-Fuzz's libucl harness.
- Circle devnet USDC for test funds.

Project notes: [STATUS.md](STATUS.md), [BUILD_LOG.md](BUILD_LOG.md), [docs/spike-findings.md](docs/spike-findings.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/INTERFACES.md](docs/INTERFACES.md).
