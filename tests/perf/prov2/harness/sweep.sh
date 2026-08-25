#!/bin/bash
# Per-module site dump for one compiler tree.
#   $1 = compiler tree (WT or BASE)   $2 = output dir   $3.. = extra flags
. /g/blocks/prov2/lab/env.sh
export WT="$1"; shift
OUT="$1"; shift
TIMEOUT="${SWEEP_TIMEOUT:-900}"
mkdir -p "$OUT"
LOCK="$OUT/.lock"
if [ -e "$LOCK" ]; then echo "LOCKED: another sweep owns $OUT"; exit 2; fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT
cd /g/blocks/prov2/lab/app || exit 1
for f in $(find pkgs -name '*.ts' -not -path '*__tests__*' | sort); do
  tag=$(echo "$f" | sed 's|pkgs/||; s|/|__|g; s|\.ts$||')
  rm -f "$OUT/$tag.json"
  timeout "$TIMEOUT" node "/g/blocks/prov2/lab/sites.mjs" "$PWD/$f" "$OUT/$tag.json" "$@" > "$OUT/$tag.txt" 2>&1
  rc=$?
  echo "EXIT=$rc" >> "$OUT/$tag.txt"
  echo "$tag rc=$rc"
done
echo "SWEEP_DONE compiler=$WT out=$OUT flags=$*"
