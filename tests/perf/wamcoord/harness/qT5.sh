#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QT5 START $(date -Is) -- diagnostics suite, generating the new fixture snapshot"
  timeout 5400 node node_modules/vitest/vitest.mjs run tests/harness/diagnostics.test.ts 2>&1 | tail -20
  echo "=== QT5 DONE $(date -Is)"
} > "$L/logs/qT5.log" 2>&1
