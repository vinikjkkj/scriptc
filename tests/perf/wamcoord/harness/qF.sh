#!/bin/bash
# Requirement 4: the suites that cover the files this block touched.
# provenance.ts is imported by index.ts and program.ts, so a break would be
# wide; the whitelist itself can only act when provenance sources are set.
# Scope: EVERY tests/harness suite plus every packages/* suite, MINUS the four
# corpus differential drivers, which are named as UNRUN in the report.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
FILES=$(ls tests/harness/*.test.ts | grep -vE "(^|/)(differential|windows-differential|linux-differential|llvm-differential)\.test\.ts$" | tr '\n' ' ')
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QF START $(date -Is)"
  echo "FILES-SELECTED $(echo $FILES | wc -w) of $(ls tests/harness/*.test.ts | wc -l) harness suites, plus packages/*"
  echo "EXCLUDED (named as unrun): differential llvm-differential windows-differential linux-differential"
  timeout 21600 node node_modules/vitest/vitest.mjs run $FILES "packages/compiler/src/**/*.test.ts" "packages/cli/src/**/*.test.ts" 2>&1 | tail -80
  echo "=== QF DONE $(date -Is)"
} > "$L/logs/qF.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qF.log"
