#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV12 START $(date -Is) -- voip lane A2 strict build after BOTH lowering changes"
  bash "$L/build2.sh" "drivers/_x-voip-plus-zapo.ts" "voip-a2-both" --provenance-sources --backend c
  echo "=== QV12 DONE $(date -Is)"
} > "$L/logs/qV12.log" 2>&1
