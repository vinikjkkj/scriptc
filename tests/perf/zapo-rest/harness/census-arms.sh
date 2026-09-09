#!/bin/sh
# census-arms.sh - the instrument combinations for an itemised census of the
# settled zapo-rest process, and the ORDER they have to be passed in.
#
#   sh tests/perf/zapo-rest/harness/census-arms.sh <arm> build
#   sh tests/perf/zapo-rest/harness/census-arms.sh <arm> run <runTag>
#
# arms: plain | arena | objects | memmap
#
# WHY THIS FILE EXISTS. memrig.mts's own header records that every settled
# figure this project quoted -- 163.39 -> 104.50 MiB, the ~52 MiB handed back
# -- was taken with a driver that lived outside version control, and became
# unreproducible the moment its worktree was purged. The driver is committed
# now; the RECIPE that arms it was not, and it is just as load-bearing. Which
# headers, in which order, with which -D, is not recoverable by reading any
# one of them.
#
# THE _Exit ORDER IS A CONTRACT AND NOT A PREFERENCE. A compiled program's
# process.exit() lowers to _Exit and skips every atexit handler, so each
# census lane interposes _Exit and chains to the next by include-guard name.
# scr_pool_stat.h #errors if anything interposed before it; scr_heap_census.h
# #errors if a lane other than cycensus did. The order that composes is:
#
#     poolstat -> prof / cycensus / strcen -> heapcensus -> dyncensus / u16census
#
# pagecensus reports at exit, or after every collector pass under
# SCR_PAGECEN_EVERY, and does not contend for the _Exit chain, so it is free
# to sit anywhere; it goes last.
#
# WHY THREE INSTRUMENTED ARMS AND NOT ONE BINARY. Every instrument is inside
# the peak it reports: memmap's own INSTRUMENT class has measured 3.5-6.6 MiB
# and is NOT subtracted from the wsPeak figures, and cycensus and dyncensus
# each carry a pointer table. Loading all of them into one process would
# perturb the settled figure this census exists to explain. `plain` is the
# uninstrumented control that says what the number actually is.
set -u

ARM=${1:-}; STEP=${2:-}; TAG=${3:-census}
REPO=${REPO_ROOT:-$(cd "$(dirname "$0")/../../../.." && pwd)}
P=$REPO/tests/perf
OUTROOT=${CENSUS_OUT:-$REPO/tests/perf/zapo-rest/census-run}

case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) PW=$(cygpath -w "$P") ;;
  *)                    PW=$P ;;
esac

case "$ARM" in
  plain)   FLAGS="" ;;
  # The decisive arm for the page-decommit question.
  #   cycstat      chunk counts for BOTH arenas (the string arena has no arfree)
  #   heapcensus   exact-size histogram of busy blocks, every heap
  #   pagecensus   per-chunk occupancy and the arena page ceiling
  arena)   FLAGS="-include $PW/cycstat/scr_cyc_stat.h -DSCR_CYCSTAT_ON -include $PW/heapcensus/scr_heap_census.h -include $PW/pagecensus/scr_page_census.h -DSCR_PAGECEN_ON" ;;
  # What the live objects ARE, and what boxing into `unknown` costs.
  objects) FLAGS="-include $PW/cycensus/scr_cyc_census.h -include $PW/dyncensus/scr_str_census.h -I$PW/dyncensus -include $PW/dyncensus/scr_dyn_census.h" ;;
  # The top-down region map, which closes against RSS by construction.
  memmap)  FLAGS="-include $PW/memmap/scr_memmap.h -DSCR_MEMMAP" ;;
  *) echo "usage: census-arms.sh {plain|arena|objects|memmap} {build|run} [runTag]"; exit 2 ;;
esac

OUT=$OUTROOT/$ARM
mkdir -p "$OUT"

if [ "$STEP" = build ]; then
  # A DISTINCT -o DIRECTORY PER ARM, and it is load-bearing rather than
  # tidiness: the compiler names its intermediate from the entry basename and
  # removes it on success unless --keep-c, so two arms sharing a directory
  # delete each other's intermediate mid-build. A distinct -o FILENAME is not
  # enough. (app182/README.md, "Build".)
  [ -n "$FLAGS" ] && export SCRIPTC_PROF_CFLAGS="$FLAGS"
  # profFlavor() folds the CONTENTS of every -include'd file into both cache
  # keys (77735c1ad), and every instrument here now arrives that way -- the
  # two walk headers that reached the compiler by #include from a runtime .c,
  # and were therefore outside the key, went with tests/perf/chunkcensus.
  # So the cache is safe to leave on for every arm.
  echo "=== build $ARM"
  echo "=== SCRIPTC_PROF_CFLAGS: ${SCRIPTC_PROF_CFLAGS:-<none>}"
  ( cd "$REPO" && node packages/cli/dist/main.js build \
      tests/perf/zapo-rest/app182/zapo-rest.ts \
      -o "$OUT/zapo-rest-182.exe" --provenance-sources --keep-c ) || exit 1
  # Read the backend lane off the ARTIFACT, never off the absence of a message.
  ls "$OUT" | grep -E '[.](ll|c)$' | sed 's/^/    emitted: /'
  exit 0
fi

if [ "$STEP" = run ]; then
  : "${ZAPO_FAKE_SERVER:?set it to the zapo checkout's packages/fake-server}"
  export MEMRIG_OUT="$OUTROOT/rig/$TAG"
  export MEMRIG_PMON="$P/zapo-rest/harness/pmon.exe"
  mkdir -p "$MEMRIG_OUT"
  # The documented workload. SCR_PAGECEN_EVERY reports after every collector
  # pass, so the arena's occupancy is sampled THROUGH the burst rather than
  # only at the ends; it is passed on the arena arm only, since the other
  # binaries carry no pagecensus hook and would silently write nothing.
  KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000"
  case "$ARM" in
    arena)  KNOBS="$KNOBS SCR_PAGECEN_EVERY=1" ;;
    memmap) KNOBS="$KNOBS SCR_MEMMAP_MS=2000 SCR_MEMMAP_SELFTEST=32" ;;
  esac
  echo "=== run $ARM/$TAG: $KNOBS"
  ( cd "$REPO" && node --import tsx tests/perf/zapo-rest/harness/memrig.mts \
      "$OUT/zapo-rest-182.exe" "$TAG" $KNOBS )
  exit $?
fi

echo "usage: census-arms.sh {plain|arena|objects|memmap} {build|run} [runTag]"
exit 2
