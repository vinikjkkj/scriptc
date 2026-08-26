#!/bin/bash
. /g/blocks/remeasure/lab/env.sh
export PATH="$NODE25:$PATH"
cd "$WT" || exit 1
echo "node: $(node --version)"
echo "SCRIPTC_TEST_WORKERS=$SCRIPTC_TEST_WORKERS"
echo "HEAD: $(git rev-parse --short HEAD)"
npx vitest run tests/harness packages/compiler/test packages/runtime/test \
  --exclude '**/coverage.test.ts' \
  --exclude '**/differential.test.ts' \
  --exclude '**/llvm-differential.test.ts'
VITEST_EXIT=$?
echo "VITEST_EXIT=$VITEST_EXIT"
