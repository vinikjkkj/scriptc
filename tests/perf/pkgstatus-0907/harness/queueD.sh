#!/bin/bash
# Lane D: INDEPENDENT confirmation of block mongoredecl's store-mongo headline
# (233 blockers / 1 runtime fence / 49 advisories / 1235 unreached) on the same
# main, from a different worktree, a different compiler build and a different
# provenance cache. Their lab is read ONLY -- nothing is written into it; the
# record lands under my own lab.
#
# Their entry is <blocks>/mongoredecl-lab/app/drivers/drv-mongo.ts, which
# imports the store-mongo SOURCE COPY carried in that lab, not the npm package.
# That is a different lane from my own store-mongo driver and the two numbers
# are not interchangeable.
. <blocks>/pkgstatus3-lab/env.sh
L=<blocks>/pkgstatus3-lab
{
  echo "=== QUEUE-D START $(date -Is)  node=$(node --version)"
  echo "--- entry: <blocks>/mongoredecl-lab/app/drivers/drv-mongo.ts (read-only)"
  timeout 5400 node "$L/sites.mjs" \
    "<blocks>/mongoredecl-lab/app/drivers/drv-mongo.ts" \
    "$L/sites/xcheck-mongoredecl-drv-mongo.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QUEUE-D DONE $(date -Is)"
} > "$L/queueD.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueD.log"
