#!/bin/bash
# fences.sh -- count `[SCxxxx at file:line]` runtime fences across EVERY emitted
# translation unit of a program, not just the first one.
#
# WHY THIS EXISTS. `build1.sh` scanned only `<name>.c`. For a large program the
# C backend splits the output into `<name>.part1.c` … `<name>.partN.c` plus a
# `<name>.scrh`, and the single fence in this survey lives in **part4**. Scanning
# `<name>.c` alone reads 17,163,938 bytes and reports 0 -- a byte-sized,
# entirely convincing false zero.
#
# Usage: bash fences.sh <out-dir> <program-basename> ...
. ${BLOCKS_ROOT:-<blocks>}/pkgstatus3-lab/env.sh
OUT="$1"; shift
for base in "$@"; do
  tot=0; files=0; bytes=0
  echo "=== $base"
  for f in "$OUT/$base".c "$OUT/$base".part*.c "$OUT/$base".scrh "$OUT/$base".h; do
    [ -f "$f" ] || continue
    n=$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$f" | wc -l)
    b=$(stat -c%s "$f")
    printf '    %-38s bytes=%-11s fences=%s\n' "$(basename "$f")" "$b" "$n"
    tot=$((tot + n)); files=$((files + 1)); bytes=$((bytes + b))
  done
  if [ $files -eq 0 ]; then
    ll=$(ls "$OUT/$base".ll 2>/dev/null)
    if [ -n "$ll" ]; then
      echo "    NO C TU (LLVM backend, $(stat -c%s "$ll") bytes of .ll): fence count ABSENT, not 0"
    else
      echo "    NO emitted TU at all: fence count ABSENT, not 0"
    fi
    continue
  fi
  echo "    TOTAL files=$files bytes=$bytes FENCES=$tot"
  for f in "$OUT/$base".c "$OUT/$base".part*.c "$OUT/$base".scrh "$OUT/$base".h; do
    [ -f "$f" ] && rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$f"
  done | sort | uniq -c | sort -rn
done
