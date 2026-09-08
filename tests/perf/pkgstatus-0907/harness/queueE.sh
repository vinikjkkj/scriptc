#!/bin/bash
# Lane E: targeted probes.
#  E1  _x-waclient-182 -- does the zapo-js the driver INSTALLS (1.8.2) carry the
#      same root blockers the store packages hit inside their attested v1.8.0
#      checkout? If it does, the store lane's blockers are not a version skew.
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
{
  echo "=== QUEUE-E START $(date -Is)"
  timeout 5400 node "$L/sites.mjs" "$L/napp/drivers/_x-waclient-182.ts" \
    "$L/sites/_x-waclient-182.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  bash "$L/build1.sh" drivers/_x-waclient-182.ts x-waclient-182 --provenance-sources
  echo "=== QUEUE-E DONE $(date -Is)"
} > "$L/queueE.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueE.log"
