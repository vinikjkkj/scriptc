#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV3 START $(date -Is)"
  echo "--- the dgram tier question, DEFAULT backend (no --backend flag)"
  bash "$L/build2.sh" "dgramprobe.ts" "dgramprobe"
  echo "--- voip consumer lane, STRICT, --backend c: the compiler's own error line"
  bash "$L/build2.sh" "drivers/_x-voip-plus-zapo.ts" "voip-a2" --provenance-sources --backend c
  echo "=== QV3 DONE $(date -Is)"
} > "$L/logs/qV3.log" 2>&1
