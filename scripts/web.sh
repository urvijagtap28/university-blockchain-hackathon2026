#!/bin/sh
# Local-only web app. Usage: bash scripts/web.sh --stub | --real [--preflight-only]
cd "$(dirname "$0")/.." || exit 2
exec node web/launch.mjs "$@"
