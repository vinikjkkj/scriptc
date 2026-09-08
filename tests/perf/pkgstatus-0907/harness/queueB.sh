#!/bin/bash
# Lane B: one analyze() pass per driver, --provenance-sources, no --best-effort.
# This is the SITE dump: every diagnostic with its code, file and line, kept in
# the compiler's own sections (blocker / runtimeFence / advisory / unreached)
# and never netted together.
#
# The two armed controls run FIRST in the same lane: typesprobe must cross
# preflight, typesprobe-neg must fail it. A run where both agree is a broken
# query, not a clean lane.
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
OUT="$L/sites"
mkdir -p "$OUT"
cd "$L/napp" || exit 1
{
  echo "=== QUEUE-B START $(date -Is)  node=$(node --version)"
  for c in typesprobe typesprobe-neg; do
    echo "--- control $c"
    timeout 3600 node "$L/sites.mjs" "$PWD/$c.ts" "$OUT/_ctl_$c.json" --provenance-sources 2>&1
    echo "EXIT=$?"
  done
  for p in store-memory store-sqlite store-mongo store-mysql store-postgres store-redis media-utils wam voip; do
    echo "--- $p"
    timeout 5400 node "$L/sites.mjs" "$PWD/drivers/$p.ts" "$OUT/$p.json" --provenance-sources 2>&1
    echo "EXIT=$?"
  done
  echo "=== QUEUE-B DONE $(date -Is)"
} > "$L/queueB.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueB.log"
