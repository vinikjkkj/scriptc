#!/bin/bash
# The regression check the whitelist exists for: a package NOT on the list must
# behave exactly as it did when the gate was off, and `=1` must still mean all.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QD START $(date -Is)"
  echo "--- store-mysql, NO env var (shipped default) -- must equal the old gate-OFF 46"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/store-mysql.ts" "$L/sites/M-default.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "--- store-mysql, =1 (the boolean spelling) -- must equal the old gate-ON 58"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/store-mysql.ts" "$L/sites/M-all.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "--- store-mysql, =mysql2 (named explicitly) -- must also be 58"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=mysql2; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/store-mysql.ts" "$L/sites/M-named.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "=== QD DONE $(date -Is)"
} > "$L/logs/qD.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qD.log"
