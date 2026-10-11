#!/bin/sh
# sb-run.sh -- run the `sb` arm: evidence-idle/on's knobs exactly, on the
# binary built by sb-build.sh, which sb-build.sh's own EMITTED line certifies
# as the STACKLESS lane. Mirrors evidence-postfix/sa.manifest.txt term for
# term; the only intended difference is the coroutine lane.
set -u
REPO=/g/scriptc
OUT=/g/blocks/sb-out182-prof
MAN=/g/blocks/sb-run/sb.manifest.txt
. /g/blocks/sb-rig.sh
export MEMRIG_OUT=/g/blocks/sb-run
export MEMRIG_PMON=$REPO/tests/perf/zapo-rest/harness/pmon.exe
mkdir -p "$MEMRIG_OUT"

EXE=$OUT/zapo-rest-182.exe
[ -s "$EXE" ] || { echo "sb-run: no exe at $EXE"; exit 2; }
[ -s "$MEMRIG_PMON" ] || { echo "sb-run: no pmon at $MEMRIG_PMON"; exit 2; }

# THE LAUNCH DIRECTORY IS PART OF THE PROTOCOL -- census-arms.sh:122-129: tsx
# reads the tsconfig of the directory the process was LAUNCHED in, at
# --import registration time, so a run from $REPO measures nothing.
ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)

KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1"

{
  echo "tag          sb"
  echo "arm          post-fix reproduction of evidence-idle/on, STACKLESS LANE"
  echo "supersedes   evidence-postfix/sa (same recipe, FIBER lane -- see LANE.txt)"
  echo "exe          $EXE"
  echo "exe-bytes    $(stat -c %s "$EXE")"
  echo "built-from   /g/scriptc @ $(git -C $REPO rev-parse HEAD)"
  echo "lane         STACKLESS, knob ABSENT; zapo-rest.ll=$(stat -c %s "$OUT"/zapo-rest.ll)"
  echo "knobs        $KNOBS"
  echo "node         $(node --version) at $(command -v node)"
  echo "pmon         $MEMRIG_PMON ($(stat -c %s "$MEMRIG_PMON") B)"
  echo "fake-server  $ZAPO_FAKE_SERVER"
  echo "launch-dir   $ZAPO_ROOT"
  echo "SCR_STRING_ARENA  ${SCR_STRING_ARENA:-<unset>}"
  echo "SCRIPTC_STACKLESS ${SCRIPTC_STACKLESS:-<unset>}"
  echo "started      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "free-G-GB    $(df -h /g | awk 'NR==2{print $4}')"
} > "$MAN"

# THE LOADER MUST BE AN ABSOLUTE file:// URL, not the bare specifier "tsx".
# /g/blocks/m3-zaposrc has its own node_modules with no tsx in it, and node
# resolves a bare specifier from the LAUNCH directory, which the protocol
# fixes at the zapo root. `--import tsx` therefore dies with
# ERR_MODULE_NOT_FOUND before a line of memrig runs -- which is how this
# script failed on its first attempt. sa2-rig.sh:39 and h2-rig.sh:31 both
# spell it absolutely; this is their spelling, against the same tsx.
TSX_LOADER="file:///$(echo "$REPO/node_modules/tsx/dist/loader.mjs" | sed 's#^/\([a-z]\)/#\1:/#')"
echo "loader       $TSX_LOADER" >> "$MAN"
( cd "$ZAPO_ROOT" && node --import "$TSX_LOADER" "$REPO/tests/perf/zapo-rest/harness/memrig.mts" \
    "$EXE" sb $KNOBS ) > /g/blocks/sb-run/sb.run.log 2>&1
RC=$?
{
  echo "ended        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "rc           $RC"
  echo "free-G-GB    $(df -h /g | awk 'NR==2{print $4}')"
} >> "$MAN"
echo "SB-RUN-DONE rc=$RC"
