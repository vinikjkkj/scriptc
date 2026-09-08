#!/bin/bash
# Q5: order- and caller-independence. Run all five provenance suites THREE ways
# on the same tree: default env, gate forced ON for the whole run, and the five
# files in reversed order. A file that leaks env or depends on order breaks here.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
cd "$WT" || exit 1
F="tests/harness/provenance.test.ts tests/harness/provenance-alias-baseurl.test.ts tests/harness/provenance-dist-esm.test.ts tests/harness/provenance-transitive-subpath.test.ts tests/harness/provenance-authored-js.test.ts"
R="tests/harness/provenance-authored-js.test.ts tests/harness/provenance-transitive-subpath.test.ts tests/harness/provenance-dist-esm.test.ts tests/harness/provenance-alias-baseurl.test.ts tests/harness/provenance.test.ts"
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QB START $(date -Is)"
  echo "########## 1/3 default env, declared order"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 5400 node node_modules/vitest/vitest.mjs run $F 2>&1 | grep -aE "Test Files|Tests |FAIL|×" )
  echo "########## 2/3 gate FORCED ON for the whole run"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; timeout 5400 node node_modules/vitest/vitest.mjs run $F 2>&1 | grep -aE "Test Files|Tests |FAIL|×" )
  echo "########## 3/3 reversed file order, default env"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 5400 node node_modules/vitest/vitest.mjs run $R 2>&1 | grep -aE "Test Files|Tests |FAIL|×" )
  echo "=== QB DONE $(date -Is)"
} > "$L/logs/qB.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qB.log"
