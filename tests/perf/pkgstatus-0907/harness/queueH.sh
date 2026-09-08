#!/bin/bash
# Lane H: the one driver that reaches a binary, rebuilt with --backend c so
# there IS a C translation unit to count `[SCxxxx at file:line]` fences in.
# On the default (LLVM) backend no .c TU is written, so the fence count there is
# ABSENT, not zero -- this lane turns the absence into a number.
# Still strict, still --provenance-sources, still NO --best-effort.
# hello.ts runs first as the control: it must produce a C TU with 0 fences and
# a non-zero byte size, so a 0 elsewhere can be told from an unread file.
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab
{
  echo "=== QUEUE-H START $(date -Is)"
  bash "$L/build1.sh" hello.ts ctl-hello-c --provenance-sources --backend c
  bash "$L/build1.sh" drivers/store-memory.ts store-memory-c --provenance-sources --backend c
  echo "=== QUEUE-H DONE $(date -Is)"
} > "$L/queueH.log" 2>&1
echo "=== QUEUE-EXIT rc=$? ===" >> "$L/queueH.log"
