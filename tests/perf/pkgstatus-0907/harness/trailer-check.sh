#!/bin/bash
# Attribution-trailer check, run as ITS OWN STEP, never chained to the commit.
#   bash trailer-check.sh --rev <rev>    check a commit's message
#   bash trailer-check.sh --file <path>  check a message file (used to CONTROL it)
# A count of 0 is only trustworthy if the same pattern reports non-zero on a
# message that does carry trailers, so the control arm is part of the script.
PAT='Co-Authored-By:|Co-authored-by:|Claude-Session:|Generated with \[Claude Code\]|noreply@anthropic.com|claude\.ai/code'
mode="$1"; arg="$2"
if [ "$mode" = "--rev" ]; then TXT=$(git log -1 --format='%B' "$arg"); LABEL="rev $(git rev-parse --short "$arg" 2>/dev/null)"
else TXT=$(cat "$arg"); LABEL="file $arg"; fi
n=$(printf '%s' "$TXT" | rg -c -e "$PAT" 2>/dev/null); n=${n:-0}
b=$(printf '%s' "$TXT" | wc -c)
echo "$LABEL  message bytes=$b  trailer lines=$n  expected=0"
if [ "$n" -eq 0 ]; then echo "PASS: no attribution trailers"; else echo "FAIL: $n trailer line(s)"; printf '%s' "$TXT" | rg -n -e "$PAT"; fi
