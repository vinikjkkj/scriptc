#!/bin/bash
# fences.sh -- count `[SCxxxx at file:line]` runtime fences across EVERY emitted
# translation unit of a program, and SPLIT SC900x out of the total.
#
# Two false-zero traps this is armed against:
#   1. `<name>.c` alone is not the program. The C backend splits large output
#      into `<name>.partN.c` plus a `<name>.scrh`; the single fence in the
#      pkgstatus-0907 survey lived in part4, and scanning `<name>.c` read
#      17,163,938 bytes and reported 0.
#   2. SC900x are assertions the backend emits for CORRECT code. In one clean
#      build 3,782 of 3,786 SC occurrences were SC900x. Quoting the raw total
#      as "runtime fences" invents thousands of refusals. Both numbers are
#      printed; the non-SC900x one is the one a status row may quote.
#
# Usage: bash fences.sh <out-dir> <program-basename> ...
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -n "$WT" ] || . "$HERE/env.sh" || exit 1
OUT="$1"; shift
for base in "$@"; do
  tot=0; nonassert=0; files=0; bytes=0
  echo "=== fences: $base"
  for f in "$OUT/$base".c "$OUT/$base".part*.c "$OUT/$base".scrh "$OUT/$base".h; do
    [ -f "$f" ] || continue
    n=$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$f" | wc -l)
    na=$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$f" | rg -v '\[SC900[0-9] at' | wc -l)
    b=$(stat -c%s "$f")
    printf '    %-38s bytes=%-11s fences=%-6s non-SC900x=%s\n' "$(basename "$f")" "$b" "$n" "$na"
    tot=$((tot + n)); nonassert=$((nonassert + na)); files=$((files + 1)); bytes=$((bytes + b))
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
  echo "    TOTAL files=$files bytes=$bytes FENCES=$tot  NON-SC900x=$nonassert"
  for f in "$OUT/$base".c "$OUT/$base".part*.c "$OUT/$base".scrh "$OUT/$base".h; do
    [ -f "$f" ] && rg -a -o '\[(SC[0-9]{4}) at' -r '$1' "$f"
  done | sort | uniq -c | sort -rn | head -20
  echo "    --- the non-SC900x fences, verbatim ---"
  for f in "$OUT/$base".c "$OUT/$base".part*.c "$OUT/$base".scrh "$OUT/$base".h; do
    [ -f "$f" ] && rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$f"
  done | rg -v '\[SC900[0-9] at' | sort | uniq -c | sort -rn | head -20
done
