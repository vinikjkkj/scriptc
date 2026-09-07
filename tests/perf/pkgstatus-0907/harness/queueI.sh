#!/bin/bash
# Lane I: the A/B that settles the store-sqlite discrepancy.
#   drivers/store-sqlite.ts            imports @zapo-js/store-sqlite ONLY  -> 7 sites (lane A)
#   drivers/_x-sqlite-plus-zapo.ts     the same file + `import { WaClient } from 'zapo-js'`
# app182/zapo-rest.ts has the second shape. If the 7 sites are zapo-js v1.8.0's
# rather than store-sqlite's, this run reports 0.
. <blocks>/pkgstatus3-lab/env.sh
L=<blocks>/pkgstatus3-lab
{
  echo "=== QUEUE-I START $(date -Is)  node=$(node --version)"
  timeout 5400 node "$L/sites.mjs" "$L/napp/drivers/_x-sqlite-plus-zapo.ts" \
    "$L/sites/_x-sqlite-plus-zapo.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  bash "$L/build1.sh" drivers/_x-sqlite-plus-zapo.ts x-sqlite-plus-zapo --provenance-sources
  echo "=== QUEUE-I DONE $(date -Is)"
} > "$L/queueI.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueI.log"
