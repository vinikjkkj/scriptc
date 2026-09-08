#!/bin/bash
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
L=${BLOCKS_ROOT:-<blocks>}/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QT1 START $(date -Is)"
  bash "$L/build2.sh" "twolevel.ts" "twolevel" --backend c
  echo "=== QT1 DONE $(date -Is)"
} > "$L/logs/qT1.log" 2>&1
