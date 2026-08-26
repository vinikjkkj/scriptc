#!/bin/bash
# The gate, under node v25.9.0, with vitest's own exit code captured into its
# OWN variable immediately (a later command's status is not the gate's).
#   $1 = output tag
. /g/blocks/wamvoip/env.sh
cd "$WT" || exit 1
TAG="${1:-gate}"
export PATH="$NODE25:$PATH"
mkdir -p "$LAB/out"
{
  echo "START $(date +%T)"
  echo "node   $("$NODE25/node.exe" --version)"
  echo "SCRIPTC_CC=$SCRIPTC_CC SCRIPTC_TEST_CC=$SCRIPTC_TEST_CC SCRIPTC_TEST_WORKERS=$SCRIPTC_TEST_WORKERS"
} > "$LAB/out/$TAG.log"

"$NODE25/node.exe" "$NODE25/node_modules/npm/bin/npx-cli.js" vitest run \
  tests/harness packages/compiler/test packages/runtime/test \
  >> "$LAB/out/$TAG.log" 2>&1
VITEST_EXIT=$?
echo "VITEST_EXIT=$VITEST_EXIT  $(date +%T)" >> "$LAB/out/$TAG.log"
