#!/bin/sh
# usage: run.sh <label> <amount_atomic> [delay_secs]
export PATH="/Users/liezeil/upto-spike/scratch/tools/node_modules/.bin:$PATH"
L=$1; A=$2; D=${3:-0}
echo "##### $L amount=$A delay=$D  start=$(date +%T)"; echo BEFORE; /Users/liezeil/upto-spike/scratch/bal.sh
cd /Users/liezeil/upto-spike/scratch/x402/examples/typescript/clients/fetch
RESOURCE_SERVER_URL=http://localhost:4023 ENDPOINT_PATH="/api/generate?amount=$A&delay=$D" pnpm exec tsx spike-client.ts 2>&1 | grep -v Deprecation | grep -v trace-deprecation
echo "end=$(date +%T)"; echo AFTER; /Users/liezeil/upto-spike/scratch/bal.sh
