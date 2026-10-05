#!/bin/sh
# Speed: fiber switch vs stackless resume, both arms in ONE process so they
# share a clock and a thermal state.
#
#   sh tests/perf/corostate/run-bench.sh          # pool ON  (steady state)
#   sh tests/perf/corostate/run-bench.sh --nopool # pool OFF (the peak regime)
#
# BOTH ARE REAL CONFIGURATIONS AND THEY ANSWER DIFFERENT QUESTIONS. With the
# pool on (cap 4096) and tasks completing one at a time, every fiber spawn is
# a pool HIT: no CreateFiberEx happens and creation looks cheap. That is
# steady state. At the zapo peak 24,246 fibers are live simultaneously, so the
# pool is drained and every further spawn is a real CreateFiberEx with a 1 MiB
# reserve -- which is what --nopool measures. Quoting only the pooled number
# would understate creation by two orders of magnitude.
#
# SCR_FIBER_POOL is read once and cached, so it has to come from the
# environment rather than from inside the program.
set -eu
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
S="$REPO/packages/runtime/src"
OUT=${COROSTATE_OUT:-G:/blocks/stackless-rt/out}
ZIG=${ZIG:-G:/tools/zig/zig.exe}
K=${K:-2000}

export TMP='G:\blocks\stackless-rt\tmp'
export TEMP="$TMP"; export TMPDIR="$TMP"
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\global'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\local'
mkdir -p "$OUT"

"$ZIG" cc -target x86_64-windows-gnu -O2 -g0 -I"$S" \
  -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601 -DSCR_CORO_LANE \
  "$REPO/tests/perf/corostate/corobench.c" "$S/scr_coro.c" \
  "$S/scr_number.c" "$S/scr_string.c" "$S/scr_array.c" "$S/scr_bytes.c" \
  "$S/scr_bytes_io.c" "$S/scr_map.c" "$S/scr_closure.c" "$S/scr_object.c" \
  "$S/scr_union.c" "$S/scr_exception.c" "$S/scr_error.c" "$S/scr_console.c" \
  "$S/scr_lib.c" "$S/scr_path.c" "$S/scr_json.c" "$S/scr_async.c" \
  "$S/scr_child.c" "$S/scr_cycle.c" "$S/scr_random_fill.c" \
  "$S/scr_stack_margin.c" "$S/scr_win.c" \
  -ladvapi32 -liphlpapi -lws2_32 -o "$OUT/corobench.exe"

if [ "${1:-}" = "--nopool" ]; then
  SCR_FIBER_POOL=0 "$OUT/corobench.exe" "$K"
else
  "$OUT/corobench.exe" "$K"
fi
