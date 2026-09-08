#!/bin/sh
# run.sh <lane> <tag> [bench-dir]
#   lane = exe   -> run the COMPILED client from out/<tag>/messaging.bench.exe
#          node  -> run the SAME source under node --import tsx (the oracle)
#
# Both lanes drive the SAME fake server: server-process.ts, forked as a
# separate Node process by the client's own ServerRpc. Nothing about the
# server is compiled; it is Node either way, which is the whole point.
#
# Workload knobs default to a small smoke so a first run finishes; pass
# CB_FULL=1 for the shipped default (1000 contacts x 2 devices, 4 groups x
# 500 members, 1000 messages/scenario).
set -u
. ${BLOCKS_ROOT:-<blocks>}/clientbench/lab/env.sh || exit 1
LANE=$1; TAG=$2; DIR=${3:-bench-clientonly-unmasked}
BENCH="$APP/tree/packages/fake-server/$DIR"

if [ "${CB_FULL:-0}" != "1" ]; then
  export ZAPO_BENCH_CONTACTS=${ZAPO_BENCH_CONTACTS:-20}
  export ZAPO_BENCH_CONTACT_DEVICES=${ZAPO_BENCH_CONTACT_DEVICES:-2}
  export ZAPO_BENCH_GROUPS=${ZAPO_BENCH_GROUPS:-1}
  export ZAPO_BENCH_GROUP_MEMBERS=${ZAPO_BENCH_GROUP_MEMBERS:-10}
  export ZAPO_BENCH_MESSAGES=${ZAPO_BENCH_MESSAGES:-20}
fi
export ZAPO_BENCH_JSON=1

cd "$BENCH" || exit 1
OUT="$LAB/out/run-$TAG.log"
{
  echo "### lane   : $LANE"
  echo "### dir    : $BENCH"
  echo "### date   : $(date)"
  echo "### node   : $(node --version)"
  echo "### config : contacts=${ZAPO_BENCH_CONTACTS:-default} groups=${ZAPO_BENCH_GROUPS:-default} members=${ZAPO_BENCH_GROUP_MEMBERS:-default} messages=${ZAPO_BENCH_MESSAGES:-default}"
} > "$OUT"

START=$(date +%s)
case "$LANE" in
  exe)
    # CB_EXE_TAG lets one binary be run under several run tags (smoke, full,
    # a repeat) without the log of one overwriting another.
    ETAG=${CB_EXE_TAG:-$TAG}
    EXE="$LAB/out/$ETAG/messaging.bench.exe"
    [ -f "$EXE" ] || EXE=$(ls "$LAB/out/$ETAG"/*.exe 2>/dev/null | head -1)
    [ -f "$EXE" ] || { echo "no exe under $LAB/out/$ETAG" >> "$OUT"; exit 2; }
    echo "### exe    : $EXE ($(stat -c %s "$EXE") bytes, md5 $(md5sum "$EXE" | cut -d' ' -f1))" >> "$OUT"
    cp "$EXE" "$BENCH/_cb-client.exe"
    "$BENCH/_cb-client.exe" >> "$OUT" 2>&1
    RC=$?
    ;;
  node)
    node --import tsx "$BENCH/messaging.bench.ts" >> "$OUT" 2>&1
    RC=$?
    ;;
  *) echo "unknown lane $LANE"; exit 2 ;;
esac
END=$(date +%s)
echo "RUN_EXIT=$RC" >> "$OUT"
echo "RUN_SECONDS=$((END - START))" >> "$OUT"
printf '%s\n' "$RC" > "$LAB/out/run-$TAG.exit"
