#!/bin/bash
# Per-module site dump. $1 = output dir, $2.. = extra compiler flags.
# Controls run FIRST, in the same lane as the corpus, so a sweep that reports
# "nothing" can be told apart from a sweep whose query is broken.
. /g/blocks/pkgrecheck-lab/env.sh
OUT="$1"; shift
mkdir -p "$OUT"
LOCK="$OUT/.lock"
if [ -e "$LOCK" ]; then echo "LOCKED: another sweep owns $OUT"; exit 2; fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
cd "$LAB/app" || exit 1

for c in typesprobe typesprobe-neg; do
  timeout 900 node "$LAB/sites.mjs" "$PWD/$c.ts" "$OUT/_ctl_$c.json" "$@" > "$OUT/_ctl_$c.txt" 2>&1
  echo "EXIT=$?" >> "$OUT/_ctl_$c.txt"
  echo "control $c done"
done

LIST="${SWEEP_LIST:-}"
if [ -z "$LIST" ]; then
  LIST=$(find pkgs -name '*.ts' -not -path '*__tests__*' | sort)
fi
for f in $LIST; do
  tag=$(echo "$f" | sed 's|pkgs/||; s|/|__|g; s|\.ts$||')
  if [ -s "$OUT/$tag.json" ] && [ "${SWEEP_RESUME:-0}" = "1" ]; then echo "$tag skip"; continue; fi
  timeout "${SWEEP_TIMEOUT:-1800}" node "$LAB/sites.mjs" "$PWD/$f" "$OUT/$tag.json" "$@" > "$OUT/$tag.txt" 2>&1
  rc=$?
  echo "EXIT=$rc" >> "$OUT/$tag.txt"
  echo "$tag rc=$rc $(head -1 "$OUT/$tag.txt")"
done
echo "SWEEP_DONE"
