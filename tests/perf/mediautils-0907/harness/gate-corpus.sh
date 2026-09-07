#!/bin/bash
# Blast radius for the three lowering changes, by RUNNING the corpus: every
# program compiles and its native stdout/stderr/exit is compared against node.
# Sharded so the wall time is bounded and reportable; the shard is named in
# the log.
. <blocks>/mediautils-work/env.sh
cd <blocks>/mediautils || exit 1
SHARD="${1:-1/20}"
TAG=$(echo "$SHARD" | tr '/' '-')
{
  echo "ORACLE-NODE $(node --version)"
  echo "SHARD=$SHARD  zig=$(zig version)  cc=$SCRIPTC_CC  target=$SCRIPTC_TARGET"
  echo "SCRIPTC_TEST_WORKERS=[${SCRIPTC_TEST_WORKERS:-unset}]"
  echo "=== START $(date -Is)"
  SCRIPTC_TEST_SHARD="$SHARD" timeout 20000 node node_modules/vitest/vitest.mjs run \
    tests/harness/differential.test.ts 2>&1
  echo "VITEST-EXIT=$?"
  echo "=== DONE $(date -Is)"
} > "<blocks>/mediautils-work/logs/gate-corpus-$TAG.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "<blocks>/mediautils-work/logs/gate-corpus-$TAG.log"
