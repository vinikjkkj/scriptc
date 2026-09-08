#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q8 START $(date -Is) -- the new authored-JS regression suite"
  timeout 5400 node node_modules/vitest/vitest.mjs run tests/harness/provenance-authored-js.test.ts 2>&1 | tail -60
  echo "VITEST-EXIT=$?"
  echo "=== Q8 DONE $(date -Is)"
} > "$L/logs/q8.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q8.log"
