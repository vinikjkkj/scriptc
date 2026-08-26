#!/bin/bash
# One scriptc build, detached, so the 10-minute shell timeout cannot orphan a
# tsgo/zig child.  $1 = driver (relative to lab/app), $2 = tag, $3.. = flags.
. /g/blocks/wamvoip/env.sh
cd "$LAB/app" || exit 1
DRV="$1"; TAG="$2"; shift 2
mkdir -p "$LAB/bin" "$LAB/out"
{
  echo "START $(date +%T) $DRV -> $TAG"
  echo "FLAGS $*"
} > "$LAB/out/$TAG.build.log"
SCRIPTC_GENERIC_SLOT=1 node "$SCRIPTC" build "$DRV" -o "$LAB/bin/$TAG.exe" "$@" \
  >> "$LAB/out/$TAG.build.log" 2>&1
echo "BUILD_EXIT=$? $(date +%T)" >> "$LAB/out/$TAG.build.log"
