#!/bin/bash
# build.sh <compilerRoot> <tag> <cacheDirName> — build ixmax3.ts from THE ONE
# app directory.  Every arm uses G:/zapo-work/zapobench-artifacts/app; arms
# differ only by the output binary's NAME, because the app path is baked into
# the emitted TU ~94,000 times and two directories make the md5s always differ.
set -u
. /g/blocks/zapobench/lab/env.sh
CC_ROOT="$1"; TAG="$2"; CDIR="$3"
APP=/g/zapo-work/zapobench-artifacts/app
OUT=/g/zapo-work/zapobench-artifacts
LOG=/g/blocks/zapobench/lab/build-$TAG.log
# One cache dir per arm.  The shared object cache is known-defective (empty
# key directories, and stale objects under live keys), and a control taken
# through a poisoned cache is not a control.
export SCRIPTC_CACHE_DIR='G:\blocks\zapobench\'"$CDIR"
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\zapobench\'"$CDIR"'\prov'
export SCRIPTC_TRAP_TRACE=1
mkdir -p "/g/blocks/zapobench/$CDIR/prov"
echo "SCRIPTC_CACHE_DIR=$SCRIPTC_CACHE_DIR" > "$LOG"
rm -f "$APP/ixmax3.c"
cd "$APP" || exit 1
START=$(date +%s)
node "$CC_ROOT/packages/cli/dist/main.js" build ixmax3.ts \
  --backend c --provenance-sources --best-effort --keep-c \
  -o "$OUT/exe/$TAG.exe" >> "$LOG" 2>&1
RC=$?
END=$(date +%s)
echo "EXIT=$RC WALL=$((END-START))s" >> "$LOG"
if [ -f "$APP/ixmax3.c" ]; then mv "$APP/ixmax3.c" "$OUT/tu/$TAG.c"; fi
echo "tag=$TAG exit=$RC wall=$((END-START))s"
[ -f "$OUT/exe/$TAG.exe" ] && ls -l "$OUT/exe/$TAG.exe"
[ -f "$OUT/tu/$TAG.c" ] && { stat -c "TU %s bytes" "$OUT/tu/$TAG.c"; md5sum "$OUT/tu/$TAG.c"; }
