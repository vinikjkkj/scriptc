#!/bin/bash
# The headline, with NO environment variable set at all: the published
# @zapo-js/wam must now reach a binary on the shipped default.
. <blocks>/wamcoord-lab/env.sh
unset SCRIPTC_PROVENANCE_AUTHORED_JS
L=<blocks>/wamcoord-lab
{
  echo "ORACLE-NODE $(node --version)"
  echo "=== QC START $(date -Is)   AUTHORED_JS=${SCRIPTC_PROVENANCE_AUTHORED_JS:-<UNSET, the shipped default>}"
  bash "$L/build2.sh" "drivers/_x-wam-plus-zapo.ts" "npmwam-default" --provenance-sources --backend c
  echo "=== QC DONE $(date -Is)"
} > "$L/logs/qC.log" 2>&1
echo "=== GATE-EXIT rc=$? ===" >> "$L/logs/qC.log"
