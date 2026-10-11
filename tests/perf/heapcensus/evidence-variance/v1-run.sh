#!/bin/sh
# v1-run.sh ARM TAG   -- ARM is A (PRE, h2-out182-prof) or B (POST, sb-out182-prof).
# sb-run.sh term for term; the only changes are the exe selection, the tag and
# the output root. NOTHING IS BUILT: both exes are the ones the committed
# manifests name.
set -u
ARM=$1
TAG=$2
REPO=/g/scriptc
case "$ARM" in
  A) OUT=/g/blocks/h2-out182-prof ;;
  B) OUT=/g/blocks/sb-out182-prof ;;
  *) echo "v1-run: arm must be A or B, got '$ARM'"; exit 2 ;;
esac
. /g/blocks/v1-rig.sh
export MEMRIG_OUT=/g/blocks/v1-run
export MEMRIG_PMON=$REPO/tests/perf/zapo-rest/harness/pmon.exe
mkdir -p "$MEMRIG_OUT" /g/blocks/v1-tmp

MAN=$MEMRIG_OUT/$TAG.manifest.txt
EXE=$OUT/zapo-rest-182.exe
[ -s "$EXE" ] || { echo "v1-run: no exe at $EXE"; exit 2; }
[ -s "$MEMRIG_PMON" ] || { echo "v1-run: no pmon at $MEMRIG_PMON"; exit 2; }

ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)

# evidence-idle/on.manifest.txt and evidence-postfix/sb.manifest.txt, identical.
KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1"

{
  echo "tag          $TAG"
  echo "arm          $ARM"
  echo "exe          $EXE"
  echo "exe-bytes    $(stat -c %s "$EXE")"
  echo "ll-bytes     $(stat -c %s "$OUT"/zapo-rest.ll 2>/dev/null || echo NONE)"
  echo "knobs        $KNOBS"
  echo "node         $(node --version) at $(command -v node)"
  echo "launch-dir   $ZAPO_ROOT"
  echo "SCR_STRING_ARENA  ${SCR_STRING_ARENA:-<unset>}"
  echo "SCRIPTC_STACKLESS ${SCRIPTC_STACKLESS:-<unset>}"
  echo "started      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "free-G-GB    $(df -h /g | awk 'NR==2{print $4}')"
} > "$MAN"

# ABSOLUTE file:// URL, not the bare specifier. census-arms.sh:132 uses the
# bare one from a launch dir with no tsx and dies ERR_MODULE_NOT_FOUND.
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
echo "V1-RUN-DONE tag=$TAG arm=$ARM rc=$RC"
