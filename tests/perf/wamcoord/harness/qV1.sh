#!/bin/bash
# voip, the lane table. A site count is two facts multiplied; measure both axes
# before quoting one number.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV1 START $(date -Is)"
  echo "--- VA: drivers/voip.ts  (npm lane, default env)"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/voip.ts" "$L/sites/V-A.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "--- VA2: drivers/_x-voip-plus-zapo.ts  (npm lane + zapo-js named)"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/_x-voip-plus-zapo.ts" "$L/sites/V-A2.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "--- VF: pkgsrc/src-voip.ts  (source on zapo-js 1.8.2, default env)"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voip.ts" "$L/sites/V-F.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "--- VFj: pkgsrc/src-voip.ts  (source, authored-JS widened to ALL)"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voip.ts" "$L/sites/V-Fj.json" --provenance-sources 2>&1 )
  echo "EXIT=$?"
  echo "=== QV1 DONE $(date -Is)"
} > "$L/logs/qV1.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qV1.log"
