#!/bin/bash
# The probe in qV8 is a COPY of the pkgsrc voip tree, so its baseline must be
# that same tree on the SAME compiler. V-F.json predates the compound-assignment
# change and would attribute eleven cleared sites to the cast removal.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
while ! grep -q "QV8 DONE" "$L/logs/qV8.log" 2>/dev/null; do sleep 20; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV9 START $(date -Is) -- lane F baseline on the CURRENT compiler"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voip.ts" "$L/sites/V-F-current.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV9 DONE $(date -Is)"
} > "$L/logs/qV9.log" 2>&1
