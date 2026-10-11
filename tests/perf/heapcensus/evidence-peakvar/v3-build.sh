#!/bin/sh
# v3-build.sh ARM   -- ARM is SL (STACKLESS, knob ABSENT) or FB (FIBER,
# SCRIPTC_STACKLESS=0).  The ONLY difference between the two invocations is
# that env var.  Same tree, same PROF_CFLAGS, same -o shape.
#
# evidence-postfix/sb-build.sh term for term, plus -DSCR_HEAPCEN_PEAK.
set -u
ARM=$1
ARMTAG=$ARM
REPO=/g/scriptc
HDR=/g/blocks/v3-wt
OUT=/g/blocks/v3-out182-$ARM
LOG=/g/blocks/v3-run/$ARM.build.log
ENVF=/g/blocks/v3-run/$ARM.build-env.txt
. /g/blocks/v3-rig.sh
case "$ARM" in
  SL) unset SCRIPTC_STACKLESS 2>/dev/null || true ;;
  FB) export SCRIPTC_STACKLESS=0 ;;
  *)  echo "v3-build: arm must be SL or FB, got '$ARM'"; exit 2 ;;
esac
mkdir -p "$OUT" /g/blocks/v3-run "/g/blocks/v3-tmp-$ARM"
rm -f "$OUT"/zapo-rest*.ll "$OUT"/zapo-rest*.c "$OUT"/zapo-rest-182.exe

PROF="-include G:/scriptc/tests/perf/prof/scr_prof.h -DSCR_PROF_ALLOC -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS -DSCR_PROF_STACK_SIZE_MIN=1296 -DSCR_PROF_STACK_SIZE_MAX=1352 -DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376 -include G:/blocks/v3-wt/tests/perf/heapcensus/scr_heap_census.h -DSCR_HEAPCEN_PEAK"

{
  echo "ARM            $ARM ($([ "$ARM" = SL ] && echo STACKLESS || echo FIBER))"
  echo "KNOB           SCRIPTC_STACKLESS=${SCRIPTC_STACKLESS:-<ABSENT>}"
  echo "head           $(git -C $REPO rev-parse HEAD)"
  echo "branch         $(git -C $REPO rev-parse --abbrev-ref HEAD)"
  echo "dirty          $(git -C $REPO status --porcelain | tr -d '\r' | sed 's/^ *//' | tr '\n' ';')"
  echo "hdr-tree       $(git -C $HDR rev-parse HEAD)"
  echo "hdr-sha        $(sha256sum $HDR/tests/perf/heapcensus/scr_heap_census.h | cut -c1-16)"
  echo "prof-sha       $(sha256sum $REPO/tests/perf/prof/scr_prof.h | cut -c1-16)"
  echo "rt-src-sha     $(git -C $REPO rev-parse HEAD:packages/runtime/src)"
  echo "cli-dist-sha   $(sha256sum $REPO/packages/cli/dist/main.js | cut -c1-16)"
  echo "zig            $(zig version) at $(command -v zig)"
  echo "node           $(node --version) at $(command -v node)"
  echo "target         $SCRIPTC_TARGET"
  echo "PROF_CFLAGS    $PROF"
  echo "SCRIPTC_NO_CACHE $SCRIPTC_NO_CACHE"
  echo "TMP            $TMP"
  echo "START          $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "free-before-GB $(df -h /g | awk 'NR==2{print $4}')"
} > "$ENVF"

cd "$REPO" || exit 1
START=$(date +%s)
SCRIPTC_PROF_CFLAGS="$PROF" \
node "$REPO/packages/cli/dist/main.js" build \
  "$REPO/tests/perf/zapo-rest/app182/zapo-rest.ts" \
  -o "$OUT/zapo-rest-182.exe" --provenance-sources --keep-c > "$LOG" 2>&1
RC=$?
END=$(date +%s)
{
  echo "END            $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "BUILD-EXIT     $RC"
  echo "elapsed-s      $((END - START))"
  echo "free-after-GB  $(df -h /g | awk 'NR==2{print $4}')"
  echo "EXE            $(stat -c %s "$OUT/zapo-rest-182.exe" 2>/dev/null || echo MISSING)"
  for f in "$OUT"/*.ll; do
    [ -e "$f" ] && echo "EMITTED-LL     $(basename "$f")=$(stat -c %s "$f")"
  done
  echo "EMITTED-LL-N   $(ls "$OUT"/*.ll 2>/dev/null | wc -l)"
  echo "EMITTED-C-N    $(ls "$OUT"/*.c 2>/dev/null | wc -l)"
  echo "EARLY-CACHE    $(grep -c 'early cache hit' "$LOG")"
  echo "head-after     $(git -C $REPO rev-parse HEAD)"
  echo "rt-src-after   $(git -C $REPO rev-parse HEAD:packages/runtime/src)"
} >> "$ENVF"
echo "V3-BUILD-DONE arm=$ARM rc=$RC"
