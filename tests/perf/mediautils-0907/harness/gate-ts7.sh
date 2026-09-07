#!/bin/bash
. <blocks>/mediautils-work/env.sh
cd <blocks>/mediautils || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== START $(date -Is)"
  timeout 6000 node node_modules/vitest/vitest.mjs run packages/compiler/test/ts7 2>&1
  echo "VITEST-EXIT=$?"
  echo "=== DONE $(date -Is)"
} > "<blocks>/mediautils-work/logs/gate-ts7.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "<blocks>/mediautils-work/logs/gate-ts7.log"
