#!/bin/sh
# build-llvm.sh <bench-dir-name> <tag> [extra scc flags...]
# The same build as build.sh with an EXPLICIT --backend llvm, so a program
# outside the LLVM tier FAILS with the construct named instead of silently
# emitting C and reporting a C-lane number as if it were both lanes.
set -u
. ${BLOCKS_ROOT:-<blocks>}/clientbench/lab/env.sh || exit 1
DIR=$1; TAG=$2; shift 2
mkdir -p "$LAB/out/$TAG"
rm -f "$LAB/out/$TAG.log" "$LAB/out/$TAG.exit"
cd "$APP" || exit 1
START=$(date +%s)
node "$SCC" build "tree/packages/fake-server/$DIR/messaging.bench.ts" \
  --backend llvm --provenance-sources "$@" -o "$LAB/out/$TAG/messaging.bench.exe" \
  > "$LAB/out/$TAG.log" 2>&1
RC=$?
END=$(date +%s)
echo "BUILD_EXIT=$RC" >> "$LAB/out/$TAG.log"
echo "BUILD_SECONDS=$((END - START))" >> "$LAB/out/$TAG.log"
printf '%s\n' "$RC" > "$LAB/out/$TAG.exit"
