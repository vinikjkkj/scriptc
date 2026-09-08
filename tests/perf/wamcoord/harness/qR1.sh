#!/bin/bash
# store-redis on current main (spec-twin change merged). Both lanes, because
# pkgstatus recorded 46 for the isolated driver and 39 for the consumer-shaped
# one, and "46 -> 39" could be either the lane or the spec-twin fix.
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QR1 START $(date -Is)"
  echo "--- RA: drivers/store-redis.ts  (isolated driver; pkgstatus recorded 46)"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/store-redis.ts" "$L/sites/R-A.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "--- RA2: drivers/_x-redis-plus-zapo.ts  (consumer shape; pkgstatus recorded 39)"
  timeout 9000 node "$L/sites.mjs" "$L/napp/drivers/_x-redis-plus-zapo.ts" "$L/sites/R-A2.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QR1 DONE $(date -Is)"
} > "$L/logs/qR1.log" 2>&1
