#!/bin/sh
# MIXED MODE: fibers and stackless frames in one scheduler, waking each other.
#
#   sh tests/perf/corostate/run-mixed.sh              # must pass
#   sh tests/perf/corostate/run-mixed.sh --als-blind  # must FAIL
#   sh tests/perf/corostate/run-mixed.sh --no-frames  # must FAIL
#
# A three-level chain A->B->C where each level independently is a fiber or a
# stackless frame, all 8 combinations compared turn-for-turn against
# all-fibers, over four variants (NORMAL, THROW, ALS, ZERO).
#
# THE TWO BLIND ARMS ARE WHY THE GREEN MEANS ANYTHING, and each disables a
# different control:
#
#   --no-frames  makes spawn_level ignore the bitmask and build only fibers.
#                Every row then compares the baseline against itself and all
#                32 match for the most boring possible reason. The spawn-kind
#                control must catch it.
#   --als-blind  drops the AsyncLocalStorage swap from scr_coro_resume_entry,
#                so a resumed frame reads whatever is ambient instead of its
#                own captured snapshot. scr_switch did that swap for free and
#                a state machine does not, so this is the regression most
#                likely to ship silently. Both the absolute-value control and
#                the mode comparison must catch it.
#
# The ALS arm needs the absolute check as well as the comparison: the
# comparison is arm-against-arm, so a value that is wrong the SAME way in
# every arm would pass it.
set -eu

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
OUT=${COROSTATE_OUT:-G:/blocks/stackless-rt/out}
ZIG=${ZIG:-G:/tools/zig/zig.exe}
S="$REPO/packages/runtime/src"

export TMP='G:\blocks\stackless-rt\tmp'
export TEMP="$TMP"
export TMPDIR="$TMP"
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\global'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\local'
mkdir -p "$OUT"

DEFS=""
EXE="$OUT/coromixed.exe"
BLIND=""
case "${1:-}" in
  --als-blind) DEFS="-DSCR_CORO_ALS_BLIND"; EXE="$OUT/coromixed-alsblind.exe"; BLIND=1 ;;
  --no-frames) DEFS="-DSCR_MIXED_NO_FRAMES"; EXE="$OUT/coromixed-noframes.exe"; BLIND=1 ;;
  "") ;;
  *) echo "unknown arm: $1" >&2; exit 2 ;;
esac

# Always rebuild: a stale binary is how a net reports a verdict about code
# that is no longer there.
rm -f "$EXE"
"$ZIG" cc -target x86_64-windows-gnu -O1 -g0 -I"$S" \
  -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601 -DSCR_CORO_LANE $DEFS \
  "$REPO/tests/perf/corostate/coromixed.c" "$S/scr_coro.c" \
  "$S/scr_number.c" "$S/scr_string.c" "$S/scr_array.c" "$S/scr_bytes.c" \
  "$S/scr_bytes_io.c" "$S/scr_map.c" "$S/scr_closure.c" "$S/scr_object.c" \
  "$S/scr_union.c" "$S/scr_exception.c" "$S/scr_error.c" "$S/scr_console.c" \
  "$S/scr_lib.c" "$S/scr_path.c" "$S/scr_json.c" "$S/scr_async.c" \
  "$S/scr_child.c" "$S/scr_cycle.c" "$S/scr_random_fill.c" \
  "$S/scr_stack_margin.c" "$S/scr_win.c" "$S/scr_async_dyn.c" \
  -ladvapi32 -liphlpapi -lws2_32 -o "$EXE" 2>/dev/null
[ -x "$EXE" ] || { echo "build failed, refusing to report a verdict" >&2; exit 2; }

set +e
"$EXE"
rc=$?
set -e

if [ -n "$BLIND" ]; then
  if [ "$rc" -eq 0 ]; then
    echo
    echo "FAIL: the blind arm PASSED -- this net cannot detect its own regression."
    exit 1
  fi
  echo
  echo "(blind arm went red as required)"
  exit 0
fi
exit "$rc"
