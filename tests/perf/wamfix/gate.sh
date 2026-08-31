#!/bin/bash
# The gate, under node v25.9.0. The FIRST line of the log is `node --version`
# and a log whose first line is not v25.9.0 is not evidence.
. /g/blocks/wamfix-lab/env.sh
export PATH="/c/Users/vinicius/AppData/Local/nvm/v25.9.0:$PATH"
cd "$WT" || exit 1
node --version
echo "SCRIPTC_TEST_WORKERS=$SCRIPTC_TEST_WORKERS SCRIPTC_CC=$SCRIPTC_CC SCRIPTC_TEST_CC=$SCRIPTC_TEST_CC"
echo "TMP=$TMP  ZIG_LOCAL_CACHE_DIR=$ZIG_LOCAL_CACHE_DIR"
echo "=== gate start $(date -u +%H:%M:%S) ==="
node node_modules/vitest/vitest.mjs run "$@" 2>&1
echo "=== gate end $(date -u +%H:%M:%S) rc=$? ==="
