#!/bin/sh
# One-command demo. Usage: bash scripts/demo.sh --stub | --real  (see demo/run.mjs for options)
cd "$(dirname "$0")/.." || exit 2
exec node demo/run.mjs "$@"
