#!/bin/sh
# f2-run.sh ARM TAG  -- ARM is PRE (7c7897307 runtime, the copy) or POS
# (16d91996f runtime, the share).  v3-run.sh term for term; only the exe
# selection, the arm letters and the output root differ.
#
# PRE reuses /g/blocks/v3-out182-SL/zapo-rest-182.exe READ-ONLY.  Its
# recorded rt-src-sha is 6a19e80ea8f4558d720b78ddb3faf4c9cb3ce78a, which is
# byte-identical to 7c7897307:packages/runtime/src.  NOTHING here writes
# into that directory; two committed slices depend on it.
set -u
ARM=$1
TAG=$2
REPO=/g/scriptc
ARMTAG=run
. /g/blocks/f2-rig.sh
case "$ARM" in
  PRE) OUT=/g/blocks/v3-out182-SL ;;
  POS) OUT=/g/blocks/f2-out182-POS ;;
  *)   echo "f2-run: arm must be PRE or POS, got '$ARM'"; exit 2 ;;
esac
export MEMRIG_OUT=/g/blocks/f2-run
export MEMRIG_PMON=$REPO/tests/perf/zapo-rest/harness/pmon.exe
mkdir -p "$MEMRIG_OUT" "/g/blocks/f2-tmp-run"

MAN=$MEMRIG_OUT/$TAG.manifest.txt
EXE=$OUT/zapo-rest-182.exe
[ -s "$EXE" ] || { echo "f2-run: no exe at $EXE"; exit 2; }
[ -s "$MEMRIG_PMON" ] || { echo "f2-run: no pmon at $MEMRIG_PMON"; exit 2; }

ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)

KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1"

{
  echo "tag          $TAG"
  echo "arm          $ARM"
  echo "runtime      $([ "$ARM" = PRE ] && echo '7c7897307 (copy)' || echo '16d91996f (share)')"
  echo "exe          $EXE"
  echo "exe-bytes    $(stat -c %s "$EXE")"
  echo "exe-sha      $(sha256sum "$EXE" | cut -c1-16)"
  echo "ll-bytes     $(stat -c %s "$OUT"/zapo-rest.ll 2>/dev/null || echo NONE)"
  echo "knobs        $KNOBS"
  echo "peak-trigger DEFAULT (no SCR_HEAPCEN_PEAK_* set; 5 ms poll, 1024 KB step)"
  echo "node         $(node --version) at $(command -v node)"
  echo "launch-dir   $ZAPO_ROOT"
  echo "SCR_STRING_ARENA  ${SCR_STRING_ARENA:-<unset>}"
  echo "SCRIPTC_STACKLESS ${SCRIPTC_STACKLESS:-<unset>}  (run time; the lane is in the BINARY)"
  echo "started      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "free-G-KB    $(df -k /g | awk 'NR==2{print $4}')"
} > "$MAN"

TSX_LOADER="file:///$(echo "$REPO/node_modules/tsx/dist/loader.mjs" | sed 's#^/\([a-z]\)/#\1:/#')"
echo "loader       $TSX_LOADER" >> "$MAN"
( cd "$ZAPO_ROOT" && node --import "$TSX_LOADER" "$REPO/tests/perf/zapo-rest/harness/memrig.mts" \
    "$EXE" "$TAG" $KNOBS ) > "$MEMRIG_OUT/$TAG.run.log" 2>&1
RC=$?
{
  echo "ended        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "rc           $RC"
  echo "free-G-KB    $(df -k /g | awk 'NR==2{print $4}')"
} >> "$MAN"
echo "F2-RUN-DONE tag=$TAG arm=$ARM rc=$RC"
