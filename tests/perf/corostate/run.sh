#!/bin/sh
# Build and run the fiber-vs-stackless turn comparison. No compiler build, no
# node, no zapo: this links the REAL runtime units and drives the REAL
# scheduler, so what it measures is the shipping microtask queue.
#
#   sh tests/perf/corostate/run.sh            # the comparison, must pass
#   sh tests/perf/corostate/run.sh --poison   # the SAME test with the
#                                             # one-push invariant broken on
#                                             # purpose; must FAIL
#
# The poison arm is not decoration. A turn comparison that has never gone red
# is not evidence that it can; --poison makes scr_coro_park resume inline
# instead of enqueueing -- exactly what hanging the resume off the promise's
# `cbs` list would do -- and the run must report MISMATCHES and exit 1.
#
# Everything volatile stays OUTSIDE the worktree (zig ignores TMP and will
# otherwise write to C:), and zig 0.16.0 is pinned: the Chocolatey 0.15.2 on
# PATH builds a different size class.
set -eu

REPO=$(cd "$(dirname "$0")/../../.." && pwd)
S="$REPO/packages/runtime/src"
OUT=${COROSTATE_OUT:-G:/blocks/stackless-rt/out}
ZIG=${ZIG:-G:/tools/zig/zig.exe}

export TMP='G:\blocks\stackless-rt\tmp'
export TEMP="$TMP"
export TMPDIR="$TMP"
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\global'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\stackless-rt\zig-cache\local'
# The rig's scratch directories are EXPORTED above but were never created, so
# a host where they do not exist fails the build instead of running the check.
# They vanished for real on 2026-10-06 when the stackless-rt block was purged
# after its merge, and every corostate script broke at once. Derived from the
# same strings the exports use, so a path cannot drift between the two.
mkdir -p "$(printf '%s' "$TMP" | tr '\\' /)"          "$(printf '%s' "$ZIG_LOCAL_CACHE_DIR" | tr '\\' /)"          "$(printf '%s' "$ZIG_GLOBAL_CACHE_DIR" | tr '\\' /)"

mkdir -p "$OUT"

POISON=""
EXE="$OUT/corostate.exe"
if [ "${1:-}" = "--poison" ]; then
  POISON="-DSCR_CORO_POISON_SKIP_HOP"
  EXE="$OUT/corostate-poison.exe"
fi

# The always-linked runtime set (cc.ts RUNTIME_SOURCES) plus scr_coro.c, plus
# the win32 trio cc.ts links unconditionally on this target.
"$ZIG" cc -target x86_64-windows-gnu -O1 -g0 -I"$S" \
  -DWIN32_LEAN_AND_MEAN -D_WIN32_WINNT=0x0601 -DSCR_CORO_LANE $POISON \
  "$REPO/tests/perf/corostate/corostate.c" \
  "$S/scr_coro.c" \
  "$S/scr_number.c" "$S/scr_string.c" "$S/scr_array.c" "$S/scr_bytes.c" \
  "$S/scr_bytes_io.c" "$S/scr_map.c" "$S/scr_closure.c" "$S/scr_object.c" \
  "$S/scr_union.c" "$S/scr_exception.c" "$S/scr_error.c" "$S/scr_console.c" \
  "$S/scr_lib.c" "$S/scr_path.c" "$S/scr_json.c" "$S/scr_async.c" \
  "$S/scr_child.c" "$S/scr_cycle.c" "$S/scr_random_fill.c" \
  "$S/scr_stack_margin.c" "$S/scr_win.c" \
  -ladvapi32 -liphlpapi -lws2_32 \
  -o "$EXE"

set +e
"$EXE"
rc=$?
set -e
if [ -n "$POISON" ]; then
  if [ $rc -eq 0 ]; then
    echo "run.sh: POISON ARM PASSED -- the comparison is NOT calibrated" >&2
    exit 1
  fi
  echo "run.sh: poison arm failed as required (exit $rc)"
  exit 0
fi
exit $rc
