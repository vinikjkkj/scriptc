#!/bin/bash
# Confirm 39 on current main FIRST; only then the substitution pair.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QR2 START $(date -Is)  main=0c66825d"
  echo "--- CONFIRM: drivers/_x-redis-plus-zapo.ts must still read 39"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/_x-redis-plus-zapo.ts" "$L/sites/R-A2-main.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- BASELINE: pkgsrc/src-storeredis.ts (source lane, unmodified)"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-storeredis.ts" "$L/sites/R-src.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- PROBE: pkgsrc/src-storeredisB.ts (three type-only ioredis imports stubbed)"
  timeout 9000 node "$L/sites.mjs" "$L/napp/pkgsrc/src-storeredisB.ts" "$L/sites/R-srcB.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QR2 DONE $(date -Is)"
} > "$L/logs/qR2.log" 2>&1
