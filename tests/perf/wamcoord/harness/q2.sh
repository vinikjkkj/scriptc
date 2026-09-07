#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
export SCRIPTC_PROVENANCE_AUTHORED_JS=1
L=<blocks>/wamcoord-lab
mkdir -p "$L/sites" "$L/logs"
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q2 START $(date -Is)   AUTHORED_JS=${SCRIPTC_PROVENANCE_AUTHORED_JS}"
  echo "--- F+: napp/pkgsrc/src-wam.ts, gate ON"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-wam.ts" "$L/sites/Fj-src-wam.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- A+: drivers/wam.ts, gate ON"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/wam.ts" "$L/sites/Aj-wam.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- A2+: drivers/_x-wam-plus-zapo.ts, gate ON"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/_x-wam-plus-zapo.ts" "$L/sites/A2j-wam-plus-zapo.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== Q2 DONE $(date -Is)"
} > "$L/logs/q2.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q2.log"
