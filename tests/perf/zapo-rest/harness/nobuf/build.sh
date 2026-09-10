#!/bin/sh
# build.sh — build the two arms of the no-buffer experiment from ONE tree state.
#
#   sh build.sh toolchain   # compiler + cli tsc, with the staleness guard
#   sh build.sh buf         # the CONTROL arm  (zapo-rest.ts,       has the ring)
#   sh build.sh nobuf       # the TREATMENT arm (zapo-rest-nobuf.ts, no ring)
#   sh build.sh all
#
# STRICT. No --best-effort: it defers per-statement refusals into runtime
# throws, so a zero site count would not be zero refusals and a "successful"
# build could be a service that throws on its first event.
#
# Both arms are built from the SAME worktree at the SAME commit with the SAME
# flags. They differ only in the entry file, and the entry files differ only by
# make-nobuf.mjs. That is the whole experimental control.
#
# SEPARATE -o DIRECTORIES. The compiler names its intermediate from the entry
# BASENAME, so zapo-rest.ll and zapo-rest-nobuf.ll would not actually collide;
# the separate directories are kept anyway so a half-finished arm can never be
# mistaken for the other one's artefact, and so each arm's .ll can be measured
# and deleted independently.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh" build

WHAT="${1:-all}"
cd "$WT"

banner() {
  echo "### $1"
  echo "###   rev        $(git rev-parse --short HEAD) ($(git rev-parse HEAD))"
  echo "###   node       $(node --version)"
  echo "###   zig        $(zig version)"
  echo "###   target     $SCRIPTC_TARGET"
  echo "###   cc         $SCRIPTC_CC"
  echo "###   provcache  $SCRIPTC_PROVENANCE_CACHE"
  echo "###   tmp        $TMP"
  echo "###   started    $(date -Is)"
}

toolchain() {
  banner "TOOLCHAIN"
  echo "=== compiler tsc ==="
  ( cd packages/compiler && node node_modules/typescript5/bin/tsc -p tsconfig.json ) || {
    echo "=== ABORT: compiler tsc failed ==="; echo "=== BUILD-EXIT rc=98 ==="; exit 98; }
  echo "=== cli tsc ==="
  ( cd packages/cli && node ../../node_modules/typescript/bin/tsc -p tsconfig.json ) || {
    echo "=== ABORT: cli tsc failed ==="; echo "=== BUILD-EXIT rc=98 ==="; exit 98; }

  # STALENESS GUARD. cli/dist/main.js is a thin entry and legitimately does not
  # change when only packages/compiler moves, so its mtime says nothing. The
  # question that IS stable across re-runs is whether the compiled compiler is
  # newer than its own SOURCE.
  newest_src=$(find packages/compiler/src  -name '*.ts' -newer packages/compiler/tsconfig.json -o -name '*.ts' | xargs ls -t 2>/dev/null | head -1)
  newest_dist=$(find packages/compiler/dist -name '*.js' | xargs ls -t 2>/dev/null | head -1)
  echo "newest compiler SRC   $newest_src"
  echo "newest compiler DIST  $newest_dist"
  if [ -z "$newest_dist" ] || [ "$newest_src" -nt "$newest_dist" ]; then
    echo "=== ABORT: compiler dist is OLDER than compiler src — would compile against a stale compiler ==="
    echo "=== BUILD-EXIT rc=97 ==="; exit 97
  fi
  echo "staleness guard PASSED (dist newer than src)"
  echo "=== TOOLCHAIN-EXIT rc=0 ==="
}

# $1 = arm label, $2 = entry basename, $3 = -o file (Windows spelling)
arm() {
  label="$1"; entry="$2"; out="$3"
  banner "ARM $label"
  echo "###   entry      tests/perf/zapo-rest/app182/$entry"
  echo "###   out        $out"
  echo "=== scriptc build (STRICT, no --best-effort) ==="
  set +e
  node packages/cli/dist/main.js build "tests/perf/zapo-rest/app182/$entry" -o "$out" --provenance-sources 2>&1
  rc=$?
  set -e
  echo "=== BUILD-EXIT rc=$rc arm=$label ==="
  echo "finished $(date -Is)"
  # -o names a FILE, not a directory. Report the artefact by that exact path.
  win_to_posix() { printf '%s' "$1" | sed -e 's|\\|/|g' -e 's|^\([A-Za-z]\):|/\L\1|'; }
  p=$(win_to_posix "$out")
  if [ -f "$p" ]; then
    echo "ARTIFACT   $out $(stat -c%s "$p") bytes"
  else
    echo "ARTIFACT   NONE at $out"
  fi
}

case "$WHAT" in
  toolchain) toolchain ;;
  buf)   arm buf   zapo-rest.ts       "$EXE_BUF" ;;
  nobuf) arm nobuf zapo-rest-nobuf.ts "$EXE_NOBUF" ;;
  all)   toolchain; arm buf zapo-rest.ts "$EXE_BUF"; arm nobuf zapo-rest-nobuf.ts "$EXE_NOBUF" ;;
  *) echo "usage: build.sh toolchain|buf|nobuf|all"; exit 2 ;;
esac
