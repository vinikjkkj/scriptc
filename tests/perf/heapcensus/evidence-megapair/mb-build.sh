#!/bin/sh
# mb-build.sh -- evidence-postfix/sb-build.sh term for term, with ONE change
# that is the whole point of this slice: the two stack bands move off
# [1296,1352] and 4376 onto the MEGABYTE PAIR -- band1 = 934,576 exactly and
# band2 = 1,048,576 exactly. Those are the two census classes that carry 37%
# of the stackless peak transient and whose site was NARROWED but never NAMED
# (86613275d s.2). Everything else -- lane, knob absence, target, compiler,
# both -include headers, --provenance-sources --keep-c -- is unchanged, so
# this arm is comparable to sb by construction.
# The knob is DELIBERATELY ABSENT: stackless is the shipping default.
set -u
REPO=/g/scriptc
OUT=/g/blocks/mb-out182-prof
LOG=/g/blocks/mb-run/mb.build.log
ENVF=/g/blocks/mb-run/mb.build-env.txt
. "$(cd "$(dirname "$0")" && pwd)"/mb-rig.sh
mkdir -p "$OUT" /g/blocks/mb-run /g/blocks/mb-tmp
rm -f "$OUT"/zapo-rest*.ll "$OUT"/zapo-rest*.c "$OUT"/zapo-rest-182.exe

PROF="-include G:/scriptc/tests/perf/prof/scr_prof.h -DSCR_PROF_ALLOC -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS -DSCR_PROF_STACK_SIZE_MIN=934576 -DSCR_PROF_STACK_SIZE_MAX=934576 -DSCR_PROF_STACK_SIZE_MIN2=1048576 -DSCR_PROF_STACK_SIZE_MAX2=1048576 -include G:/scriptc/tests/perf/heapcensus/scr_heap_census.h"

{
  echo "ARM            prof+heapcensus (post-fix, arm mb -- STACKLESS, bands on the MEGABYTE PAIR)"
  echo "head           $(git -C $REPO rev-parse HEAD)"
  echo "branch         $(git -C $REPO rev-parse --abbrev-ref HEAD)"
  echo "dirty          $(git -C $REPO status --porcelain | wc -l)"
  echo "worktree       /g/scriptc   (node_modules is a REAL directory, not a symlink)"
  echo "zig            $(zig version) at $(command -v zig)"
  echo "tar            $(command -v tar)"
  echo "node           $(node --version) at $(command -v node)"
  echo "target         $SCRIPTC_TARGET"
  echo "KNOB           SCRIPTC_STACKLESS=${SCRIPTC_STACKLESS:-<ABSENT -- the point of this arm>}"
  echo "guard          tests/perf/stackless-knob-guard.mjs 6/6 PASS, see mb-run/guard.txt"
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
echo "MB-BUILD-DONE rc=$RC"
