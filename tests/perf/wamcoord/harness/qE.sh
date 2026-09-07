#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
cd "$WT" || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QE START $(date -Is) -- the extended authored-JS suite"
  timeout 5400 node node_modules/vitest/vitest.mjs run tests/harness/provenance-authored-js.test.ts 2>&1 | tail -45
  echo "=== QE DONE $(date -Is)"
} > "$L/logs/qE.log" 2>&1
