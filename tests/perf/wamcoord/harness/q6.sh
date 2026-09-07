#!/bin/bash
# Blast radius of the gate on a package that is NOT wam: store-mysql, whose
# island note names mysql2/promise -- the other authored-JS entry the
# provenance code comment calls out by name. Paired, same compiler, same host.
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q6 START $(date -Is)"
  echo "--- store-mysql lane A, gate OFF (pkgstatus recorded 46 sites)"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/store-mysql.ts" "$L/sites/M-off.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "--- store-mysql lane A, gate ON"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/store-mysql.ts" "$L/sites/M-on.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "=== Q6 DONE $(date -Is)"
} > "$L/logs/q6.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q6.log"
