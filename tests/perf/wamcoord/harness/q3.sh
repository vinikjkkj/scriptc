#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
export SCRIPTC_PROVENANCE_AUTHORED_JS=1
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q3 START $(date -Is) -- the minimal authored-JS probe, gate ON, STRICT (no --best-effort)"
  bash "$L/build2.sh" "wawam-min.ts" "wawam-min-c" --provenance-sources --backend c
  echo "=== Q3 DONE $(date -Is)"
} > "$L/logs/q3.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q3.log"
