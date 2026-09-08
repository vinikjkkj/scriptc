#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV8 START $(date -Is) -- three `as any` casts removed, line-neutral"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voipC.ts" "$L/sites/V-C.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV8 DONE $(date -Is)"
} > "$L/logs/qV8.log" 2>&1
