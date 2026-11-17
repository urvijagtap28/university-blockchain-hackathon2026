#!/bin/sh
# Pre-commit secret grep over tracked + untracked (non-ignored) files. Prints file:line only, never the match.
cd "$(git rev-parse --show-toplevel)" || exit 2
files=$(git ls-files -co --exclude-standard | grep -v '^scripts/secret-grep.sh$')
hits=$(echo "$files" | xargs grep -InE '(-----BEGIN [A-Z ]*PRIVATE KEY|\[ *[0-9]{1,3}( *, *[0-9]{1,3}){60,}|quiknode\.pro/[A-Za-z0-9]{10,}|helius-rpc\.com/\?api-key=[A-Za-z0-9-]+|PRIVATE_KEY=[^ ]+)' 2>/dev/null | cut -d: -f1,2)
if [ -n "$(echo "$hits" | tr -d '[:space:]')" ]; then echo "SECRET-LIKE MATCHES (file:line):"; echo "$hits"; exit 1; fi
echo "secret grep clean"
