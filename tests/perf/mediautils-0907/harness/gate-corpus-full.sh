#!/bin/bash
# FULL corpus differential -- blast radius for the three lowering changes.
# Judged by counting corpus lines and failure markers, never by the exit code.
. ${BLOCKS_ROOT:-<blocks>}/mediautils-work/env.sh
cd ${BLOCKS_ROOT:-<blocks>}/mediautils || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "zig=$(zig version)  cc=$SCRIPTC_CC  target=$SCRIPTC_TARGET  workers=[${SCRIPTC_TEST_WORKERS:-unset}]"
  echo "=== START $(date -Is)"
  timeout 20000 node node_modules/vitest/vitest.mjs run tests/harness/differential.test.ts 2>&1
  echo "VITEST-EXIT=$?"
  echo "=== DONE $(date -Is)"
} > "${BLOCKS_ROOT:-<blocks>}/mediautils-work/logs/gate-corpus-full.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "${BLOCKS_ROOT:-<blocks>}/mediautils-work/logs/gate-corpus-full.log"
