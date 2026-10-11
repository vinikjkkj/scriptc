#!/bin/sh
# run.sh - build the free-side control and prove the page ceiling discriminates.
#
#   sh tests/perf/heapcensus/run.sh [check|build|run|all]
#
# check  compiles selfcheck.c, which type-checks every function in the
#        force-included header in two seconds instead of at the end of a
#        multi-minute build.
# run    two arms of ONE binary with the same retained count and bytes,
#        differing only in where the survivors sit.
set -u
STEP=${1:-all}
REPO=${REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
HC=$REPO/tests/perf/heapcensus
OUT=${HEAPCEN_OUT_DIR:-$HC/run}
mkdir -p "$OUT"
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) HCW=$(cygpath -w "$HC") ;;
  *)                    HCW=$HC ;;
esac

check() {
  T=${SCRIPTC_TARGET:-x86_64-windows-gnu}
  zig cc -c -target "$T" \
    -include "$HC/scr_heap_census.h" "$HC/selfcheck.c" -o "$OUT/selfcheck.o" || exit 1
  echo "selfcheck: OK"
  # The peak arm is a different preprocessor program: six more Win32 entry
  # points, one more struct and four more _Static_asserts.
  zig cc -c -target "$T" -DSCR_HEAPCEN_PEAK \
    -include "$HC/scr_heap_census.h" "$HC/selfcheck.c" -o "$OUT/selfcheck-peak.o" || exit 1
  echo "selfcheck -DSCR_HEAPCEN_PEAK: OK"
  # THE COLLISION. <windows.h> and <psapi.h> land on top of this header in
  # real units and must stay free to declare HeapWalk, Sleep, CreateThread,
  # QueryPerformanceCounter and PROCESS_MEMORY_COUNTERS_EX themselves.
  zig cc -c -target "$T" -DSCR_HEAPCEN_PEAK \
    -include "$HC/scr_heap_census.h" "$HC/selfcheck-win.c" -o "$OUT/selfcheck-win.o" || exit 1
  echo "selfcheck-win (<windows.h> + <psapi.h> after the force-include): OK"
  # THE COMPOSITION THIS HEADER'S OWN "HOW TO USE IT" BLOCK PRESCRIBES.
  # It did not compile until 2026-10-11: cycstat interposes _Exit, this
  # file had no branch for it, and the #else fired. The failure surfaced on
  # the first mbedtls vendor unit, i.e. minutes into a sixteen-minute
  # build, which is exactly the cost this check exists to avoid -- and it
  # is the SECOND time the documented chain order was a compile error
  # (WHICH-BUFFER.md ss.0 is the first). A composition that is documented
  # and never compiled is a recipe nobody has run.
  zig cc -c -target "$T" -DSCR_HEAPCEN_PEAK \
    -include "$REPO/tests/perf/cycstat/scr_cyc_stat.h" -DSCR_CYCSTAT_ON \
    -include "$HC/scr_heap_census.h" "$HC/selfcheck.c" -o "$OUT/selfcheck-cycstat.o" || exit 1
  echo "selfcheck + cycstat (the documented composition): OK"
  # NEGATIVE ARM, so "it compiled" cannot be a guard that stopped guarding:
  # an UNKNOWN interposer must still be refused by name.
  printf '#include <stdlib.h>\n#define _Exit(c) (_Exit(c))\n' > "$OUT/unknown-interposer.h"
  if zig cc -c -target "$T" -DSCR_HEAPCEN_PEAK \
       -include "$OUT/unknown-interposer.h" \
       -include "$HC/scr_heap_census.h" "$HC/selfcheck.c" \
       -o "$OUT/selfcheck-neg.o" 2>"$OUT/neg.err"; then
    echo "selfcheck NEGATIVE: FAILED -- an unknown _Exit interposer was accepted"; exit 1
  fi
  grep -q 'another header already interposes _Exit' "$OUT/neg.err" \
    && echo "selfcheck NEGATIVE (unknown interposer still refused by name): OK" \
    || { echo "selfcheck NEGATIVE: FAILED -- refused, but not for this reason"; exit 1; }
}
build() {
  SCRIPTC_PROF_CFLAGS="-include ${HCW}/scr_heap_census.h" \
  node "$REPO/packages/cli/dist/main.js" build \
    "$REPO/tests/perf/heapcensus/fragment-control.ts" -o "$OUT/hcctl.exe" --keep-c || exit 1
  ls "$OUT" | grep -E '[.](ll|c)$' | sed 's/^/    emitted: /'
}
arm() {
  KC_MODE=$1 KC_N=${KC_N:-120000} KC_SZ=${KC_SZ:-700} KC_KEEP=${KC_KEEP:-10} \
  SCR_HEAPCEN_OUT="$OUT/$1.heapcen.txt" "$OUT/hcctl.exe" || exit 1
  grep -E '^\[heapcen\] (heap 0|HCPAGE)' "$OUT/$1.heapcen.txt"
}
case "$STEP" in
  check) check ;;
  build) build ;;
  run)   arm stride; arm prefix ;;
  all)   check && build && arm stride && arm prefix ;;
  *) echo "usage: run.sh [check|build|run|all]"; exit 2 ;;
esac
