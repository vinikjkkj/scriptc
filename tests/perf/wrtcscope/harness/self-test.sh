#!/bin/sh
# self-test.sh — block/wrtcscope.
#
# A harness that cannot report "nothing changed" cannot be trusted when it
# does, and a harness that cannot report a DIFFERENCE cannot be trusted when
# it reports MATCH. probe-matrix.sh's verdict is a diff against the node
# oracle, so both directions are tested here on the SAME probe:
#
#   A/A   the compiled output against the real oracle output   -> must MATCH
#   A/B   the compiled output against a ONE-BYTE-perturbed     -> must be WRONG
#         copy of the same oracle output
#
# The perturbation is applied to a COPY. The recorded oracle output is never
# modified. Run probe-matrix.sh for a probe first; this reads its artifacts.
#
# Usage: . tests/perf/wrtcscope/harness/env.sh
#        sh tests/perf/wrtcscope/harness/self-test.sh [probe] [lane]

set -u
LAB="${WRTCSCOPE_LAB:-${BLOCKS_ROOT:-<blocks>}/wrtcscope/lab}"
OUT="${WRTCSCOPE_OUT:-$LAB/out}"
P="${1:-rtc-dc}"
LANE="${2:-noPkg}"

ORC="$OUT/$P.oracle.out"
RUN="$OUT/$P.$LANE/run.out"

for f in "$ORC" "$RUN"; do
  [ -s "$f" ] || { echo "SELF-TEST CANNOT RUN: $f is missing or empty"; exit 2; }
done

fails=0

# ---- A/A: must report no difference ----------------------------------------
if diff -q "$ORC" "$RUN" >/dev/null 2>&1; then
  echo "ok    A/A  $P [$LANE]  reports NO DIFFERENCE (MATCH)"
else
  echo "FAIL  A/A  $P [$LANE]  reports a difference where there is none"
  fails=$((fails + 1))
fi

# ---- A/B: must report a difference -----------------------------------------
# One character of the first line, on a copy. If the harness still says MATCH
# here then MATCH means nothing anywhere in this report.
PERT="$OUT/$P.selftest-perturbed.out"
sed '1s/./X/' "$ORC" >"$PERT"
if [ "$(cmp -s "$ORC" "$PERT" && echo same || echo differ)" != "differ" ]; then
  echo "FAIL  A/B  the perturbation did not change the file; the test is vacuous"
  fails=$((fails + 1))
elif diff -q "$PERT" "$RUN" >/dev/null 2>&1; then
  echo "FAIL  A/B  $P [$LANE]  reports MATCH against a PERTURBED oracle"
  fails=$((fails + 1))
else
  n=$(diff "$PERT" "$RUN" | grep -c '^[<>]')
  echo "ok    A/B  $P [$LANE]  reports WRONG ($n differing lines) against a perturbed oracle"
fi

# ---- the engine scan must be able to FIND something -------------------------
# A scan that reports quickjs=0 because it cannot read the binary at all is
# indistinguishable from a clean binary. The control must be non-zero.
EXE="$OUT/$P.$LANE/$P.exe"
if [ -f "$EXE" ]; then
  ctl=$(head -1 "$RUN" | cut -d= -f1)
  n=$(strings -a "$EXE" 2>/dev/null | grep -cF "$ctl")
  if [ "$n" -gt 0 ]; then
    echo "ok    scan  finds the control string '$ctl' $n time(s) in the binary"
  else
    echo "FAIL  scan  cannot find '$ctl'; every engine=0 in this report is meaningless"
    fails=$((fails + 1))
  fi
else
  echo "n/a   scan  no binary for $P [$LANE] (not 0 -- there is no artifact)"
fi

echo
[ "$fails" -eq 0 ] && { echo "SELF-TEST PASS"; exit 0; }
echo "SELF-TEST FAIL ($fails)"; exit 1
