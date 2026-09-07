#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
while ! grep -q "QV4 DONE" "$L/logs/qV4.log" 2>/dev/null; do sleep 20; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV5 START $(date -Is) -- line-neutral substitution probe"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voipB.ts" "$L/sites/V-B2.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV5 DONE $(date -Is)"
} > "$L/logs/qV5.log" 2>&1
