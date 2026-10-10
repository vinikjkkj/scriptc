#!/bin/bash
# Self-test for the sweep: a coverage log that names neither "statements
# analyzed" nor "not analyzable" is DID-NOT-REPORT, not "no diagnostics".
# Re-runs those. Prints what it found so a clean sweep can say "nothing
# changed" out loud.
#
# WHICH SWEEP THIS PAIRS WITH, because it was documented against the wrong
# one. The *.log family written by a `scriptc coverage` sweep: the two
# strings above are emitted by the coverage reporter
# (packages/compiler/src/coverage/report.ts:146,152,197) and `harness/
# table.py` parses that same family. It does NOT pair with
# `harness/sweep2.sh`, which runs sites.mjs and writes "$OUT/$tag.txt" --
# those logs carry a `sites=` line and never either string, so every one of
# them would be called invalid and then re-run with a different tool. The
# self-test for a sweep2 output directory is
# ../../mediavoip-remeasure/harness/selftest.py.
#
# THE EMPTY DIRECTORY IS THE TRAP, and it is why this script now prints its
# denominator. Unguarded, `for log in "$OUT"/*.log` leaves the pattern
# literal when nothing matches, the body runs once on a path that does not
# exist, both greps fail, and the script reports "1 invalid log(s)" forever
# -- a check built to catch a false clean that could not itself report
# clean. But merely guarding the glob turns that into "0 invalid" forever,
# which is the worse failure: clean by construction. So zero logs examined
# is a REFUSAL here, not a pass, and every count is reported over the
# number of logs it was taken from.
#
# Exit: 0 clean, 1 invalid logs found and re-run, 2 nothing examined.
. ${BLOCKS_ROOT:-<blocks>}/mediavoip/lab/env.sh
OUT="${1:-$LAB/cov}"
cd "$LAB/app" || exit 1
shopt -s nullglob
logs=("$OUT"/*.log)
if [ ${#logs[@]} -eq 0 ]; then
  echo "REVALIDATE: REFUSING -- no *.log in $OUT, so nothing was examined."
  echo "  '0 invalid' over 0 logs is not a clean sweep. A sweep2.sh output"
  echo "  directory holds *.txt, not *.log; its self-test is"
  echo "  mediavoip-remeasure/harness/selftest.py."
  exit 2
fi
bad=0
for log in "${logs[@]}"; do
  if grep -q 'statements analyzed' "$log" || grep -q 'not analyzable' "$log"; then continue; fi
  bad=$((bad+1))
  tag=$(basename "$log" .log)
  f="pkgs/$(echo "$tag" | sed 's|__|/|g').ts"
  echo "INVALID: $tag -> re-running $f"
  timeout 600 node "$WT/packages/cli/dist/main.js" coverage "$f" $EXTRA_FLAGS > "$log" 2>&1
  echo "COVERAGE_EXIT=$?" >> "$log"
done
echo "REVALIDATE: $bad invalid log(s) found and re-run, of ${#logs[@]} examined"
[ "$bad" -eq 0 ] || exit 1
