#!/bin/bash
# Requirement 4: the suites covering what the compound-assignment change touches.
# lower-exprs.ts is the expression lowerer -- it is under most of the harness --
# so the scope is every tests/harness suite plus every packages/* suite, MINUS
# the four corpus differential drivers, which are named as unrun.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
FILES=$(ls tests/harness/*.test.ts | grep -vE "(^|/)(differential|windows-differential|linux-differential|llvm-differential)\.test\.ts$" | tr '\n' ' ')
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QT3 START $(date -Is)"
  echo "SELECTED $(echo $FILES | wc -w) of $(ls tests/harness/*.test.ts | wc -l) harness suites, plus packages/*"
  echo "UNRUN: differential llvm-differential windows-differential linux-differential"
  timeout 21600 node node_modules/vitest/vitest.mjs run $FILES "packages/compiler/src/**/*.test.ts" "packages/cli/src/**/*.test.ts" 2>&1 | tail -60
  echo "=== QT3 DONE $(date -Is)"
} > "$L/logs/qT3.log" 2>&1
