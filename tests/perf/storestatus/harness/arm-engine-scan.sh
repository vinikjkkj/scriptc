#!/bin/bash
# arm-engine-scan.sh -- the positive control for engine-scan.sh, on THIS compiler.
#
# A scan that can only say "clean" is worthless. This builds hello.ts twice --
# once static, once --dynamic (which certainly embeds the engine) -- and prints
# both scans side by side. A marker that reads the same in both DOES NOT
# DISCRIMINATE and may not be quoted as evidence of an engine-free binary.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh" || exit 1
cd "$LAB/napp" || exit 1
mkdir -p "$OUT"
echo "### arming the engine scan on head=$(git -C "$WT" rev-parse --short HEAD)"
node "$WT/packages/cli/dist/main.js" build hello.ts --backend c -o "$OUT/ctl-hello-static.exe" > "$OUT/ctl-hello-static.log" 2>&1
echo "static rc=$?"
node "$WT/packages/cli/dist/main.js" build hello.ts --dynamic -o "$OUT/ctl-hello-dynamic.exe" > "$OUT/ctl-hello-dynamic.log" 2>&1
echo "dynamic rc=$?"
bash "$HERE/engine-scan.sh" "$OUT/ctl-hello-static.exe" "$OUT/ctl-hello-dynamic.exe"
echo "### a marker is USABLE only where the two rows differ."
