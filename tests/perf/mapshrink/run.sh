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

echo "== arm D: scr_cycle.c must NOT depend on scr_map.c =="
# THE REGRESSION THIS ARM EXISTS FOR. A direct call from the collector to
# scr_map_idle_shrink is an undefined symbol in every TU that links
# scr_cycle.c WITHOUT scr_map.c -- which is three of the runtime's own unit
# tests (intern, number, tonumber), five builds, all "Command failed: zig cc"
# rather than any assertion. Arms A-C build ONE file and cannot see a link
# line at all, which is exactly why they stayed green while the gate went
# red. This arm reads the linker's own answer instead.
dep="$out/dep"
mkdir -p "$dep"
$CC -c -O1 -target "$TARGET" -I"$src" "$src/scr_cycle.c" -o "$dep/cyc.o" || exit 1
$CC -target "$TARGET" "$dep/cyc.o" -o "$dep/cyc.exe" > "$dep/link.log" 2>&1
if grep -q "undefined symbol: scr_map" "$dep/link.log"; then
  echo "FAILED: scr_cycle.c has a hard edge to scr_map.c"
  grep "undefined symbol: scr_map" "$dep/link.log"
  exit 1
fi
echo "  ok -- no scr_map symbol is undefined from scr_cycle.c alone"

# The detector must be shown able to SAY so, or a green arm D means nothing.
cat > "$dep/ctl.c" <<CTLEOF
void scr_map_idle_shrink(void);
void probe(void) { scr_map_idle_shrink(); }
CTLEOF
$CC -c -O1 -target "$TARGET" "$dep/ctl.c" -o "$dep/ctl.o" || exit 1
$CC -target "$TARGET" "$dep/ctl.o" -o "$dep/ctl.exe" > "$dep/ctl.log" 2>&1
if ! grep -q "undefined symbol: scr_map" "$dep/ctl.log"; then
  echo "arm D detector is inert -- it cannot see a hard edge; refusing"
  exit 1
fi
echo "  ok -- detector proven: it flags a deliberate hard edge"

echo "== arm E: the instrument must be able to report its own SILENCE =="
# The failure this arm exists for: the first zapo run produced NO FILE AT
# ALL, because the periodic reporter sat BELOW scr_map_idle_shrink early
# returns and could therefore only speak on a turn that already did work.
# "No map went sparse" and "the instrument is broken" were then the same
# observation. A reporter downstream of the condition it reports on is not
# an instrument.
nr="$out/never"
mkdir -p "$nr"
rm -f "$nr/report.txt"
env SCR_MAP_SELFTEST_NEVERRAN=1 SCR_MAP_SHRINK_EVERY=1 SCR_MAP_SHRINK_OUT="$nr/report.txt" "$out/st.exe" > "$nr/out.txt" 2>&1 || { echo "arm E: selftest failed"; cat "$nr/out.txt"; exit 1; }
test -f "$nr/report.txt" || { echo "FAILED: no report written on a silent run"; exit 1; }
grep -q "NEVER RAN" "$nr/report.txt" || { echo "FAILED: report exists but does not carry NEVER RAN"; cat "$nr/report.txt"; exit 1; }
if grep -q "SHRANK" "$nr/report.txt"; then echo "FAILED: a silent run claimed SHRANK"; exit 1; fi
echo "  ok -- silence is reported: $(grep -c "NEVER RAN" "$nr/report.txt") line(s)"

echo
echo "ALL ARMS PASSED"
