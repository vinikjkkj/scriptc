#!/bin/bash
. /g/blocks/pkgrecheck-lab/env.sh
cd "$LAB/app" || exit 1
mkdir -p "$LAB/dynctl"
for b in "" "--backend c"; do
  tag=$([ -z "$b" ] && echo llvm || echo c)
  timeout 3600 node "$WT/packages/cli/dist/main.js" build drivers/drv-mongo.ts --dynamic $b -o "$LAB/dynctl/drv-mongo-dyn-$tag.exe" > "$LAB/dynctl/drv-mongo-dyn-$tag.log" 2>&1
  echo "drv-mongo --dynamic $tag rc=$?"
  tail -4 "$LAB/dynctl/drv-mongo-dyn-$tag.log"
  E="$LAB/dynctl/drv-mongo-dyn-$tag.exe"
  if [ -f "$E" ]; then
    echo "bytes=$(stat -c%s "$E")  quickjs=$(strings -a "$E"|grep -c quickjs) ScrDyn=$(strings -a "$E"|grep -c ScrDyn)"
    timeout 120 "$E" > "$LAB/dynctl/drv-mongo-dyn-$tag.out" 2>&1; echo "run exit=$?"; head -4 "$LAB/dynctl/drv-mongo-dyn-$tag.out"
  fi
done
echo QUEUE6_DONE
