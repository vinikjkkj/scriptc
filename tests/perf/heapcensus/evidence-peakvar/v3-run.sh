#!/bin/sh
# v3-run.sh ARM TAG  -- ARM is SL (STACKLESS, knob absent at BUILD time) or
# FB (FIBER, SCRIPTC_STACKLESS=0 at BUILD time).  evidence-lane/v2-run.sh term
# for term; the only changes are the exe selection, the arm letters and the
# output root.  The lane is a property of the BINARY, certified by its .ll.
#
# THIS FILE SOURCES ITS RIG FROM A FIXED PATH and is executed exactly as
# written.  census-arms.sh:132 is a committed recipe that cannot run; that
# debt is not repeated here.
set -u
ARM=$1
TAG=$2
REPO=/g/scriptc
ARMTAG=run
. /g/blocks/v3-rig.sh
case "$ARM" in
  SL) OUT=/g/blocks/v3-out182-SL ;;
  FB) OUT=/g/blocks/v3-out182-FB ;;
  *)  echo "v3-run: arm must be SL or FB, got '$ARM'"; exit 2 ;;
esac
export MEMRIG_OUT=/g/blocks/v3-run
export MEMRIG_PMON=$REPO/tests/perf/zapo-rest/harness/pmon.exe
mkdir -p "$MEMRIG_OUT" "/g/blocks/v3-tmp-run"

MAN=$MEMRIG_OUT/$TAG.manifest.txt
EXE=$OUT/zapo-rest-182.exe
[ -s "$EXE" ] || { echo "v3-run: no exe at $EXE"; exit 2; }
[ -s "$MEMRIG_PMON" ] || { echo "v3-run: no pmon at $MEMRIG_PMON"; exit 2; }

ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)

KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1"

{
  echo "tag          $TAG"
  echo "arm          $ARM"
  echo "lane         $([ "$ARM" = SL ] && echo STACKLESS || echo FIBER)"
  echo "exe          $EXE"
  echo "exe-bytes    $(stat -c %s "$EXE")"
  echo "ll-bytes     $(stat -c %s "$OUT"/zapo-rest.ll 2>/dev/null || echo NONE)"
  echo "knobs        $KNOBS"
  echo "peak-trigger DEFAULT (no SCR_HEAPCEN_PEAK_* set; 5 ms poll, 1024 KB step)"
  echo "node         $(node --version) at $(command -v node)"
  echo "launch-dir   $ZAPO_ROOT"
  echo "SCR_STRING_ARENA  ${SCR_STRING_ARENA:-<unset>}"
  echo "SCRIPTC_STACKLESS ${SCRIPTC_STACKLESS:-<unset>}  (run time; the lane is in the BINARY)"
  echo "started      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "free-G-GB    $(df -h /g | awk 'NR==2{print $4}')"
} > "$MAN"

TSX_LOADER="file:///$(echo "$REPO/node_modules/tsx/dist/loader.mjs" | sed 's#^/\([a-z]\)/#\1:/#')"
echo "loader       $TSX_LOADER" >> "$MAN"
( cd "$ZAPO_ROOT" && node --import "$TSX_LOADER" "$REPO/tests/perf/zapo-rest/harness/memrig.mts" \
    "$EXE" "$TAG" $KNOBS ) > "$MEMRIG_OUT/$TAG.run.log" 2>&1
RC=$?
{
  echo "ended        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "rc           $RC"
  echo "free-G-GB    $(df -h /g | awk 'NR==2{print $4}')"
} >> "$MAN"
echo "V3-RUN-DONE tag=$TAG arm=$ARM rc=$RC"
