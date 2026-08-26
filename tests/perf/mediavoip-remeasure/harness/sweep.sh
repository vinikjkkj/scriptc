#!/bin/bash
# Per-module site dump for the remeasure re-run.
#   $1 = output dir, $2.. = extra compiler flags.
# Every run carries its own two control rows, so a sweep that reports "nothing"
# can be told apart from a sweep whose query is broken.
. /g/blocks/remeasure/lab/env.sh
OUT="$1"; shift
mkdir -p "$OUT"
LOCK="$OUT/.lock"
if [ -e "$LOCK" ]; then echo "LOCKED: another sweep owns $OUT"; exit 2; fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
cd "$LAB/app" || exit 1

# --- controls first: they must run in the SAME lane as the corpus ---
for c in typesprobe typesprobe-neg; do
  timeout 900 node "$LAB/sites.mjs" "$PWD/$c.ts" "$OUT/_ctl_$c.json" "$@" > "$OUT/_ctl_$c.txt" 2>&1
  echo "EXIT=$?" >> "$OUT/_ctl_$c.txt"
  echo "control $c done"
done

for f in $(find pkgs -name '*.ts' -not -path '*__tests__*' | sort); do
  tag=$(echo "$f" | sed 's|pkgs/||; s|/|__|g; s|\.ts$||')
  timeout 1800 node "$LAB/sites.mjs" "$PWD/$f" "$OUT/$tag.json" "$@" > "$OUT/$tag.txt" 2>&1
  rc=$?
  echo "EXIT=$rc" >> "$OUT/$tag.txt"
  echo "$tag rc=$rc"
done
echo "SWEEP_DONE"
