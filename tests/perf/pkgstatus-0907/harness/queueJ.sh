#!/bin/bash
# Lane J: the contrast arm of lane I. Same one-line change, different package.
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
{
  echo "=== QUEUE-J START $(date -Is)  node=$(node --version)"
  timeout 5400 node "$L/sites.mjs" "$L/napp/drivers/_x-redis-plus-zapo.ts" \
    "$L/sites/_x-redis-plus-zapo.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QUEUE-J DONE $(date -Is)"
} > "$L/queueJ.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueJ.log"
