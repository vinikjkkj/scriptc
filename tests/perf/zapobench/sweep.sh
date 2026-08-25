#!/bin/bash
# sweep.sh <basePort> <runs> <label:mode> [<label:mode> ...]
# Runs each arm <runs> times, round-robin, one port per run, so a slow patch
# of the machine is shared by every arm instead of landing on one of them.
set -u
BASE="$1"; RUNS="$2"; shift 2
P=$BASE
for i in $(seq 1 "$RUNS"); do
  for spec in "$@"; do
    LBL="${spec%%:*}"; MODE="${spec#*:}"
    /g/blocks/zapobench/lab/run.sh "$LBL-$i" "$MODE" "$P" --disconnect 2>&1 \
      | grep -E "^(drv exit|CMP stanza\.count|MEM peakWorkingSetBytes|MEM cpuTotalMs|D> client exit)"
    P=$((P+1))
  done
done
