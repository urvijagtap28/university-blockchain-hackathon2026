#!/bin/sh
# Starts the spike/example upto facilitator. PORT is set inline for this one process only
# (never exported), so a stray shell PORT cannot move it. Port comes from FACILITATOR_PORT (default 4022).
# usage: FACILITATOR_DIR=<x402>/examples/typescript/facilitator/upto SVM_RPC_URL=... server/scripts/start-facilitator.sh
# The facilitator reads its own keys (SVM_PRIVATE_KEY) from its dir's .env via dotenv; do not restart mid-demo.
: "${FACILITATOR_DIR:=$HOME/upto-spike/scratch/x402/examples/typescript/facilitator/upto}"
cd "$FACILITATOR_DIR" || exit 1
PORT="${FACILITATOR_PORT:-4022}" exec pnpm exec tsx index.ts
