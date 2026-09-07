#!/bin/bash
# Q1 from the coordinator: does store-mysql LINK, under either setting?
# Strict, no --best-effort, both sides, same compiler, same host.
. <blocks>/wamcoord-lab/env.sh
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QA START $(date -Is)"
  echo "### store-mysql, gate OFF, STRICT"
  ( unset SCRIPTC_PROVENANCE_AUTHORED_JS; bash "$L/build2.sh" "drivers/store-mysql.ts" "mysql-off" --provenance-sources --backend c )
  echo "### store-mysql, gate ON, STRICT"
  ( export SCRIPTC_PROVENANCE_AUTHORED_JS=1; bash "$L/build2.sh" "drivers/store-mysql.ts" "mysql-on" --provenance-sources --backend c )
  echo "=== QA DONE $(date -Is)"
} > "$L/logs/qA.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qA.log"
