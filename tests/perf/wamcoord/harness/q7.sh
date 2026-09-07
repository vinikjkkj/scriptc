#!/bin/bash
# The default lane is untouched by construction (the gate is off by default).
# This asks the other half: IF the default were flipped, do the compiler's own
# provenance tests still pass? Run twice on the same tree, gate OFF then ON.
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
cd "$WT" || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q7 START $(date -Is)"
  for g in off on; do
    echo "########## provenance harness suite, gate=$g"
    if [ "$g" = on ]; then export SCRIPTC_PROVENANCE_AUTHORED_JS=1; else unset SCRIPTC_PROVENANCE_AUTHORED_JS; fi
    timeout 5400 node node_modules/vitest/vitest.mjs run tests/harness/provenance.test.ts tests/harness/provenance-alias-baseurl.test.ts tests/harness/provenance-dist-esm.test.ts tests/harness/provenance-transitive-subpath.test.ts 2>&1 | tail -45
    echo "VITEST-EXIT=$?"
  done
  echo "=== Q7 DONE $(date -Is)"
} > "$L/logs/q7.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q7.log"
