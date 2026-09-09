#!/bin/sh
# run.sh - build the chunk census's control program and run its self-test.
#
#   sh tests/perf/chunkcensus/run.sh [build|run|test|all]
#
# THE INSTRUMENT IS THE THING THAT SHIPS, not the readings. Every settled
# figure this project quoted before 2026-09-07 -- 163.39 -> 104.50 MiB, the
# ~52 MiB handed back -- was taken with a driver that lived outside version
# control, and when its worktree was purged those numbers became real and
# unreproducible. tests/perf/zapo-rest/harness/memrig.mts says so in its own
# header. So the build recipe lives here, beside the header it builds.
#
# WHAT THE SELF-TEST PROVES, in four arms of ONE binary:
#
#   dense      40,000 nodes, all retained     occupancy ~96%, ceiling ~4%
#   sparse     40,000 built, every 10th kept  occupancy ~10%, ceiling ~4%
#   clustered  40,000 built, first 10th kept  occupancy ~66%, ceiling ~33%
#   null       nothing allocated              no live blocks, still ARMED
#
# sparse and clustered retain the IDENTICAL live population and differ only
# in where the survivors sit. That pair is what makes the page ceiling
# credible in both directions: scattered survivors leave almost no whole
# free page (4%), clustered ones leave a third of the address space free,
# and a ceiling that reported ~0 for every input would be indistinguishable
# from one that was never computed at all.
#
# PATHS COME FROM THE ENVIRONMENT. REPO_ROOT is this checkout; nothing
# machine-specific is written here. zig cc is a native binary spawned by
# node and never sees an MSYS mount point, so the -include path handed to
# the compiler is built in the host's own spelling.
set -u

STEP=${1:-all}
REPO=${REPO_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}
OUT=${CHUNKCEN_OUT_DIR:-$REPO/tests/perf/chunkcensus/run}
CLI=$REPO/packages/cli/dist/main.js
KC=$REPO/tests/perf/chunkcensus
EXE=$OUT/kcctl.exe

mkdir -p "$OUT"

# The instrument reaches the compile two ways and BOTH are required:
#   -include  puts scr_chunk_census.h in front of every translation unit,
#             which is what carries the state, the loop seam and the report;
#   -I        lets scr_cycle.c and scr_string.c find the two walk headers
#             they #include from inside their own #ifdef SCR_CHUNKCEN_ON.
# Dropping the -I does not fail the build -- it fails the #include, and the
# report then says cycWalk=ABSENT, which the reader refuses on.
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) KCW=$(cygpath -w "$KC") ;;
  *)                    KCW=$KC ;;
esac
SCRIPTC_PROF_CFLAGS="-include ${KCW}/scr_chunk_census.h -I${KCW}"
export SCRIPTC_PROF_CFLAGS

build() {
  echo "=== build (PROF_CFLAGS: $SCRIPTC_PROF_CFLAGS)"
  ( cd "$REPO" && node "$CLI" build \
      tests/perf/chunkcensus/occupancy-control.ts -o "$EXE" --keep-c ) || exit 1
  # Read the backend off the ARTIFACT, never off the absence of a message.
  ls "$OUT" | grep -E '[.](ll|c)$' | sed 's/^/    emitted: /'
}

arm() {
  tag=$1; n=$2; keep=$3; mode=$4
  echo "--- arm $tag (KC_N=$n KC_KEEP=$keep KC_MODE=$mode)"
  # SCR_CYCLE_IDLE_PACE=0 forces a collection pass at every loop quiescence
  # (cycstat's documented positive control). Without it the pacing can leave
  # the sparse arm's garbage uncollected and it reads like the dense arm for
  # a reason that has nothing to do with this census.
  KC_N=$n KC_KEEP=$keep KC_MODE=$mode \
  SCR_CYCLE_IDLE_PACE=0 SCR_CHUNKCEN_MS=400 SCR_CHUNKCEN_CHUNKS=1 \
  SCR_CHUNKCEN_OUT="$OUT/$tag.chunkcen.txt" "$EXE" || exit 1
}

run() {
  arm dense     40000 1  stride
  arm sparse    40000 10 stride
  arm clustered 40000 10 prefix
  arm null      0     1  stride
}

test_() {
  node "$KC/chunkcensus.mjs" --self-test \
    --dense "$OUT/dense.chunkcen.txt" \
    --sparse "$OUT/sparse.chunkcen.txt" \
    --clustered "$OUT/clustered.chunkcen.txt" \
    --null "$OUT/null.chunkcen.txt"
}

case "$STEP" in
  build) build ;;
  run)   run ;;
  test)  test_ ;;
  all)   build && run && test_ ;;
  *)     echo "usage: run.sh [build|run|test|all]"; exit 2 ;;
esac
