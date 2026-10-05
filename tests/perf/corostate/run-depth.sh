#!/bin/sh
# LEAK-4: what the stackless port does to stack-overflow behaviour.
#
#   sh tests/perf/corostate/run-depth.sh          # all three arms, in order
#
# Each arm runs as its OWN PROCESS on purpose: the fiber async-recursion arm
# can take the process down, and a crash in one arm would otherwise carry off
# a block-buffered stdout and make every earlier arm look like it printed
# nothing. (That is not hypothetical -- it is how the first version of this
# reported an empty run.) stdout is unbuffered inside the program for the
# same reason.
set -eu
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
S="$REPO/packages/runtime/src"
OUT=${COROSTATE_OUT:-G:/blocks/stackless-rt/out}
ZIG=${ZIG:-G:/tools/zig/zig.exe}
export TMP='G:\blocks\stackless-rt\tmp'; export TEMP="$TMP"; export TMPDIR="$TMP"
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\global'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\local'
mkdir -p "$OUT"

"$ZIG" cc -target x86_64-windows-gnu -O2 -g0 -I"$S" \
  -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601 \
  "$REPO/tests/perf/corostate/corodepth.c" "$S/scr_coro.c" \
  "$S/scr_number.c" "$S/scr_string.c" "$S/scr_array.c" "$S/scr_bytes.c" \
  "$S/scr_bytes_io.c" "$S/scr_map.c" "$S/scr_closure.c" "$S/scr_object.c" \
  "$S/scr_union.c" "$S/scr_exception.c" "$S/scr_error.c" "$S/scr_console.c" \
  "$S/scr_lib.c" "$S/scr_path.c" "$S/scr_json.c" "$S/scr_async.c" \
  "$S/scr_child.c" "$S/scr_cycle.c" "$S/scr_random_fill.c" \
  "$S/scr_stack_margin.c" "$S/scr_win.c" \
  -ladvapi32 -liphlpapi -lws2_32 -o "$OUT/corodepth.exe" 2>/dev/null

set +e
"$OUT/corodepth.exe" sync;     echo "  [sync arm exit $?]"
"$OUT/corodepth.exe" cororec;  echo "  [stackless recursion arm exit $?]"
"$OUT/corodepth.exe" fiberrec; echo "  [fiber recursion arm exit $?]"
exit 0
