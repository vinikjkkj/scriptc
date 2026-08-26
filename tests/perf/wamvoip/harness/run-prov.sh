#!/bin/bash
# One long provenance analysis, launched detached so the 10-minute shell
# timeout cannot orphan a tsgo child. $1 = entry, $2 = out tag, $3.. = flags.
. /g/blocks/wamvoip/env.sh
cd "$LAB/app" || exit 1
ENTRY="$1"; TAG="$2"; shift 2
mkdir -p "$LAB/out"
echo "START $(date +%T) $ENTRY -> $TAG  flags=$*" > "$LAB/out/$TAG.log"
node "$LAB/sites.mjs" "$PWD/$ENTRY" "$LAB/out/$TAG.json" "$@" >> "$LAB/out/$TAG.log" 2>&1
echo "EXIT=$? $(date +%T)" >> "$LAB/out/$TAG.log"
