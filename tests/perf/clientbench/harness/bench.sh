#!/bin/sh
# bench.sh <tag> <reps> <arm> [arm...]      the paired, interleaved runner
#
#   arm = LABEL:LANE:SOURCE
#     LANE   = exe   -> run out/<SOURCE>/messaging.bench.exe
#              node  -> run the bench dir's source under node --import tsx
#     SOURCE = a build tag (lane exe) or a bench dir name (lane node)
#
#   sh bench.sh floor 3 a:exe:np-strict b:exe:np-strict        # an A/A floor
#   sh bench.sh main  5 c:exe:np-strict llvm:exe:np-llvm node:node:bench-bench
#
# EVERY ARM OF A REP RUNS BACK TO BACK, so a ratio is formed INSIDE the rep.
# This host drifts ~10% per rep (the same memory arm read 22.3 s at 11:59 and
# 30.2 s at 12:34 in one recorded session), so an across-rep ratio is
# worthless and a median of per-rep ratios is not. benchstat.mjs only ever
# divides two arms of the SAME rep.
#
# Every run is wrapped in bin/cpuphase.exe, which echoes the child's stdout
# byte-for-byte and samples the child's kernel counters from OUTSIDE:
# QueryProcessCycleTime for cycles, GetProcessTimes for the user/kernel split,
# PeakWorkingSetSize for peak RSS. That is the only instrument both lanes can
# share -- the compiled lane has no process.cpuUsage() and no V8 heap.
#
# The bench dir is a COPY. zapo is read-only test input.
set -u
. <blocks>/clientbench/lab/env.sh || exit 1

TAG=$1; REPS=$2; shift 2
ARMS="$*"
OUT="$LAB/out/bench-$TAG.txt"
CP="$LAB/bin/cpuphase.exe"
[ -x "$CP" ] || { echo "no cpuphase.exe at $CP -- build it first"; exit 2; }

# Which node runs the fake-server child, named EXPLICITLY. A compiled parent
# cannot ask itself, and the differential's habit of spawning a bare `node`
# is how a v22-vs-v25 mix-up becomes a 62-failure "regression".
BENCH_NODE=${BENCH_NODE:-$(command -v node)}
export BENCH_NODE
[ -x "$BENCH_NODE" ] || { echo "BENCH_NODE=$BENCH_NODE is not executable"; exit 2; }

# Workload. CB_FULL=1 is the shipped default; anything else is a named
# reduction and is recorded as such.
if [ "${CB_FULL:-0}" = "1" ]; then
  WORKLOAD="shipped-default (1000x2 contacts, 4x500 groups, 1000 msgs/scenario)"
  unset ZAPO_BENCH_CONTACTS ZAPO_BENCH_CONTACT_DEVICES ZAPO_BENCH_GROUPS ZAPO_BENCH_GROUP_MEMBERS ZAPO_BENCH_MESSAGES 2>/dev/null || true
else
  export ZAPO_BENCH_CONTACTS=${ZAPO_BENCH_CONTACTS:-20}
  export ZAPO_BENCH_CONTACT_DEVICES=${ZAPO_BENCH_CONTACT_DEVICES:-2}
  export ZAPO_BENCH_GROUPS=${ZAPO_BENCH_GROUPS:-1}
  export ZAPO_BENCH_GROUP_MEMBERS=${ZAPO_BENCH_GROUP_MEMBERS:-10}
  export ZAPO_BENCH_MESSAGES=${ZAPO_BENCH_MESSAGES:-20}
  WORKLOAD="REDUCED smoke (contacts=$ZAPO_BENCH_CONTACTS groups=$ZAPO_BENCH_GROUPS members=$ZAPO_BENCH_GROUP_MEMBERS msgs=$ZAPO_BENCH_MESSAGES)"
fi
export ZAPO_BENCH_JSON=1

{
  echo "### bench-tag  : $TAG"
  echo "### arms       : $ARMS"
  echo "### reps       : $REPS"
  echo "### workload   : $WORKLOAD"
  echo "### started    : $(date)"
  echo "### host-load  : $(nproc 2>/dev/null || echo '?') cpus"
  echo "### target     : ${SCRIPTC_TARGET}"
  echo "### zig        : $(zig version)"
  echo "### cc         : ${SCRIPTC_CC}"
  echo "### bench-node : $BENCH_NODE -> $("$BENCH_NODE" --version)"
  echo "### PATH node  : $(command -v node) -> $(node --version)"
} > "$OUT"

# Per-arm provenance, resolved once and recorded, so a log can never be read
# against the wrong binary.
for arm in $ARMS; do
  label=$(echo "$arm" | cut -d: -f1)
  lane=$(echo "$arm" | cut -d: -f2)
  src=$(echo "$arm" | cut -d: -f3)
  if [ "$lane" = "exe" ]; then
    exe="$LAB/out/$src/messaging.bench.exe"
    [ -f "$exe" ] || { echo "arm $label: no exe at $exe" | tee -a "$OUT"; exit 2; }
    echo "### arm $label : exe  $exe  $(stat -c %s "$exe") bytes  md5 $(md5sum "$exe" | cut -d' ' -f1)" >> "$OUT"
  else
    dir="$APP/tree/packages/fake-server/$src"
    [ -f "$dir/messaging.bench.ts" ] || { echo "arm $label: no source at $dir" | tee -a "$OUT"; exit 2; }
    echo "### arm $label : node $dir  entry md5 $(md5sum "$dir/messaging.bench.ts" | cut -d' ' -f1)" >> "$OUT"
  fi
done

r=1
while [ "$r" -le "$REPS" ]; do
  for arm in $ARMS; do
    label=$(echo "$arm" | cut -d: -f1)
    lane=$(echo "$arm" | cut -d: -f2)
    src=$(echo "$arm" | cut -d: -f3)
    if [ "$lane" = "exe" ]; then
      # import.meta.dirname bakes the BUILD-TIME source directory, so the
      # binary finds server-process.ts there whatever the cwd is; cd'ing to
      # the bench dir keeps `tsx` resolvable for the child all the same.
      dir="$APP/tree/packages/fake-server/bench-bench"
      cmd="$LAB/out/$src/messaging.bench.exe"
      set -- "$cmd"
    else
      dir="$APP/tree/packages/fake-server/$src"
      set -- node --import tsx "$dir/messaging.bench.ts"
    fi
    echo "===ARM $label REP $r $(date +%H:%M:%S) lane=$lane src=$src" >> "$OUT"
    ( cd "$dir" && "$CP" -- "$@" ) >> "$OUT" 2>&1
    echo "===ARMEXIT $label REP $r rc=$?" >> "$OUT"
  done
  r=$((r + 1))
done
echo "### finished   : $(date)" >> "$OUT"
echo "BENCH_DONE $OUT"
