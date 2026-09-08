#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
while ! grep -q "QV3 DONE" "$L/logs/qV3.log" 2>/dev/null; do sleep 20; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV4 START $(date -Is) -- voip's real dgram surface, DEFAULT backend"
  bash "$L/build2.sh" "dgramprobe2.ts" "dgramprobe2"
  echo "ARTIFACT CHECK:"; ls -la "$L/out/dgramprobe2".ll "$L/out/dgramprobe2".c 2>&1 | sed 's/^/  /'
  echo "=== QV4 DONE $(date -Is)"
} > "$L/logs/qV4.log" 2>&1
