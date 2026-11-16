# SPIKE NOTES: x402 `upto` on Solana devnet

Started 2026-11-16 ~16:50 EST. Devnet only. Keys in `.keys/` (gitignored).

## Step 0: Setup
- `node -v` -> v26.10.0 ; `npm -v` -> 11.19.1 ; `solana` NOT installed ; pnpm not installed.
- Downloaded https://release.anza.xyz/stable/install, read it (only downloads agave-install-init from release.anza.xyz), ran `sh install stable --no-modify-path`.
- `solana --version` -> solana-cli 4.3.2 (src:0f131d36; feat:c9ad34d2, client:Agave)
  (binary path: ~/.local/share/solana/install/active_release/bin, not on PATH)
- `solana config set --url devnet` -> OK
- Keypairs created: `.keys/buyer.json`, `.keys/seller.json`
  - buyer  = 2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA
  - seller = 8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib
- `solana airdrop 2 <buyer>` / `1 <seller>` -> "airdrop request failed. ... rate limit"
- retry `airdrop 1 <buyer>`, `0.5 <seller>` -> same failure. Balances: 0 SOL both.
- STATUS: BLOCKED on SOL (needs web faucet), and on devnet USDC (Circle faucet, browser).

## Step 1: Facilitator
- `curl https://api.cdp.coinbase.com/platform/v2/x402/supported` (guessed URL) -> HTTP 401 "Unauthorized" (needs CDP JWT).

