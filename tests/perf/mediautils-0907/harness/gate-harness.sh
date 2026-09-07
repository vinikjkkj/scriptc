#!/bin/bash
# The suites that cover the files this branch touches: the child-stdio fixture
# (compiles and runs it -- the ICE lane analyze() cannot reach), its sibling
# stream fixture, and the node-types divergence manifest.
. <blocks>/mediautils-work/env.sh
cd <blocks>/mediautils || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== START $(date -Is)"
  timeout 6000 node node_modules/vitest/vitest.mjs run \
    tests/harness/child-stdio-node-types.test.ts \
    tests/harness/stream-node-types.test.ts \
    tests/harness/node-types-divergence.test.ts 2>&1
  echo "VITEST-EXIT=$?"
  echo "=== DONE $(date -Is)"
} > "<blocks>/mediautils-work/logs/gate-harness.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "<blocks>/mediautils-work/logs/gate-harness.log"
