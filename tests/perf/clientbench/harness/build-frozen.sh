#!/bin/sh
# build.sh <bench-dir-name> <tag> [extra scc flags...]
# Always goes through lab/scc.mjs, which runs guard.mjs first, so no build in
# this block can resolve provenance into C:.
#
#   sh build.sh bench-clientonly-unmasked cou-strict
#
# Writes  out/<tag>.log  and  out/<tag>/  (its OWN -o directory: two variant
# builds sharing an -o collide on the .ll path).
set -u
. <blocks>/clientbench/lab/env.sh || exit 1
DIR=$1; TAG=$2; shift 2
mkdir -p "$LAB/out/$TAG"
# -o is a FILE path, not a directory: lld-link refuses "Is a directory".
rm -f "$LAB/out/$TAG.log" "$LAB/out/$TAG.exit"
cd "$APP" || exit 1
START=$(date +%s)
node "$SCC" build "tree/packages/fake-server/$DIR/messaging.bench.ts" \
  --backend c --provenance-sources "$@" -o "$LAB/out/$TAG/messaging.bench.exe" \
  > "$LAB/out/$TAG.log" 2>&1
RC=$?
END=$(date +%s)
echo "BUILD_EXIT=$RC" >> "$LAB/out/$TAG.log"
echo "BUILD_SECONDS=$((END - START))" >> "$LAB/out/$TAG.log"
printf '%s\n' "$RC" > "$LAB/out/$TAG.exit"
