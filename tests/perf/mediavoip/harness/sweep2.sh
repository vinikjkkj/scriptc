#!/bin/bash
# Per-module site dump. $1 = output dir, $2.. = extra compiler flags.
. /g/blocks/mediavoip/lab/env.sh
OUT="$1"; shift
mkdir -p "$OUT"
LOCK="$OUT/.lock"
if [ -e "$LOCK" ]; then echo "LOCKED: another sweep owns $OUT"; exit 2; fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
cd "$LAB/app" || exit 1
for f in $(find pkgs -name '*.ts' -not -path '*__tests__*' | sort); do
  tag=$(echo "$f" | sed 's|pkgs/||; s|/|__|g; s|\.ts$||')
  timeout 900 node "$LAB/sites.mjs" "$PWD/$f" "$OUT/$tag.json" "$@" > "$OUT/$tag.txt" 2>&1
  rc=$?
  echo "EXIT=$rc" >> "$OUT/$tag.txt"
  echo "$tag rc=$rc"
done
echo "SWEEP_DONE"
