#!/bin/sh
# sb-build.sh -- rebuild the `sa` arm of the post-fix census on the STACKLESS
# lane. Same manifest as evidence-postfix/sa.build-env.txt in every term
# EXCEPT the compiler dist, which here can read SCRIPTC_STACKLESS (certified
# by tests/perf/stackless-knob-guard.mjs) and therefore honours the shipping
# default. The knob is DELIBERATELY ABSENT.
set -u
REPO=/g/scriptc
OUT=/g/blocks/sb-out182-prof
LOG=/g/blocks/sb-run/sb.build.log
ENVF=/g/blocks/sb-run/sb.build-env.txt
. /g/blocks/sb-rig.sh
mkdir -p "$OUT"
rm -f "$OUT"/zapo-rest*.ll "$OUT"/zapo-rest*.c "$OUT"/zapo-rest-182.exe

PROF="-include G:/scriptc/tests/perf/prof/scr_prof.h -DSCR_PROF_ALLOC -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS -DSCR_PROF_STACK_SIZE_MIN=1296 -DSCR_PROF_STACK_SIZE_MAX=1352 -DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376 -include G:/scriptc/tests/perf/heapcensus/scr_heap_census.h"

{
  echo "ARM            prof+heapcensus (post-fix, arm sb -- STACKLESS LANE re-run of sa)"
  echo "head           $(git -C $REPO rev-parse HEAD)"
  echo "branch         $(git -C $REPO rev-parse --abbrev-ref HEAD)"
  echo "dirty          $(git -C $REPO status --porcelain | wc -l)"
  echo "worktree       /g/scriptc   (node_modules is a REAL directory, not a symlink)"
  echo "zig            $(zig version) at $(command -v zig)"
  echo "tar            $(command -v tar)"
  echo "node           $(node --version) at $(command -v node)"
  echo "target         $SCRIPTC_TARGET"
  echo "KNOB           SCRIPTC_STACKLESS=${SCRIPTC_STACKLESS:-<ABSENT -- the point of this arm>}"
  echo "guard          tests/perf/stackless-knob-guard.mjs 6/6 PASS, see sb-run/guard.txt"
  echo "cli-dist-sha   $(sha256sum $REPO/packages/cli/dist/main.js | cut -c1-16)"
  echo "PROF_CFLAGS    $PROF"
  echo "SCRIPTC_NO_CACHE $SCRIPTC_NO_CACHE"
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
    [ -e "$f" ] && echo "EMITTED        $(basename "$f")=$(stat -c %s "$f")"
  done
  echo "EMITTED-LL-N   $(ls "$OUT"/*.ll 2>/dev/null | wc -l)"
  echo "EMITTED-C-N    $(ls "$OUT"/*.c 2>/dev/null | wc -l)"
  echo "EARLY-CACHE    $(grep -c 'early cache hit' "$LOG")"
} >> "$ENVF"
echo "SB-BUILD-DONE rc=$RC"
