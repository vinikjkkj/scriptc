#!/bin/bash
. /g/blocks/pkgstatus-lab/env.sh
export SCRIPTC_TEST_WORKERS=2
export PATH="$NODE25:$PATH"
cd "$WT" || exit 1
node -v
"$NODE25/node.exe" ./node_modules/vitest/vitest.mjs run > "$LAB/gate-full.log" 2>&1
VITEST_EXIT=$?
echo "VITEST_EXIT=$VITEST_EXIT" | tee -a "$LAB/gate-full.log"
