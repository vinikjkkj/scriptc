#!/bin/bash
# run.sh <label> <mode> <port> [extra drv flags...]
#   mode = a path to an .exe, or "node22" / "node25"
#
# One paired run against @zapo-js/fake-server out of THE ONE app directory,
# with the client wrapped in runner.exe so BOTH lanes are measured by the same
# kernel counter (PeakWorkingSetSize) read from outside the process.
set -u
. /g/blocks/zapobench/lab/env.sh
A=/g/zapo-work/zapobench-artifacts
LAB="$1"; MODE="$2"; PORT="$3"; shift 3
mkdir -p "$A/raw"
export DV_RUNNER="$A/runner/runner.exe"
export DV_METRICS="$A/raw/$LAB.metrics.json"
rm -f "$DV_METRICS"
DRVNODE="$NODE25"
case "$MODE" in
  node22) CLIENT=node; export DV_NODE="$NODE22" ;;
  node25) CLIENT=node; export DV_NODE="$NODE25" ;;
  *)      CLIENT=exe;  export DV_EXE="$MODE" ;;
esac
if [ "$CLIENT" = node ]; then
  DV_CWD="$A/app" timeout 500 "$DRVNODE" "$A/fake/zb-drv.mjs" \
    --client node --entry ixmax3.ts --port "$PORT" --window 12000 --label "$LAB" \
    --log "$A/raw/drv-$LAB.log" "$@" \
    > "$A/raw/$LAB.console" 2>&1
else
  DV_CWD="$A/app" timeout 500 "$DRVNODE" "$A/fake/zb-drv.mjs" \
    --client exe --port "$PORT" --window 12000 --label "$LAB" \
    --log "$A/raw/drv-$LAB.log" "$@" \
    > "$A/raw/$LAB.console" 2>&1
fi
echo "drv exit=$?  label=$LAB mode=$MODE"
grep -aE "(CMP|MEM) " "$A/raw/$LAB.console" | grep -aE "stanza\.count|stanza\.tags|peer\.recv\.count|clientDump\.count|peakWorkingSetBytes|cpuTotalMs|clientWallMs" | sed "s/^\[[^]]*\] //"
grep -aE "client exit=|UNTAGGED ABORT lines|SCTRAP lines" "$A/raw/$LAB.console" | sed "s/^\[[^]]*\] //"
[ -f "$DV_METRICS" ] || echo "!! NO METRICS FILE — the memory number for $LAB DID NOT HAPPEN"
