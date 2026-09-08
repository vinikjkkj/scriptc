#!/bin/bash
# Requirement 4 again: lower-stmts.ts is the statement lowerer, so the same
# scope as before -- every tests/harness suite plus every packages/* suite,
# minus the four corpus differential drivers, which are named as unrun.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
FILES=$(ls tests/harness/*.test.ts | grep -vE "(^|/)(differential|windows-differential|linux-differential|llvm-differential)\.test\.ts$" | tr '\n' ' ')
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QT4 START $(date -Is)"
  echo "SELECTED $(echo $FILES | wc -w) harness suites plus packages/*"
  echo "UNRUN: differential llvm-differential windows-differential linux-differential"
  timeout 21600 node node_modules/vitest/vitest.mjs run $FILES "packages/compiler/src/**/*.test.ts" "packages/cli/src/**/*.test.ts" 2>&1 | tail -40
  echo "=== QT4 DONE $(date -Is)"
} > "$L/logs/qT4.log" 2>&1
