#!/bin/bash
# Record the new fixture in the ts7 order-parity baseline. ADDITIVE by
# construction: SCRIPTC_UPDATE_BASELINES=1 cannot overwrite a live divergence,
# so the only legitimate outcome is entries ADDED and 0 CHANGED.
. ${BLOCKS_ROOT:-<blocks>}/mediautils-work/env.sh
cd ${BLOCKS_ROOT:-<blocks>}/mediautils || exit 1
{
  echo "ORACLE-NODE $(node --version)"
  echo "baseline bytes BEFORE=$(stat -c%s packages/compiler/test/ts7/baselines/order-parity.json)"
  echo "=== UPDATE $(date -Is)"
  SCRIPTC_UPDATE_BASELINES=1 timeout 3000 node node_modules/vitest/vitest.mjs run \
    packages/compiler/test/ts7/order-parity.test.ts 2>&1
  echo "UPDATE-EXIT=$?"
  echo "baseline bytes AFTER=$(stat -c%s packages/compiler/test/ts7/baselines/order-parity.json)"
  echo "=== VERIFY (no update flag) $(date -Is)"
  timeout 3000 node node_modules/vitest/vitest.mjs run \
    packages/compiler/test/ts7/order-parity.test.ts 2>&1
  echo "VERIFY-EXIT=$?"
  echo "=== DONE $(date -Is)"
} > "${BLOCKS_ROOT:-<blocks>}/mediautils-work/logs/gate-ts7-update.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "${BLOCKS_ROOT:-<blocks>}/mediautils-work/logs/gate-ts7-update.log"
