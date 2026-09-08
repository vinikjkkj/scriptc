#!/bin/bash
# Lane A: does each named package reach a binary? Strict, --provenance-sources,
# NO --best-effort (that flag defers refusals into runtime throws, so a count
# taken under it means nothing).
#
# Controls run FIRST, in the same lane, so a queue that reports "nothing" can
# be told apart from a queue whose instrument is broken.
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
{
  echo "=== QUEUE-A START $(date -Is)"
  bash "$L/build1.sh" hello.ts ctl-hello --provenance-sources
  bash "$L/build1.sh" typesprobe.ts ctl-typesprobe --provenance-sources
  bash "$L/build1.sh" typesprobe-neg.ts ctl-typesprobe-neg --provenance-sources
  for p in store-memory store-sqlite store-mongo store-mysql store-postgres store-redis media-utils wam voip; do
    bash "$L/build1.sh" "drivers/$p.ts" "$p" --provenance-sources
  done
  echo "=== QUEUE-A DONE $(date -Is)"
} > "$L/queueA.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueA.log"
