# server/ : POST /report skeleton (X402_PAYMENTS)
Express + @x402/express (upto, Solana devnet). Adapted from the x402 upto server example and our spike server.
Pinned: @x402/core|express|fetch|svm 2.31.0, express 4.22.3, pnpm 11.1.1, Node v26 (runs .ts natively, no build).

Flow: body parser (64 KB cap, 413 before any deposit) -> 402 / upto deposit ($0.25, maxTimeoutSeconds 300) -> writes body to a temp file -> `python3 verifier/verify.py <file>` (60 s hard cap, SIGKILL) -> settle override -> 200.
Settle map: reproduced 0, inconclusive 0, not_reproduced 250000 atomic; clamped to the cap. Any exception, timeout, bad/multi-line JSON, bad verdict, or `"stub": true` (unless ALLOW_STUB_VERIFIER=1) => verdict "error", settle 0.
Errors respond HTTP 200 on purpose: @x402/express skips settlement when the handler status is >= 400.

Run (facilitator must already be up on 4022, started with PORT=4022 explicitly):
    cd server && pnpm install
    ALLOW_STUB_VERIFIER=1 pnpm start            # reads ../.env; port = SERVER_PORT (default 4021), NOT PORT
    node --env-file=../.env test/client.ts ../test-inputs/real_bug.bin real_bug.bin   # buyer key = AGENT_SVM_PRIVATE_KEY
    node test/unit.ts                           # pure decision tests
Env needed: SVM_ADDRESS, SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY, SVM_RPC_URL (dedicated; public devnet RPC refused), FACILITATOR_URL, optional SERVER_PORT, MAX_INPUT_BYTES, VERIFIER_TIMEOUT_SECONDS (capped at 60), VERIFIER_PATH, ALLOW_STUB_VERIFIER.
With ALLOW_STUB_VERIFIER=1 the header `x-test-filename` picks the temp filename (the stub routes on filename). TEST ONLY.
Not done here: rate limit, concurrency cap, verdict log, settlement_pending polling, agent.

Ports (per human update): SERVER_PORT=4021 (this server), FACILITATOR_PORT=4022. `server/scripts/start-facilitator.sh` sets PORT=$FACILITATOR_PORT inline for the facilitator process only. FACILITATOR_URL stays http://localhost:4022. This server never reads PORT.
