#!/bin/bash
# Substitution probe: does one parameter type carry eleven SC2003 sites?
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV2 START $(date -Is)"
  echo "--- VB: pkgsrc/src-voipB.ts (closeQuietly's parameter widened to the four handle types)"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voipB.ts" "$L/sites/V-B.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV2 DONE $(date -Is)"
} > "$L/logs/qV2.log" 2>&1
