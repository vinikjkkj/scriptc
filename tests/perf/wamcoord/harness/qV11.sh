#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
while ! grep -q "QV10 DONE" "$L/logs/qV10.log" 2>/dev/null; do sleep 20; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV11 START $(date -Is) -- voip lane A2 after BOTH lowering changes"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/_x-voip-plus-zapo.ts" "$L/sites/V-A2-both.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV11 DONE $(date -Is)"
} > "$L/logs/qV11.log" 2>&1
