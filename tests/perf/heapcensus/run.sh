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
  zig cc -c -target "${SCRIPTC_TARGET:-x86_64-windows-gnu}" \
    -include "$HC/scr_heap_census.h" "$HC/selfcheck.c" -o "$OUT/selfcheck.o" || exit 1
  echo "selfcheck: OK"
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
