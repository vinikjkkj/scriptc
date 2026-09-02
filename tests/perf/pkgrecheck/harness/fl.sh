#!/bin/bash
# flagless (or arbitrary-flag) diagnostic count, default backend, no cc if it fails
. /g/blocks/pkgrecheck-lab/env.sh
cd "$LAB/app" || exit 1
SRC="$1"; NAME="$2"; shift 2
mkdir -p "$LAB/diag"
timeout 2400 node "$WT/packages/cli/dist/main.js" build "$SRC" -o "$LAB/diag/$NAME.exe" --no-keep-c "$@" > "$LAB/diag/$NAME.log" 2>&1
rc=$?
n=$(rg -a -o '\[SC[0-9]{4}[^]]*\]' "$LAB/diag/$NAME.log" | wc -l)
u=$(rg -a -o '\[SC[0-9]{4}[^]]*\]' "$LAB/diag/$NAME.log" | sort -u | wc -l)
echo "=== $NAME rc=$rc  flags:[$*]  SC-sites=$n distinct=$u"
rg -a -o '\[SC[0-9]{4}[^]]*\]' "$LAB/diag/$NAME.log" | sort | uniq -c | sort -rn | head -12
rg -a -n 'fetch failed|error:|Error:' "$LAB/diag/$NAME.log" | head -6
