#!/bin/bash
# The decisive build, run off queue G's critical path: store-sqlite's own source
# compiled against zapo-js 1.8.2. Lane G will run it again under its own name;
# this one answers sooner.
bash ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/build1.sh pkgsrcN/src-store-sqlite.ts src-store-sqlite-early --provenance-sources \
  > ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/early-sqlite.log 2>&1
echo "=== EARLY-EXIT rc=$? ===" >> ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/early-sqlite.log
