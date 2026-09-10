#!/bin/sh
# Self-test for scr_map's idle table shrink. No scriptc compiler, no rig,
# no runtime link -- one zig cc of one file, then two processes.
#
# Run from anywhere:  sh tests/perf/mapshrink/run.sh [<out-dir>]
set -u

here=$(cd "$(dirname "$0")" && pwd)
src=$(cd "$here/../../../packages/runtime/src" && pwd)
out=${1:-$here/out}
mkdir -p "$out"

CC=${SCRIPTC_TEST_CC:-"zig cc"}
TARGET=${SCRIPTC_TARGET:-x86_64-windows-gnu}

echo "== build =="
# NOTE ON THE INCLUDE: selftest.c does #include "scr_map.c", and a quoted
# include searches the INCLUDER's directory before any -I. That is what
# makes the negative control below work -- dropping a modified scr_map.c
# beside a copy of selftest.c silently wins over the real one -- and it is
# also why nothing may be named scr_map.c in this directory.
$CC -O1 -target "$TARGET" -I"$src" "$here/selftest.c" -o "$out/st.exe" || exit 1

echo "== arm A: shrink enabled =="
"$out/st.exe" || { echo "SELFTEST FAILED (enabled arm)"; exit 1; }

echo "== arm B: SCR_MAP_SHRINK=0 =="
# A separate process on purpose: scr_map_shrink_on caches its answer on
# first use, so the knob cannot be flipped mid-run and an in-process
# "disabled" arm would prove nothing.
SCR_MAP_SHRINK=0 "$out/st.exe" || { echo "SELFTEST FAILED (disabled arm)"; exit 1; }

echo "== arm C: NEGATIVE CONTROL -- a broken shrink MUST fail the suite =="
# A suite that only ever prints "ok" has not been shown able to print
# FAIL. This injects a bail-out into scr_map_shrink_one and requires a
# nonzero exit; if this arm PASSES, the suite is inert and every green
# result above is worthless.
neg="$out/neg"
mkdir -p "$neg"
cp "$src/scr_map.c" "$neg/scr_map.c"
cp "$here/selftest.c" "$neg/selftest.c"
awk '{ print }
     /if \(m->nlive < m->nentries\) scr_map_compact\(m\);/ {
       print "  if (1) { scr_map_sh.skip_dense++; return false; } /* INJECTED */" }' \
    "$src/scr_map.c" > "$neg/scr_map.c"
grep -q INJECTED "$neg/scr_map.c" || { echo "control did not inject -- refusing"; exit 1; }
$CC -O1 -target "$TARGET" -I"$neg" -I"$src" "$neg/selftest.c" -o "$neg/st.exe" || exit 1
if "$neg/st.exe" > "$neg/out.txt" 2>&1; then
  echo "NEGATIVE CONTROL FAILED: the suite passed against a broken shrink"
  exit 1
fi
echo "  ok -- broken shrink produced $(grep -c FAIL "$neg/out.txt") failures"

echo
echo "ALL ARMS PASSED"
