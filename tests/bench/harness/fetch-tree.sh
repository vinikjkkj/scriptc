#!/bin/bash
# fetch-tree.sh: materialise the zapo-js 1.12.0 checkout the bench programs are built from, plus the app's npm dependencies.
# The commit is the one scriptc's own provenance resolves zapo-js@1.12.0 to (1147011e218e...). Idempotent.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
ZAPO_SHA=${ZAPO_SHA:-1147011e218eff028b4b7ebcbf7aa7a3f8dc7284}
mkdir -p "$ZB_APP"
if [ ! -f "$TREE/.fetched-$ZAPO_SHA" ]; then
  rm -rf "$TREE"; mkdir -p "$TREE"
  auth=(); [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  curl -fsSL "${auth[@]}" "https://codeload.github.com/vinikjkkj/zapo/tar.gz/$ZAPO_SHA" | tar -xz -C "$TREE" --strip-components=1
  touch "$TREE/.fetched-$ZAPO_SHA"
fi
cp "$BENCH_DIR/app/package.json" "$BENCH_DIR/app/package-lock.json" "$ZB_APP/"
( cd "$ZB_APP" && npm ci --ignore-scripts --no-audit --no-fund )
# the Node reference arm of the sqlite bench needs better-sqlite3's native binding (npm ci ran with --ignore-scripts): fetch/build just that one
( cd "$ZB_APP" && npm rebuild better-sqlite3 --no-audit --no-fund ) || echo "better-sqlite3 rebuild failed: the sqlite Node reference arm will not run"
# pmon, the external instrument
cc -O2 -o "$BENCH_WORK/pmon" "$BENCH_DIR/harness/pmon.c"
echo "tree: $TREE ($ZAPO_SHA); pmon: $BENCH_WORK/pmon"
