#!/bin/sh
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
  floor) CTL=${2:?exe}; TRT=$CTL; N=${3:-6}; CARM=base; TARM=base2
         KNOB=""; KCTL=""; KTRT="" ;;
  ab)    CTL=${2:?control exe}; TRT=${3:?treat exe}; N=${4:-6}; CARM=base; TARM=fixed
         KNOB=""; KCTL=""; KTRT="" ;;
  # THE PREFERRED SHAPE when the change is env-gated, and page return is:
  # scr_cycle.c reads SCR_CYCLE_PAGERETURN. ONE binary runs both arms, so the
  # comparison carries no build confound at all -- not a different compile, not
  # a different dependency tree, not a different entry. Everything this project
  # got wrong tonight about arms came from two binaries being compared as if
  # they were one; this shape makes that impossible.
  #   delivery-ab.sh abknob <exe> SCR_CYCLE_PAGERETURN 0 1 6
  abknob) CTL=${2:?exe}; TRT=$CTL; KNOB=${3:?env var}; KCTL=${4:?control value}
          KTRT=${5:?treat value}; N=${6:-6}; CARM=off; TARM=on ;;
  *)     echo "usage: delivery-ab.sh floor <exe> N"
         echo "       delivery-ab.sh ab <ctl> <treat> N"
         echo "       delivery-ab.sh abknob <exe> <VAR> <ctlVal> <treatVal> N"; exit 2 ;;
esac

REPO=${REPO_ROOT:-$(cd "$(dirname "$0")/../../../.." && pwd)}
OUT=${DELIVERY_OUT:-/tmp/delivery}
LOG=$OUT/pair.log
: "${ZAPO_FAKE_SERVER:?set it to the zapo checkout packages/fake-server}"
ZR=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)
mkdir -p "$OUT"
# APPEND=1 pools further repetitions into an existing run instead of starting
# over: the pair log is kept and REP_START continues the numbering, so the
# rotation carries on in phase (odd repetitions run the control first). This
# exists because an underpowered result is fixed by MORE runs of the same
# thing, and re-running from scratch would throw away the ones already paid for.
if [ -z "${APPEND:-}" ]; then : > "$LOG"; fi

W="CHUNKS=${CHUNKS:-8} CONVS=${CONVS:-400} MSGS=${MSGS:-6} TEXTLEN=${TEXTLEN:-300}"
W="$W IDLE_S=${IDLE_S:-60} SETTLE_MS=${SETTLE_MS:-20000} PRESYNC_MS=${PRESYNC_MS:-15000}"
W="$W CHUNK_GAP_MS=${CHUNK_GAP_MS:-0}"
echo "workload: $W"
echo "control=$CARM $CTL ${KNOB:+($KNOB=$KCTL)}"
echo "treat  =$TARM $TRT ${KNOB:+($KNOB=$KTRT)}"

run_one() {
  arm=$1; rep=$2; pos=$3; exe=$4
  tag="${arm}-r${rep}"
  # The knob value for THIS arm, recorded in the pair log beside the tag so a
  # reader can see which arm was which without trusting the arm name.
  kv=""
  if [ -n "${KNOB:-}" ]; then
    if [ "$arm" = "$CARM" ]; then kv="$KNOB=$KCTL"; else kv="$KNOB=$KTRT"; fi
  fi
  echo "===ARM $arm REP $rep POS $pos TAG $tag ${kv}" >> "$LOG"
  echo "  rep $rep pos $pos  $arm"
  MEMRIG_OUT="$OUT" \
  MEMRIG_PMON="$REPO/tests/perf/zapo-rest/harness/pmon.exe" \
  sh -c "cd '$ZR' && ${kv:+env $kv }node --import tsx '$REPO/tests/perf/zapo-rest/harness/memrig.mts' '$exe' '$tag' $W" \
    > "$OUT/$tag.driver.log" 2>&1 || echo "  RUN FAILED: $tag (see $tag.driver.log)"
}

r=${REP_START:-1}
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
