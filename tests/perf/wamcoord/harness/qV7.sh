#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV7 START $(date -Is) -- voip lane A2 strict build AFTER the change"
  bash "$L/build2.sh" "drivers/_x-voip-plus-zapo.ts" "voip-a2-after" --provenance-sources --backend c
  echo "=== QV7 DONE $(date -Is)"
} > "$L/logs/qV7.log" 2>&1
