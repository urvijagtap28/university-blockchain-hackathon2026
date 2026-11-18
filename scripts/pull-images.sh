#!/bin/sh
# Pulls the digest-pinned ARVO images that verifier/verify.py uses (verifier/cases.json).
# usage: sh scripts/pull-images.sh [--dry-run]     (--dry-run only lists the references)
# Needs python3 and docker. Pulls only references of the form n132/arvo@sha256:<64 hex>.
set -u
cd "$(dirname "$0")/.." || exit 2
DRY=0
case "${1-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  *) echo "usage: sh scripts/pull-images.sh [--dry-run]" >&2; exit 2 ;;
esac
refs=$(python3 -I - verifier/cases.json <<'PY'
import json, re, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
seen = []
for cid in sorted(d["cases"]):
    for side in ("vul", "fix"):
        ref = d["cases"][cid][side]["image"]
        if re.fullmatch(r"n132/arvo@sha256:[0-9a-f]{64}", ref) and ref not in seen:
            seen.append(ref)
print("\n".join(seen))
PY
) || { echo "could not read verifier/cases.json" >&2; exit 2; }
[ -n "$refs" ] || { echo "no digest-pinned images found" >&2; exit 2; }
rc=0
for ref in $refs; do
  if [ "$DRY" = 1 ]; then echo "$ref"; else
    echo "docker pull $ref"; docker pull "$ref" || rc=1
  fi
done
exit $rc
