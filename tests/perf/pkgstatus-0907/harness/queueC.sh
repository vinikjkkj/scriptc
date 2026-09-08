#!/bin/bash
# Lane C: for the drivers that reached a binary on lane A, rebuild with
# --backend c so there IS a C translation unit to count fences in. The LLVM
# backend keeps no .c TU, so on lane A the fence count is structurally
# absent -- not zero. Still no --best-effort.
#
# $1.. = names to rebuild (must match drivers/<name>.ts).
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
{
  echo "=== QUEUE-C START $(date -Is)"
  bash "$L/build1.sh" hello.ts ctl-hello-c --provenance-sources --backend c
  for p in "$@"; do
    bash "$L/build1.sh" "drivers/$p.ts" "$p-c" --provenance-sources --backend c
  done
  echo "=== QUEUE-C DONE $(date -Is)"
} > "$L/queueC.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueC.log"
