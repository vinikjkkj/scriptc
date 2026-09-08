#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
mkdir -p "$L/sites" "$L/logs"
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== Q1 START $(date -Is)"
  echo "WHICH-TAR $(which tar)  $(tar --version|head -1)"
  echo "ZIG $(zig version)  AUTHORED_JS=${SCRIPTC_PROVENANCE_AUTHORED_JS:-<unset>}"
  echo "--- A: drivers/wam.ts (lane A control, expect 86)"
  timeout 5400 node "$L/sites.mjs" "$L/napp/drivers/wam.ts" "$L/sites/A-wam.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- A2: drivers/_x-wam-plus-zapo.ts (lane A + zapo-js named)"
  timeout 5400 node "$L/sites.mjs" "$L/napp/drivers/_x-wam-plus-zapo.ts" "$L/sites/A2-wam-plus-zapo.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- F: napp/pkgsrc/src-wam.ts (lane F control, expect 15)"
  timeout 5400 node "$L/sites.mjs" "$L/napp/pkgsrc/src-wam.ts" "$L/sites/F-src-wam.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== Q1 DONE $(date -Is)"
} > "$L/logs/q1.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/q1.log"
