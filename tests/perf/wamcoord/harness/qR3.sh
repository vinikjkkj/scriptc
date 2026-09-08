#!/bin/bash
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
while ! grep -q "QR2 DONE" "$L/logs/qR2.log" 2>/dev/null; do sleep 20; done
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QR3 START $(date -Is) -- minimal reproduction ladder"
  timeout 9000 node "$L/sites.mjs" "$L/napp/redisbase.ts" "$L/sites/redisbase.json" --provenance-sources 2>&1
  echo "EXIT=$?"
  echo "=== QR3 DONE $(date -Is)"
} > "$L/logs/qR3.log" 2>&1
