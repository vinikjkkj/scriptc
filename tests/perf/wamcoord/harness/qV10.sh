#!/bin/bash
# voipC (three `as any` casts removed) on the CURRENT compiler, so it pairs with
# qV9's src-voip.ts baseline on the same compiler. The earlier qV8 run started
# before the array-element change landed in dist and would have credited the
# cast removal with two srtp.ts sites it did not clear.
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QV10 START $(date -Is)"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-voipC.ts" "$L/sites/V-C2.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QV10 DONE $(date -Is)"
} > "$L/logs/qV10.log" 2>&1
