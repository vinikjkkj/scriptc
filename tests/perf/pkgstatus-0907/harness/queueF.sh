#!/bin/bash
# Lane F: the packages that publish NO provenance attestation -- media-utils and
# voip -- cannot be measured through their npm artifact at all: the compiler
# islands them and says so, and the island's refusals are the FALLBACK's, not
# the package's. Their status in the npm lane is UNMEASURED, never zero.
#
# This lane measures their SOURCE instead, taken verbatim from the zapo-js@1.8.2
# attested checkout 757a8071b819 (refs/tags/v1.8.2) that npm attests for
# zapo-js itself. wam runs here too as a CONTROL: wam DOES publish an
# attestation, so lane A and lane F must tell a consistent story about it.
#
# Its own tsconfig carries lib ["ES2020","DOM"], matching
# packages/voip/tsconfig.json in that tree.
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
{
  echo "=== QUEUE-F START $(date -Is)  node=$(node --version)"
  for p in media-utils voip wam; do
    echo "--- analyse src-$p"
    timeout 5400 node "$L/sites.mjs" "$L/napp/pkgsrc/src-$p.ts" "$L/sites/src-$p.json" --provenance-sources 2>&1
    echo "EXIT=$?"
  done
  for p in media-utils voip wam; do
    bash "$L/build1.sh" "pkgsrc/src-$p.ts" "src-$p" --provenance-sources
  done
  echo "=== QUEUE-F DONE $(date -Is)"
} > "$L/queueF.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueF.log"
