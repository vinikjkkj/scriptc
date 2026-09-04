#!/bin/sh
# Interleaved paired runner for the zapo messaging bench's store arms.
#
# Every arm of a rep runs BACK TO BACK so a ratio can be formed inside the
# rep. This host drifts ~10% per rep -- the same memory arm read 22.3 s at
# 11:59 and 30.2 s at 12:34 in one session -- so an across-rep ratio is
# worthless and a median of per-rep ratios is not.
#
#   pair.sh <binary> <tag> <reps> <arm> [arm...]
#
# An arm is  label:store[:providers[:pathmode[:cache]]]
#   label      what the parsers call it; must be unique within a run
#   store      ZAPO_BENCH_STORE, memory or sqlite
#   providers  ZAPO_BENCH_PROVIDERS -- only a probe build reads this; the
#              shipped bench ignores it, so "default" is the shipped layout
#   pathmode   "memdb" points ZAPO_BENCH_SQLITE_PATH at :memory:
#   cache      ZAPO_BENCH_SQLITE_CACHE, a cache_size pragma -- probe build only
#
# Environment, all with defaults:
#   PAIR_RUNENV  a shell file sourced first (PATH, BENCH_NODE, BLAB, CP)
#   BLAB         the bench-prof directory to cd into
#   CP           cpuphase.exe, built from tests/perf/cpuphase/cpuphase.c
#   PAIR_TMP     where the per-rep sqlite files go. MUST be outside the
#                worktree: a tmp dir inside it reddens the build cache.
set -u
[ -n "${PAIR_RUNENV-}" ] && . "$PAIR_RUNENV"
BIN=$1; TAG=$2; N=$3; shift 3
ARMS="$*"
: "${BLAB:?set BLAB to the bench-prof directory}"
: "${CP:?set CP to cpuphase.exe}"
: "${PAIR_TMP:=${TMPDIR:-/tmp}}"
cd "$BLAB" || exit 1
echo "### binary  : $BIN"
echo "### md5     : $(md5sum "$BIN" | cut -d' ' -f1)"
echo "### arms    : $ARMS   reps: $N"
echo "### server  : ${BENCH_NODE-<inherited>}"
echo "### PATHnode: $(node --version)"
echo "### start   : $(date)"
r=1
while [ "$r" -le "$N" ]; do
  for arm in $ARMS; do
    label=$(echo "$arm" | cut -d: -f1)
    store=$(echo "$arm" | cut -d: -f2)
    prov=$(echo "$arm" | cut -d: -f3)
    [ -z "$prov" ] && prov=default
    pathmode=$(echo "$arm" | cut -d: -f4)
    cache=$(echo "$arm" | cut -d: -f5)
    DB="$PAIR_TMP/$TAG-$label-$r.sqlite"
    rm -f "$DB" "$DB-wal" "$DB-shm"
    if [ "$pathmode" = "memdb" ]; then DB=":memory:"; fi
    export ZAPO_BENCH_STORE="$store"
    export ZAPO_BENCH_SQLITE_PATH="$DB"
    export ZAPO_BENCH_PROVIDERS="$prov"
    if [ -n "$cache" ]; then export ZAPO_BENCH_SQLITE_CACHE="$cache"
    else unset ZAPO_BENCH_SQLITE_CACHE; fi
    echo "===ARM $label rep $r $(date +%H:%M:%S)  store=$store providers=$prov cache=${cache:-compiled-default}"
    # Keep every line the parsers read: "[phase] " (the bench's own per-phase
    # wall), "[cpumem] " (cpuphase's peak RSS AND its per-phase rss table),
    # and anything that looks like a failure -- a truncated run must be
    # visible as truncated rather than silently dropped from a median.
    "$CP" -- "$BIN" 2>&1 | rg -N '^\[phase\] |^\[cpumem\] |^\[probe\] |RUN EXIT|^\[Error|error:'
    if [ "$DB" != ":memory:" ]; then
      echo "dbsize=$(stat -c %s "$DB" 2>/dev/null || echo 0) wal=$(stat -c %s "$DB-wal" 2>/dev/null || echo 0) shm=$(stat -c %s "$DB-shm" 2>/dev/null || echo 0)"
      rm -f "$DB" "$DB-wal" "$DB-shm"
    fi
  done
  r=$((r + 1))
done
echo "### end     : $(date)"
