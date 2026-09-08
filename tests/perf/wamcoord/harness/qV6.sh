#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV6 START $(date -Is) -- voip lane A2 AFTER the compound-assignment change"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/_x-voip-plus-zapo.ts" "$L/sites/V-A2-after.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV6 DONE $(date -Is)"
} > "$L/logs/qV6.log" 2>&1
