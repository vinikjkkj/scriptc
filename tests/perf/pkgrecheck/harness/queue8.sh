#!/bin/bash
. /g/blocks/pkgrecheck-lab/env.sh
cd "$LAB/app" || exit 1
for d in drv-media drv-redis drv-postgres hello store-sqlite-names; do
  timeout 1800 node "$WT/packages/cli/dist/main.js" build "drivers/$d.ts" --dynamic -o "$LAB/dynctl/$d-dyn.exe" > "$LAB/dynctl/$d-dyn.log" 2>&1
  rc=$?
  msg=$(rg -a -o 'lowerer bug: [^"]*' "$LAB/dynctl/$d-dyn.log" | head -1)
  enoent=$(rg -a -c 'libqjs' "$LAB/dynctl/$d-dyn.log"); enoent=${enoent:-0}
  echo "$d --dynamic rc=$rc libqjs-hits=$enoent  ${msg:-(no lowerer bug)}"
done
echo QUEUE8_DONE