## Step 1 (partial): facilitator support
- CDP `GET https://api.cdp.coinbase.com/platform/v2/x402/supported` -> 401 (JWT needed). URL itself is a GUESS, not yet confirmed against docs. `spike/supported.json` NOT yet produced.
- CDP docs (https://docs.cdp.coinbase.com/x402/seller/facilitator.md, saved in scratch/web/) state: "All three [exact, upto, batch-settlement] run on the EVM networks, and Solana supports exact and upto." (DOCS CLAIM, not yet observed via /supported)
- Public `GET https://x402.org/facilitator/supported` -> HTTP 200, saved `spike/supported_x402org.json`.
  OBSERVED: Solana devnet (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) = `exact` only. `upto` only for eip155:84532 (Base Sepolia). So the free public facilitator CANNOT do Solana upto.
  feePayer (exact, solana devnet) = CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5

## Step 2: spec + example (GATE PASSED)
- Repo: https://github.com/x402-foundation/x402 cloned to scratch/x402, HEAD = f0de923456b89b11a77a1609c4b84a780edd1bd2 (2026-11-16)
- Spec EXISTS: specs/schemes/upto/scheme_upto_svm.md (also scheme_upto.md, _evm, _xrpl). Note batch-settlement ALSO has an svm spec -> "batch-settlement is EVM-only" claim is stale.
- Packages: @x402/svm 2.31.0 (subpath `@x402/svm/upto/server|client|facilitator`), @x402/core, @x402/express, @x402/fetch (versions TBD at install).
- Examples: examples/typescript/servers/upto/index.ts (registers UptoSvmScheme on solana devnet, price "$0.10", env: SVM_ADDRESS, SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY (optional), FACILITATOR_URL, SVM_RPC_URL), examples/typescript/facilitator/upto/index.ts (self-hostable SVM+EVM upto facilitator, env SVM_PRIVATE_KEY), plus Go examples. Client example under examples/typescript/clients (TBD which one).
- On-chain: payment-channels program CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX is DEPLOYED on devnet (OBSERVED via `solana program show -u devnet`; upgradeable, authority 4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap, deployed slot 480232051). Same id also on mainnet (read-only query only).

### Spec summary (scheme_upto_svm.md; READ, not yet observed)
- Mechanism: NOT a plain SPL approve. Client signs an `open` tx on the payment-channels program that escrows `maxAmount` (USDC) in a channel PDA. Facilitator co-signs as fee payer + rent payer, broadcasts `open` at "deposit settle" BEFORE the resource is served.
- Settle: server signs an ed25519 voucher (receiverAuthorizer key) for actual amount; facilitator builds+sends `settle_and_seal` + `distribute` (pays payTo, refunds deposit-actual to client). Final tx sig returned in PAYMENT-RESPONSE.
- Settle for 0: ALLOWED, explicit. Voucher still required to authenticate; onchain uses has_voucher=0; full deposit refunded; `transaction` must be non-empty.
- Cap enforced: deposit == maxAmount pinned; facilitator rejects amount > maxAmount with `invalid_upto_svm_payload_settlement_exceeds_amount`.
- Never-settle / recovery: client calls `request_close` -> channel `Closing`, wait `withdrawDelay` (server-set, >0, SHOULD be >= maxTimeoutSeconds), then anyone `seal`, client `withdraw_payer` recovers deposit-settled. Facilitator may also abandon-close (zero charge, full refund) after `expiresAt`. During Closing only the facilitator can still settle with a voucher. NOT yet verified by observation. Client needs SOL for request_close/withdraw_payer fees (client is otherwise gasless).
- Fees: facilitator (feePayer) pays tx fees and channel PDA/escrow rent; rent returned to it at distribute/reclaim. Client pays only the USDC deposit. CDP charges $0.001/onchain tx after 1,000 free/mo (docs).
- Time: `expiresAt` signed into voucher, based on maxTimeoutSeconds; program enforces now < expiresAt for NONZERO vouchers. So the delay test (30s/60s) is bounded by maxTimeoutSeconds, and the server must also settle before expiresAt. Facilitator may reject maxTimeoutSeconds > its maxChannelLifetimeSecs.
- Trust note: delegating receiverAuthorizer to facilitator needs auth (SIWX/JWT/API cred); self-managed key needs SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY on server.

## BLOCKED: needs user (see below)

## Step 0 complete (after user used web faucets)
- OBSERVED `solana balance -u devnet`: buyer 2.5 SOL, seller 2.5 SOL.
- OBSERVED `spl-token accounts --owner buyer`: mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (Circle devnet USDC) balance 20, ATA EZeYSFNP5L4FZduB8ELvxD17FUcTQ9Fs28wPseNhWNzN
- No CDP key provided (.env absent) -> CDP-hosted facilitator NOT testable. Proceeding with repo's self-hosted upto facilitator (examples/typescript/facilitator/upto). Result is about scheme+SDK+program, NOT about CDP being live on devnet.

---
# FINAL REPORT (2026-11-16, ~16:50-17:20 EST, ~30 min)

## 1. Verdict
**USE UPTO** (self-hosted facilitator): on Solana devnet, partial and zero settles both worked, the cap was enforced, and 30 s and 60 s delays were tolerated, all verified on-chain.
Caveat: the CDP-hosted facilitator was NOT tested (no CDP key), and the free x402.org facilitator does NOT offer Solana upto. If you will not run your own facilitator, this verdict is unproven; fall back to Design B.

## 2. Test table
Cap 0.25 USDC unless noted. Facilitator = repo example run locally (fee payer FmT5...8LSaM). Balances verified via `spl-token balance` and RPC getTransaction, not client messages.

| # | Test | Expected | Actual | Observed / docs |
|---|---|---|---|---|
| 0 | Faucets | wallets funded | 2.5 SOL each, buyer 20 USDC (CLI airdrop rate-limited; user used web faucets) | Observed |
| 1a | CDP `/supported` | lists upto on solana devnet | NOT RUN: guessed URL returned 401, no key | Not tested. Docs claim yes (read) |
| 1b | x402.org `/supported` | n/a | Solana devnet = `exact` only; upto only Base Sepolia | Observed |
| 1c | Local facilitator `/supported` | upto on solana devnet | yes, extra.feePayer FmT5..., transactionVersions [0,1] | Observed |
| 2 | Spec/example exist | yes/no | spec `scheme_upto_svm.md`, TS server+facilitator examples, program deployed on devnet | Observed/read |
| 3 | Unmodified example, cap 0.10 random | 402 -> pay -> 200 | 402, 200, settled 0.088577; buyer -0.088577, seller +0.088577 | Observed |
| 4.1 | Full 0.25 | seller +0.25 buyer -0.25 | exactly that | Observed |
| 4.2 | Partial 0.10 | seller +0.10, buyer -0.10, rest refunded | exactly that (escrow 0.25 -> closed, refund 0.15) | Observed |
| 4.3 | Zero | accepted, full refund | landed on-chain: escrow 0.25 closed, buyer +0.25, seller +0. Client saw `settlement_pending` only because RPC returned 429 on confirmation polling | Observed (tx verified) |
| 5.1 | Over cap 0.30 | rejected | Rejected: "Settlement override amount 300000 ... exceeds the authorized maximum of 250000". Check fired in the resource-server middleware before the facilitator. SIDE EFFECT: deposit was already escrowed, buyer -0.25 until abandon-close | Observed (facilitator-side check read in spec only) |
| 5.2a | 30 s delay then settle 0.10 | succeeds | succeeded, 32.5 s request | Observed |
| 5.2b | 60 s delay then settle 0.10 | succeeds | succeeded, 61.9 s request | Observed |
| 5.3 | Never settle | funds recoverable | Two natural cases (a settle that failed on RPC 429; the over-cap case). In both the buyer's 0.25 stayed locked, then the facilitator's cleanup manager `abandon_close`d each about 7 min after open (expiresAt 300 s + 120 s grace + 30 s poll) and the full 0.25 returned to the buyer. Not tested: buyer-initiated `request_close` + `withdrawDelay` (900 s here) path | Observed (facilitator path); request_close = docs only |
| 5.4 | Fees | | Facilitator paid all tx fees and channel rent (buyer SOL delta 0 in every tx; facilitator -3.45M lamports at open, rent returned at close). Buyer pays only USDC deposit | Observed |
| 5.5 | CDP key | | Not required for x402.org or local facilitator; CDP untested | Not tested |

Final balances reconcile: buyer 19.361423 = 20 - (0.088577+0.25+0.10+0.10+0.10); seller 0.638577.

## 3. Versions and signatures
- x402 repo commit f0de923456b89b11a77a1609c4b84a780edd1bd2 (x402-foundation/x402, main as of 2026-11-16, built locally from the workspace)
- @x402/svm, @x402/express, @x402/fetch 2.31.0 (@x402/core built from same commit; version not captured). Node v26.10.0, pnpm 11.1.1, solana-cli 4.3.2
- Network solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1 (devnet). RPC: public api.devnet.solana.com (rate limited)
- USDC mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU. Program CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX
- Wallets: buyer 2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA, seller 8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib, facilitator FmT5TvNWkLQBsyJ1iFMiKtsTQVKbeSpodjqksmg8LSaM, receiver authorizer 86UssGu5rcNMEeNTfvFP7gwdobCP6jKrBDV3qYQqm1He
- Txs (explorer: https://explorer.solana.com/tx/<sig>?cluster=devnet; NOTE the CLI cannot decode these v1 txs, use RPC maxSupportedTransactionVersion=1):
  - Step 3 deposit 3DchXV5AHQupJJx7UCoAFU2rwgnC7ptij93eaB3jzBt5CvKkb6Xs8SqkS8m3EYD9H1K9doykNwWkVBuu94HeCTW7
  - Step 3 settle 0.088577 3NcrkygtTRv4YgFggmpHS19h7Xq4yyXCGopLRP1nqygaKGnPDaiWYEHfCXhPkMaJT7oMBdXL3zACbyMVomSvei3P
  - Full 0.25 5FaB3yEgiNq3W6zNMruPTA5avzg6ExjGXh96rW5pgFJtC2NX6DwPJNTjju6Ah2ot5eSY3CpomTuEvpUMRopP5hC6
  - Partial 0.10 5bgwTdWfmCvo43xi3e1sjcV9RufPvn7EeGHU3C55woPsMM9CyCq2wzQHdgamyp81bv8BpKaRoFfFuSXJtUisY1vg
  - Zero hg6Ec34wmYHiFYCKrTSsfpNuSiaEgdXNVMQedM22W54V6wZrcxKpZrXNJoxV7tKqGsFQvy7jHwN4mac9km5wjAi
  - 30 s delay 3fRC7ZVhtqqKGgnejAGdczKEBC895dAJFsgjYtS2XhMk2yLFSrGR9D2A2oX1oSNFqGiKeFwpQ4kMy2XVdxNuPF37
  - 60 s delay 418GpCqCGQLnrgj69sVoEnFfmnmAbZAFKoo86FbPgbt74L3qTKQem3tBHzaYzQ1zupRSwjcWfJ6LzSrHWSQPeu7D
  - Abandon-close (recovered stuck 0.25) 9Kk5hTi5LNCRZWq6yUgaTtmqrJNMjvDmdyVXoofcruKeH96qPzMA7PJavzRc9TeuSiWKoeZHbrSjJf3gNfo32FC
  - Abandon-close (over-cap case) m1HvUBz1RvrJzRyS2SiuK8BUDCT8wiv3e664nMayT4wDGfKGH8ngKziT4iHVyvyT1ZPBdn59LXFjpjmPPbtDgjs
- Modifications: spike-server.ts (copy of example server, cap $0.25, amount/delay from query string, port 4023) and spike-client.ts (unchanged copy). Step 3 used the unmodified example.

## 4. Unverified / failed, and what to do
- CDP hosted facilitator: untested. To resolve: create a CDP Secret API key, confirm the real `/supported` URL from the docs, check for `upto` on solana devnet, rerun with FACILITATOR_URL pointed there (the CDP SDK handles JWT auth).
- Reliability: the public devnet RPC returned 429 twice, causing one failed claim (funds locked ~7 min) and one false `settlement_pending`. Use a dedicated RPC (SVM_RPC_URL) for the facilitator and server.
- Buyer-initiated recovery (`request_close`, `withdraw_payer`) not run; recovery observed was facilitator-driven. With CDP you would depend on their cleanup policy, which I have not seen.
- Delay beyond maxTimeoutSeconds (300 s) not tested; the spec says nonzero vouchers must land before expiresAt. 60 s is the max verified.
- The over-cap rejection was observed in the resource-server middleware; the facilitator-side check is from the spec only.
- Design implications: the deposit is taken BEFORE the resource runs and settlement happens in the same HTTP request, so the sandbox check must finish inside that request (<~300 s) or the server must settle explicitly within expiresAt. Any server failure strands the bond for several minutes until abandon-close, so settle(0) on every error path.
- Facilitator operator needs SOL (spent ~0.0035 SOL per open, mostly recoverable rent) and must run the cleanup manager.
- The facilitator example uses in-memory channel storage (lost on restart).
- Secrets: devnet keys in `.keys/` and example `.env` files under scratch/x402/examples/typescript/*/ (devnet only; none committed; no git repo here).

## 5. README paragraph
We tested the x402 `upto` scheme on Solana devnet using x402-foundation/x402 at commit f0de923 (@x402/svm 2.31.0) with the repo's self-hosted upto facilitator and Circle devnet USDC. A 0.25 USDC cap escrowed in the payment-channels program settled correctly for the full amount, for 0.10 with the remainder refunded, and for 0 with a full refund, and a 0.30 settle on a 0.25 cap was rejected. Settlement still succeeded after 30 s and 60 s delays, and the facilitator, not the buyer, paid all SOL fees. When a settle failed, the escrow stayed locked until the facilitator's cleanup abandon-closed it about 7 minutes later and returned the full deposit. We did not test Coinbase's hosted CDP facilitator (the free x402.org facilitator offers Solana devnet `exact` only) or the buyer-initiated `request_close` path.
