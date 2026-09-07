#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
while ! grep -q "Q4 DONE" "$L/logs/q4.log" 2>/dev/null; do sleep 30; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q5 START $(date -Is)"
  echo "### NPM LANE, gate ON: the PUBLISHED @zapo-js/wam@0.1.1 imported the way a real consumer imports it"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; bash "$L/build2.sh" "drivers/_x-wam-plus-zapo.ts" "npmwam-on" --provenance-sources --backend c )
  echo "=== Q5 DONE $(date -Is)"
} > "$L/logs/q5.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q5.log"
