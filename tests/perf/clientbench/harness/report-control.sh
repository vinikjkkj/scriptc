#!/bin/sh
# report-control.sh <tag> [--npm-static argo-codec]
# A tiny program that dynamically imports argo-codec, built through the same
# guarded scc wrapper. Two things are being controlled: the npm-static
# confirmation line on stderr, and the fence-location qualifier baked into the
# emitted C.
set -u
. ${BLOCKS_ROOT:-<blocks>}/clientbench/lab/env.sh || exit 1
TAG=$1; shift
mkdir -p "$LAB/out/$TAG"
cd "$APP" || exit 1
node "$SCC" build mexprobe/report-control.ts --backend c "$@" \
  -o "$LAB/out/$TAG/report-control.exe" > "$LAB/out/$TAG.log" 2>&1
echo "BUILD_EXIT=$?" >> "$LAB/out/$TAG.log"
