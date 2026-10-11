#!/bin/sh
# mb-run.sh ARM TAG  -- evidence-lane/v2-run.sh term for term. The ten knobs
# are byte-identical to it and to evidence-postfix/sb-run.sh; the only changes
# are the single arm M (the band-on-the-megabyte-pair build from mb-build.sh)
# and this block's output root. The ARM argument is kept rather than inlined so
# the recipe stays diffable against v2-run.sh.
#
# THIS FILE SOURCES ITS RIG FROM ITS OWN DIRECTORY and is executed from the
# committed tree exactly as committed. census-arms.sh:132 is a committed recipe
# that cannot run; that debt is not repeated here.
set -u
ARM=$1
TAG=$2
REPO=/g/scriptc
HERE=$(cd "$(dirname "$0")" && pwd)
case "$ARM" in
  M) OUT=/g/blocks/mb-out182-prof ;;
  *) echo "mb-run: arm must be M, got '$ARM'"; exit 2 ;;
esac
. "$HERE/mb-rig.sh"
export MEMRIG_OUT=/g/blocks/mb-run
export MEMRIG_PMON=$REPO/tests/perf/zapo-rest/harness/pmon.exe
mkdir -p "$MEMRIG_OUT" /g/blocks/mb-tmp

MAN=$MEMRIG_OUT/$TAG.manifest.txt
EXE=$OUT/zapo-rest-182.exe
[ -s "$EXE" ] || { echo "mb-run: no exe at $EXE"; exit 2; }
[ -s "$MEMRIG_PMON" ] || { echo "mb-run: no pmon at $MEMRIG_PMON"; exit 2; }

ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)

# evidence-postfix/sa.manifest.txt and sb.manifest.txt, identical; and
# evidence-variance used these same ten terms.
KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1"

{
  echo "tag          $TAG"
  echo "arm          $ARM"
  echo "lane         STACKLESS"
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

# ABSOLUTE file:// URL, not the bare specifier -- the launch dir has no tsx.
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
echo "MB-RUN-DONE tag=$TAG arm=$ARM rc=$RC"
