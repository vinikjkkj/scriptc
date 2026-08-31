#!/usr/bin/env bash
# Weigh the two size classes with the CLI, which size-class.ts records as
# agreeing with the harness to the byte. $1 is a label for the output.
set -u
. /g/blocks/twobyte/lab/env.sh
cd /g/blocks/twobyte || exit 1
. lab/size/progs.sh
lab=$1
out=/g/blocks/twobyte-tmp/size
for p in static regex; do
  rm -f "$out/$lab-$p.exe"
  node packages/cli/dist/main.js build "$out/$p.ts" --keep-c -o "$out/$lab-$p.exe" >/dev/null 2>&1
  if [ -f "$out/$lab-$p.exe" ]; then
    printf '%-10s %-7s %s\n' "$lab" "$p" "$(stat -c %s "$out/$lab-$p.exe")"
  else
    printf '%-10s %-7s BUILD-FAILED\n' "$lab" "$p"
  fi
done
