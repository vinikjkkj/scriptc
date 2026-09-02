#!/bin/bash
. /g/blocks/pkgrecheck-lab/env.sh
cd "$LAB/app" || exit 1
run() { N="$1"; S="$2"; shift 2
  timeout 3600 node "$WT/packages/cli/dist/main.js" build "$S" -o "$LAB/diag/$N.exe" --no-keep-c "$@" > "$LAB/diag/$N.log" 2>&1
  rc=$?; n=$(rg -a -c ' - error SC[0-9]{4}: ' "$LAB/diag/$N.log"); n=${n:-0}
  echo "=== $N rc=$rc flags=[$*] sites=$n"
  rg -a -o ' - error SC[0-9]{4}: .*' "$LAB/diag/$N.log" | sed 's/^ - error //' | cut -c1-88 | sort | uniq -c | sort -rn | head -6
  rg -a -n 'island fallback|no source mapping|provenance:' "$LAB/diag/$N.log" | head -4
}
run media-prov     drivers/drv-media.ts   --provenance-sources
run media-prov-be  drivers/drv-media.ts   --provenance-sources --best-effort
run mongo-prov     drivers/drv-mongo.ts   --provenance-sources
run mongo-prov-be  drivers/drv-mongo.ts   --provenance-sources --best-effort
echo QUEUE9_DONE
