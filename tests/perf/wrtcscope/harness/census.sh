#!/bin/sh
# census.sh — block/wrtcscope.
#
# Runs tests/perf/arrcensus's SCR_ARRCEN_ON census over the zapo messaging
# bench's CLIENT, to answer one question about `send_group`:
#
#   is scr_arr_slice's 21.0% a QUADRATIC, or a million small copies?
#
# A profile share cannot tell those apart and they have opposite fixes. This
# counts instead: call volume, the source-length and copied-length histograms,
# the element-kind split, and how many calls are the degenerate empty-slice
# allocation. It covers scr_arr_join in the same pass for free.
#
# COUNTS ARE LOAD-INDEPENDENT. This is not a timing run, takes no floor and
# forms no ratio, so it does not need a quiet host and does not compete with
# clientbench's numbers. Nothing here is written into that block's tree: the
# bench app is COPIED to this block's own lab.
#
# SCRIPTC_NO_CACHE is deliberately NOT set. arrcensus's own usage note says to
# set it because "the header is outside packages/runtime/src and so is not in
# the build-cache key" -- that is STALE. cc.ts's cache-flavor discriminator
# now folds the CONTENTS of every -include'd file into the key, and this block
# verified both directions: an uninstrumented build writes no report, and an
# instrumented rebuild after it still reports correctly.
#
# Usage: sh tests/perf/wrtcscope/harness/census.sh [build|run|all]
set -u

WT=<blocks>/wrtcscope/wt
LAB=<blocks>/wrtcscope/lab
APP=$LAB/cb/app
OUT=$LAB/cen/bench
CLI=$WT/packages/cli/dist/main.js
DIR=${CENSUS_DIR:-bench-noprof}
STEP=${1:-all}

. "$WT/tests/perf/wrtcscope/harness/env.sh" || exit 1

# The census header, as WINDOWS paths: `zig cc` is a native binary spawned by
# node and never sees an MSYS mount point.
WINWT='<blocks>\wrtcscope\wt'
export SCRIPTC_PROF_CFLAGS="-include ${WINWT}\tests\perf\arrcensus\scr_arr_census.h -I${WINWT}\tests\perf\arrcensus"

mkdir -p "$OUT"

if [ "$STEP" = "build" ] || [ "$STEP" = "all" ]; then
  echo "== census build   $(date -u '+%H:%M:%SZ')  main $(cd "$WT" && git rev-parse --short HEAD)"
  echo "   dir $DIR   zig $(zig version)   node $(node -v)"
  echo "   PROF_CFLAGS=$SCRIPTC_PROF_CFLAGS"
  S=$(date +%s)
  ( cd "$APP" && node "$CLI" build "tree/packages/fake-server/$DIR/messaging.bench.ts" \
      --backend c --provenance-sources -o "$OUT/messaging.bench.exe" ) \
      >"$OUT/build.log" 2>&1
  RC=$?
  E=$(date +%s)
  echo "   BUILD_EXIT=$RC  BUILD_SECONDS=$((E - S))  size=$(stat -c %s "$OUT/messaging.bench.exe" 2>/dev/null || echo n/a)"
  [ $RC -ne 0 ] && { echo "   BUILD FAILED, last errors:"; tr -d '\r' <"$OUT/build.log" | grep -oE 'SC[0-9]{4}.*' | grep -vE '^SC900[234]' | head -20; exit 1; }
fi

if [ "$STEP" = "run" ] || [ "$STEP" = "all" ]; then
  # The shipped default workload, so the counts match the profile they explain.
  unset ZAPO_BENCH_CONTACTS ZAPO_BENCH_CONTACT_DEVICES ZAPO_BENCH_GROUPS \
        ZAPO_BENCH_GROUP_MEMBERS ZAPO_BENCH_MESSAGES 2>/dev/null || true
  export ZAPO_BENCH_JSON=1
  BENCH_NODE=${BENCH_NODE:-$(command -v node)}
  export BENCH_NODE
  # import.meta.dirname bakes the BUILD-TIME source dir, so the binary finds
  # server-process.ts there; cd'ing to bench-bench keeps tsx resolvable.
  RUNDIR=$APP/tree/packages/fake-server/bench-bench

  # ARMED first: the positive control. SCR_ARRCEN_ARM plants slices of
  # src=41/n=7 before main, so "the census reported zero" and "the census
  # never compiled in" stay distinguishable. NOTE: the planting constructor is
  # `static`, so it runs once per TRANSLATION UNIT while `planted` is shared --
  # the planted rows read n x (TU count), not n. An armed run's slice counts
  # are therefore contaminated and MUST NOT be read as the real ones.
  echo "== armed control run   $(date -u '+%H:%M:%SZ')"
  ( cd "$RUNDIR" && SCR_ARRCEN_ARM=5 SCR_ARRCEN_OUT="$OUT/armed.txt" \
      "$OUT/messaging.bench.exe" ) >"$OUT/armed.run.out" 2>&1
  echo "   exit=$?  planted=$(grep -o 'planted=[0-9]*' "$OUT/armed.txt" 2>/dev/null || echo NO-REPORT)"

  echo "== unarmed census run  $(date -u '+%H:%M:%SZ')   (THE numbers)"
  ( cd "$RUNDIR" && SCR_ARRCEN_OUT="$OUT/census.txt" \
      "$OUT/messaging.bench.exe" ) >"$OUT/census.run.out" 2>&1
  echo "   exit=$?  report=$(test -s "$OUT/census.txt" && echo written || echo MISSING)"
fi
