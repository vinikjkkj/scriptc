#!/bin/bash
# Lane G: the DECISIVE experiment the lane-E probe implies.
#
# Lane E showed `import { WaClient } from 'zapo-js'` against zapo-js **1.8.2**
# analyses 46,957 statements with ZERO blocker sites -- so the seven-site
# zapo-js-core cluster that blocks all five store packages on lane A does not
# exist in 1.8.2. It exists in **v1.8.0**, which is the tree the published store
# packages attest.
#
# So: take the store package source verbatim from the v1.8.2 checkout (it is
# byte-identical to the v1.8.0 one -- `diff -r -q` says so) and compile it
# against zapo-js 1.8.2. If store-sqlite then reaches a binary, the store lane
# is blocked by a stale attestation, not by the compiler.
#
# store-redis runs beside it as the CONTRAST: its blocker is `ioredis` having no
# provenance attestation at all, which no zapo-js bump can fix.
# media-utils re-runs here because its own tsconfig has NO "DOM" in lib and the
# first lane-F run gave it one.
. <blocks>/pkgstatus3-lab/env.sh
L=<blocks>/pkgstatus3-lab
{
  echo "=== QUEUE-G START $(date -Is)  node=$(node --version)"
  for p in store-sqlite store-redis media-utils; do
    echo "--- analyse src-$p (pkgsrcN, lib ES2020, no DOM)"
    timeout 5400 node "$L/sites.mjs" "$L/napp/pkgsrcN/src-$p.ts" "$L/sites/src-$p.json" --provenance-sources 2>&1
    echo "EXIT=$?"
  done
  for p in store-sqlite store-redis media-utils; do
    bash "$L/build1.sh" "pkgsrcN/src-$p.ts" "src-$p" --provenance-sources
  done
  echo "=== QUEUE-G DONE $(date -Is)"
} > "$L/queueG.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueG.log"
