#!/bin/bash
# Self-test for the sweep: a coverage log that names neither "statements
# analyzed" nor "not analyzable" is DID-NOT-REPORT, not "no diagnostics".
# Re-runs those. Prints what it found so a clean sweep can say "nothing
# changed" out loud.
. /g/blocks/mediavoip/lab/env.sh
OUT="${1:-$LAB/cov}"
cd "$LAB/app" || exit 1
bad=0
for log in "$OUT"/*.log; do
  if grep -q 'statements analyzed' "$log" || grep -q 'not analyzable' "$log"; then continue; fi
  bad=$((bad+1))
  tag=$(basename "$log" .log)
  f="pkgs/$(echo "$tag" | sed 's|__|/|g').ts"
  echo "INVALID: $tag -> re-running $f"
  timeout 600 node "$WT/packages/cli/dist/main.js" coverage "$f" $EXTRA_FLAGS > "$log" 2>&1
  echo "COVERAGE_EXIT=$?" >> "$log"
done
echo "REVALIDATE: $bad invalid log(s) found and re-run"
