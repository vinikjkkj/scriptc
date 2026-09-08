#!/bin/bash
# analyse1.sh -- ONE analyse() pass over one entry, ANALYSE-LEVEL evidence only.
#   bash analyse1.sh <src-relative-to-$LAB/napp> <name> [flags...]
#
# analyse() is NOT a build. It stops before ir/validate.ts and before both
# emitters, so "0 blocker sites" from this script is not a binary and must
# never be reported as one. Pair every zero here with build1.sh.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh" || exit 1
cd "$LAB/napp" || exit 1
SRC="$1"; NAME="$2"; shift 2
SITES="$WT/tests/perf/storestatus/sites"
mkdir -p "$SITES" "$OUT"
echo "### analyse $NAME  src=$SRC  flags:[$*]  head=$(git -C "$WT" rev-parse --short HEAD)  node=$(node --version)"
t0=$(date +%s)
node "$HERE/sites.mjs" "$SRC" "$SITES/$NAME.json" "$@" 2>&1 | tee "$OUT/$NAME.analyse.log"
rc=${PIPESTATUS[0]}
echo "### analyse $NAME rc=$rc  $(($(date +%s) - t0))s  json=$(stat -c%s "$SITES/$NAME.json" 2>/dev/null || echo ABSENT)B"
