#!/bin/sh
# delivery-ab-knob.sh - delivery-ab.sh with a PER-ARM ENVIRONMENT, for a
# treatment that is an env knob rather than a second binary.
#
# The rotation, the workload plumbing and the modestat call are COPIED
# VERBATIM from delivery-ab.sh and must stay that way: position within a
# repetition is a 28.7 MiB effect on this box, so an arm order invented here
# would reproduce the artifact instead of measuring through it. The only
# addition is CTL_ENV / TRT_ENV, prepended to the child's environment.
#
# WHY IT EXISTS. delivery-ab.sh selects an arm by EXE PATH. The cycle arena's
# page return is SCR_CYCLE_PAGERETURN, an env knob, deliberately: both arms
# are then one binary and the comparison carries no code-layout confound,
# which building a -DSCR_CYC_PAGERETURN=0 control would reintroduce -- and an
# A/A floor taken on ONE binary cannot bound a layout difference.
#
# FOLD THIS BACK into delivery-ab.sh when both branches land; it is two
# variable expansions, not a second design.
#
# delivery-ab.sh - the A/B that will measure what the memory work actually
# delivered, and the A/A floor it has to be scored against.
#
#   sh delivery-ab.sh floor  <exe>              N   # A/A, same binary twice
#   sh delivery-ab.sh ab     <ctlExe> <treatExe> N  # the real comparison
#
# WHY A FLOOR FIRST, AND WHY IT IS NOT OPTIONAL. A number without a floor is
# not a number. The A/A pass runs the SAME binary under both labels; anything
# it reports is noise by construction, and the real A/B is only readable
# against it. If the A/A does not come back DRAW on every metric, the rig is
# not measuring what it claims and no treatment figure from it means anything.
#
# THE ARM ORDER ROTATES. Position within a repetition is a real effect on this
# box (page cache, thermal, whatever else), so the arm that goes first
# alternates. Without that, a position bias is indistinguishable from a
# treatment effect -- and mode-matching can silently undo the rotation, which
# is exactly why modestat.mjs refuses when every surviving repetition shares
# one order.
#
# THE SHIPPING ARM ONLY. Instrumented builds differ in size and in allocation
# behaviour -- 36.73 MB with memmap, 31.72 MB with prof, against 32.09 MB
# shipping -- and none is interchangeable with another. Pass the plain build.
#
# Reads the workload from the environment so the floor and the comparison
# cannot drift apart:
#   CHUNKS 8  CONVS 400  MSGS 6  TEXTLEN 300  IDLE_S 60  SETTLE_MS 20000
set -u

MODE=${1:?usage: delivery-ab.sh floor|ab ...}
case "$MODE" in
  floor) CTL=${2:?exe}; TRT=$CTL; N=${3:-6}; CARM=base; TARM=base2 ;;
  ab)    CTL=${2:?control exe}; TRT=${3:?treat exe}; N=${4:-6}; CARM=base; TARM=fixed ;;
  # knob: ONE exe, arms separated by CTL_ENV / TRT_ENV
  knob)  CTL=${2:?exe}; TRT=$CTL; N=${3:-6}; CARM=base; TARM=fixed ;;
  *)     echo "usage: delivery-ab-knob.sh floor <exe> N | ab <ctl> <treat> N | knob <exe> N"; exit 2 ;;
esac

REPO=${REPO_ROOT:-$(cd "$(dirname "$0")/../../../.." && pwd)}
OUT=${DELIVERY_OUT:-/tmp/delivery}
LOG=$OUT/pair.log
: "${ZAPO_FAKE_SERVER:?set it to the zapo checkout packages/fake-server}"
ZR=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)
mkdir -p "$OUT"
: > "$LOG"

W="CHUNKS=${CHUNKS:-8} CONVS=${CONVS:-400} MSGS=${MSGS:-6} TEXTLEN=${TEXTLEN:-300}"
W="$W IDLE_S=${IDLE_S:-60} SETTLE_MS=${SETTLE_MS:-20000} PRESYNC_MS=${PRESYNC_MS:-15000}"
W="$W CHUNK_GAP_MS=${CHUNK_GAP_MS:-0}"
echo "workload: $W"
echo "control=$CARM $CTL"
echo "treat  =$TARM $TRT"

run_one() {
  arm=$1; rep=$2; pos=$3; exe=$4
  tag="${arm}-r${rep}"
  echo "===ARM $arm REP $rep POS $pos TAG $tag" >> "$LOG"
  echo "  rep $rep pos $pos  $arm"
  case "$arm" in
    "$CARM") AENV=${CTL_ENV:-} ;;
    *)       AENV=${TRT_ENV:-} ;;
  esac
  echo "  env: $AENV"
  MEMRIG_OUT="$OUT" \
  MEMRIG_PMON="$REPO/tests/perf/zapo-rest/harness/pmon.exe" \
  sh -c "cd '$ZR' && $AENV node --import tsx '$REPO/tests/perf/zapo-rest/harness/memrig.mts' '$exe' '$tag' $W" \
    > "$OUT/$tag.driver.log" 2>&1 || echo "  RUN FAILED: $tag (see $tag.driver.log)"
}

r=1
while [ "$r" -le "$N" ]; do
  # rotate: odd repetitions run the control first, even ones the treatment
  if [ $((r % 2)) -eq 1 ]; then
    run_one "$CARM" "$r" 1 "$CTL"; run_one "$TARM" "$r" 2 "$TRT"
  else
    run_one "$TARM" "$r" 1 "$TRT"; run_one "$CARM" "$r" 2 "$CTL"
  fi
  r=$((r + 1))
done

echo
node "$REPO/tests/perf/zapo-rest/harness/nobuf/modestat.mjs" "$LOG" \
  --runroot "$OUT" --control "$CARM" --treat "$TARM" --label "$MODE"
