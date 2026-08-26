#!/bin/bash
# Engine-free scan, ARMED. Counts five markers in each binary given.
#
# Only markers that are NON-ZERO in the --dynamic control discriminate: a
# marker reading zero in a binary that CERTAINLY embeds the engine would
# have called anything engine-free, and is not evidence. The control is
# scanned first, every run, and its row is printed with the corpus.
#
#   usage: enginescan.sh <control.exe> <binary> [binary...]
CTL="$1"; shift
markers=(quickjs ScrDyn JS_NewRuntime JS_Eval __island_eval)
printf '%-34s' "binary"
for m in "${markers[@]}"; do printf '%14s' "$m"; done
printf '\n'
scan() {
  local f="$1" label="$2"
  printf '%-34s' "$label"
  for m in "${markers[@]}"; do
    n=$(grep -a -o "$m" "$f" 2>/dev/null | wc -l | tr -d " ")
    [ -z "$n" ] && n=0
    printf '%14s' "$n"
  done
  printf '\n'
}
scan "$CTL" "CONTROL(--dynamic)"
for f in "$@"; do scan "$f" "$(basename "$f")"; done
echo
echo "-- discriminating markers (non-zero in the control) --"
for m in "${markers[@]}"; do
  n=$(grep -a -o "$m" "$CTL" 2>/dev/null | wc -l | tr -d " ")
  [ -z "$n" ] && n=0
  if [ "$n" -gt 0 ]; then echo "   $m ($n in control)"; else echo "   $m  -- ZERO IN CONTROL, NOT EVIDENCE"; fi
done
