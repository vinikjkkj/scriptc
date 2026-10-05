#!/bin/sh
# Does SCR_TICK_POISON reach the STACKLESS lane?
#
#   sh tests/perf/corostate/run-poison.sh           # must pass
#   sh tests/perf/corostate/run-poison.sh --blind   # must FAIL
#
# WHY THIS EXISTS. scr_tick_poison() is static inside scr_async.c and for a
# while scr_coro.c never consulted it, so a poisoned run moved every FIBER
# turn count and left every STACKLESS one untouched. The poison's own comment
# says it exists to catch "the exact mistake a stackless re-lowering of
# async/await is most likely to make" -- so the net was blind to precisely the
# lane it was built to watch, and a green table could not tell correctness
# from coincidence.
#
# The check asserts BOTH halves, because either alone passes while broken:
#
#   1. the poison MOVES the stackless lane at all        (it did not, before)
#   2. it moves it by the SAME amount as the fiber lane  (a lane that shifted
#      by a different amount would be a real divergence wearing a green badge)
#
# And --blind rebuilds with the hook removed, reproducing the regression. It
# must fail; that is the only thing that makes the ordinary green mean
# anything.
set -eu

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
OUT=${COROSTATE_OUT:-G:/blocks/stackless-rt/out}
ZIG=${ZIG:-G:/tools/zig/zig.exe}
S="$REPO/packages/runtime/src"
EXE="$OUT/corostate.exe"

export TMP='G:\blocks\stackless-rt\tmp'
export TEMP="$TMP"
export TMPDIR="$TMP"
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\global'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\local'
mkdir -p "$OUT"

BLIND=""
if [ "${1:-}" = "--blind" ]; then
  BLIND="-DSCR_CORO_POISON_BLIND"
  EXE="$OUT/corostate-blind.exe"
fi

# Always rebuild the arm under test: a stale binary is how a net reports a
# verdict about code that is no longer there.
rm -f "$EXE"
"$ZIG" cc -target x86_64-windows-gnu -O1 -g0 -I"$S" \
  -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601 -DSCR_CORO_LANE $BLIND \
  "$REPO/tests/perf/corostate/corostate.c" "$S/scr_coro.c" \
  "$S/scr_number.c" "$S/scr_string.c" "$S/scr_array.c" "$S/scr_bytes.c" \
  "$S/scr_bytes_io.c" "$S/scr_map.c" "$S/scr_closure.c" "$S/scr_object.c" \
  "$S/scr_union.c" "$S/scr_exception.c" "$S/scr_error.c" "$S/scr_console.c" \
  "$S/scr_lib.c" "$S/scr_path.c" "$S/scr_json.c" "$S/scr_async.c" \
  "$S/scr_child.c" "$S/scr_cycle.c" "$S/scr_random_fill.c" \
  "$S/scr_stack_margin.c" "$S/scr_win.c" \
  -ladvapi32 -liphlpapi -lws2_32 -o "$EXE" 2>/dev/null
[ -x "$EXE" ] || { echo "build failed, refusing to report a verdict" >&2; exit 2; }

turns() { # $1 = arm name; one turn count per case, in order
  "$EXE" 2>/dev/null | awk -v arm="$1" '$1==arm {
    for (i = 1; i <= NF; i++) if ($i ~ /^turns=/) { sub(/turns=/, "", $i); print $i }
  }'
}

CLEAN_F=$(turns fiber)
CLEAN_S=$(turns stackless)
POIS_F=$(SCR_TICK_POISON=1 turns fiber)
POIS_S=$(SCR_TICK_POISON=1 turns stackless)

n=$(echo "$CLEAN_F" | wc -l)
[ "$n" -gt 0 ] || { echo "no turn counts parsed -- the filter is miscalibrated" >&2; exit 2; }

echo "case   fiber(clean -> poison)   stackless(clean -> poison)"
i=1
moved=0
bad=0
while [ "$i" -le "$n" ]; do
  cf=$(echo "$CLEAN_F" | sed -n "${i}p"); pf=$(echo "$POIS_F" | sed -n "${i}p")
  cs=$(echo "$CLEAN_S" | sed -n "${i}p"); ps=$(echo "$POIS_S" | sed -n "${i}p")
  df=$((pf - cf)); ds=$((ps - cs))
  flag=""
  if [ "$df" -ne "$ds" ]; then
    flag="   <-- LANES DISAGREE"
    bad=$((bad + 1))
  fi
  [ "$ds" -gt 0 ] && moved=$((moved + 1))
  printf "  %d      %2s -> %2s (+%s)              %2s -> %2s (+%s)%s\n" \
    "$i" "$cf" "$pf" "$df" "$cs" "$ps" "$ds" "$flag"
  i=$((i + 1))
done
echo

rc=0
if [ "$moved" -eq 0 ]; then
  echo "RED: the poison never moved the stackless lane -- the net is blind to"
  echo "     the lane it exists to watch."
  rc=1
elif [ "$bad" -ne 0 ]; then
  echo "RED: $bad case(s) where the two lanes shifted by different amounts."
  rc=1
else
  echo "GREEN: the poison reaches the stackless lane, and both lanes shift"
  echo "       together."
fi

if [ -n "$BLIND" ]; then
  if [ "$rc" -eq 0 ]; then
    echo "FAIL: the BLIND build passed -- this net cannot detect its own regression."
    exit 1
  fi
  echo "(blind arm went red as required)"
  exit 0
fi
exit "$rc"
