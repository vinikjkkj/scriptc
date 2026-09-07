#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QT2 START $(date -Is)"
  for be in c llvm; do
    echo "##### backend $be"
    bash "$L/build2.sh" "cmpound.ts" "cmpound-$be" --backend $be
  done
  echo "=== QT2 DONE $(date -Is)"
} > "$L/logs/qT2.log" 2>&1
