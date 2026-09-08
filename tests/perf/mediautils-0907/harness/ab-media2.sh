#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/mediautils-work/env.sh
L=${BLOCKS_ROOT:-<blocks>}/mediautils-work
{
echo "=== AB2 (patched compiler) START $(date -Is) ORACLE-NODE $(node --version)"
timeout 5400 node "$L/sites.mjs" "$L/napp/drivers/_x-media-plus-zapo.ts" "$L/sites/_x-media-plus-zapo-a3.json" --provenance-sources 2>&1
echo "EXIT=$?"
echo "=== AB2 DONE $(date -Is)"
} > "$L/logs/ab-media2.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/ab-media2.log"
