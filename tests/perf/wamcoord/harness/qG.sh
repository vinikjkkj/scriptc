#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
while ! grep -q "QC DONE" "$L/logs/qC.log" 2>/dev/null; do sleep 30; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QG START $(date -Is) -- option-2 table, pass 1: can each of the 33 move at all?"
  timeout 9000 node "$L/candidates.mjs" 2>&1
  echo "=== QG DONE $(date -Is)"
} > "$L/logs/qG.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qG.log"
