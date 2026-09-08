#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q4 START $(date -Is)"
  echo "### CONTROL: gate OFF, src-wam, strict -- expect rc=1 / 15 errors / fences n/a"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; bash "$L/build2.sh" "pkgsrc/src-wam.ts" "srcwam-off" --provenance-sources --backend c )
  echo "### TREATMENT: gate ON, src-wam, strict"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; bash "$L/build2.sh" "pkgsrc/src-wam.ts" "srcwam-on" --provenance-sources --backend c )
  echo "### TREATMENT: gate ON, src-wam-entry (15 assertions), strict"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; bash "$L/build2.sh" "pkgsrc/src-wam-entry.ts" "srcwament-on" --provenance-sources --backend c )
  echo "=== Q4 DONE $(date -Is)"
} > "$L/logs/q4.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q4.log"
