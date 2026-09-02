#!/bin/bash
. /g/blocks/pkgrecheck-lab/env.sh
cd "$LAB/app" || exit 1
run() {  # $1 name  $2 entry  $3.. flags
  N="$1"; S="$2"; shift 2
  timeout 3600 node "$WT/packages/cli/dist/main.js" build "$S" -o "$LAB/diag/$N.exe" --no-keep-c "$@" > "$LAB/diag/$N.log" 2>&1
  rc=$?
  n=$(rg -a -c ' - error SC[0-9]{4}: ' "$LAB/diag/$N.log"); n=${n:-0}
  echo "=== $N rc=$rc flags=[$*] sites=$n"
  rg -a -o ' - error (SC[0-9]{4}): ' -r '$1' "$LAB/diag/$N.log" | sort | uniq -c | sort -rn | tr '\n' ' '; echo
  rg -a -o ' - error SC[0-9]{4}: .*' "$LAB/diag/$N.log" | sed 's/^ - error //' | cut -c1-90 | sort | uniq -c | sort -rn | head -8
}
run voip-entry-flagless pkgs/voip/index.ts
run voip-entry-be       pkgs/voip/index.ts --best-effort
run wam-entry-flagless  pkgs/wam/index.ts
run wam-entry-be        pkgs/wam/index.ts --best-effort
run sqlite-entry-flagless pkgs/store-sqlite/index.ts
run sqlite-entry-be       pkgs/store-sqlite/index.ts --best-effort
run sqlite-names-flagless drivers/store-sqlite-names.ts
echo QUEUE5_DONE
