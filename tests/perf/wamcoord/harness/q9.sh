#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q9 START $(date -Is) -- all five provenance suites, DEFAULT env (gate unset)"
  timeout 5400 node node_modules/vitest/vitest.mjs run tests/harness/provenance.test.ts tests/harness/provenance-alias-baseurl.test.ts tests/harness/provenance-dist-esm.test.ts tests/harness/provenance-transitive-subpath.test.ts tests/harness/provenance-authored-js.test.ts 2>&1 | tail -25
  echo "=== Q9 DONE $(date -Is)"
} > "$L/logs/q9.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q9.log"
