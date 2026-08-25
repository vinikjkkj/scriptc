#!/bin/bash
set -u
. <blocks>/zapobench/lab/env.sh
# THE ORACLE IS NOT process.execPath: the harness spawns literal "node",
# resolved from PATH. PATH node is v22.18.0; the oracle is v25.9.0.
export PATH="<home>/AppData/Local/nvm/v25.9.0:$PATH"
export SCRIPTC_CACHE_DIR='<blocks>\zapobench\cache\gate'
export SCRIPTC_PROVENANCE_CACHE='<blocks>\zapobench\cache\gate\prov'
export ZIG_GLOBAL_CACHE_DIR='<blocks>\zapobench\zig-gate'
export ZIG_LOCAL_CACHE_DIR='<blocks>\zapobench\zig-gate'
export SCRIPTC_TEST_WORKERS=2
mkdir -p <blocks>/zapobench/cache/gate/prov <blocks>/zapobench/zig-gate
cd <blocks>/zapobench/wt || exit 1
"$NODE25" node_modules/vitest/vitest.mjs run \
  tests/harness packages/compiler/test packages/runtime/test \
  --exclude '**/coverage.test.ts' --exclude '**/differential.test.ts' \
  --exclude '**/llvm-differential.test.ts' \
  > <zapo-work>/zapobench-artifacts/raw/gate.log 2>&1
VITEST_EXIT=$?
echo "VITEST_EXIT=$VITEST_EXIT" | tee -a <zapo-work>/zapobench-artifacts/raw/gate.log
