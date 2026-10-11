#!/bin/sh
# f2b-run.sh ARM KNOBSET TAG
#   ARM      CLEAN = G:\blocks\fr1-out\S-plain\zapo-rest-182.exe   (3c462de14,
#                    32,034,304 B, stackless, knob absent -- THE SHIPPED SHAPE)
#            INSTR = G:\blocks\v3-out182-SL\zapo-rest-182.exe      (7c7897307,
#                    33,873,920 B, prof+heapcensus -- the binary q1/q4/q5 ran)
#   KNOBSET  A = exactly fr1-rig.sh's list (what fr1-run/a1..a6 ran)
#            Q = exactly f2-run.sh's list  (what f2-run/q1..q6 ran)
#   TAG      output tag under /g/blocks/f2b/run
#
# RECIPE HYGIENE. This file was written from scratch after reading
# fr1-rig.sh and f2-run.sh in full. Neither is invoked. The only paths this
# script writes are under /g/blocks/f2b. It writes NOTHING into
# fr1-out, fr1-run, v3-out182-SL, f2-out182-POS or f2-run; three committed
# slices depend on those and v3-out182-SL is read-only here by design.
set -u
ARM=${1:?arm CLEAN|INSTR}
KNOBSET=${2:?knobs A|Q}
TAG=${3:?tag}

REPO=/g/scriptc
BASE=/g/blocks/f2b
OUT=$BASE/run
mkdir -p "$OUT" "$BASE/tmp"

export TMP='G:\blocks\f2b\tmp' TEMP='G:\blocks\f2b\tmp' TMPDIR='G:\blocks\f2b\tmp'
export USERPROFILE='C:\Users\vinicius' HOMEDRIVE='C:' HOMEPATH='\Users\vinicius'
export ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"

case "$ARM" in
  CLEAN) EXE=/g/blocks/fr1-out/S-plain/zapo-rest-182.exe
         WEXE='G:\blocks\fr1-out\S-plain\zapo-rest-182.exe' ;;
  INSTR) EXE=/g/blocks/v3-out182-SL/zapo-rest-182.exe
         WEXE='G:\blocks\v3-out182-SL\zapo-rest-182.exe' ;;
  *) echo "f2b-run: arm must be CLEAN or INSTR, got '$ARM'" >&2; exit 2 ;;
esac
case "$KNOBSET" in
  A) KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60" ;;
  Q) KNOBS="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000 SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1" ;;
  *) echo "f2b-run: knobs must be A or Q, got '$KNOBSET'" >&2; exit 2 ;;
esac

[ -s "$EXE" ] || { echo "f2b-run: no exe at $EXE" >&2; exit 2; }
export MEMRIG_PMON=$REPO/tests/perf/zapo-rest/harness/pmon.exe
export MEMRIG_OUT=$OUT
[ -s "$MEMRIG_PMON" ] || { echo "f2b-run: no pmon" >&2; exit 2; }

ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)
MAN=$OUT/$TAG.manifest.txt
{
  echo "tag          $TAG"
  echo "arm          $ARM"
  echo "knobset      $KNOBSET"
  echo "exe          $EXE"
  echo "exe-bytes    $(stat -c %s "$EXE")"
  echo "exe-sha16    $(sha256sum "$EXE" | cut -c1-16)"
  echo "knobs        $KNOBS"
  echo "walker       $BASE/vmrest.exe  interval=500ms dumpEvery=10 (one full decomposition every 5 s)"
  echo "node         $(node --version) at $(command -v node)"
  echo "launch-dir   $ZAPO_ROOT"
  echo "started      $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "free-G-KB    $(df -k /g | awk 'NR==2{print $4}')"
} > "$MAN"

# The walker FIRST: attach matches by image path and waits for the image to
# appear, so it is running before memrig spawns the subject. It is a separate
# process and never touches the subject -- that is the whole point.
"$BASE/vmrest.exe" attach "$WEXE" 500 10 "$OUT/$TAG.vm.txt" > "$OUT/$TAG.vm.stdout" 2>&1 &
VMPID=$!
echo "walker-pid   $VMPID" >> "$MAN"

TSX_LOADER="file:///$(echo "$REPO/node_modules/tsx/dist/loader.mjs" | sed 's#^/\([a-z]\)/#\1:/#')"
echo "loader       $TSX_LOADER" >> "$MAN"
( cd "$ZAPO_ROOT" && node --import "$TSX_LOADER" \
    "$REPO/tests/perf/zapo-rest/harness/memrig.mts" "$EXE" "$TAG" $KNOBS ) \
  > "$OUT/$TAG.run.log" 2>&1
RC=$?
wait $VMPID
VMRC=$?
{
  echo "ended        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "rc           $RC"
  echo "walker-rc    $VMRC"
  echo "free-G-KB    $(df -k /g | awk 'NR==2{print $4}')"
} >> "$MAN"
echo "F2B-RUN-DONE tag=$TAG arm=$ARM knobs=$KNOBSET rc=$RC vmrc=$VMRC"
