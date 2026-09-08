#!/usr/bin/env bash
# One program, three lanes: node v25.9.0 oracle, --backend c, --backend llvm.
# Scores MATCH / WRONG / TRAP / DID-NOT-RUN per backend. Never gates on exit
# status: a run that prints an uncaught error can still exit 0.
set -u
WT=${BLOCKS_ROOT:-<blocks>}/twobyte
OUT=${OUT:-${BLOCKS_ROOT:-<blocks>}/twobyte-lab/runs/progs}
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
NODE25=${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0/node.exe
mkdir -p "$OUT"
for f in "$@"; do
  n=$(basename "$f" .ts)
  "$NODE25" "$f" > "$OUT/$n.node.txt" 2> "$OUT/$n.node.err"; necho=$?
  for be in c llvm; do
    node "$WT/packages/cli/dist/main.js" run "$f" --backend "$be" \
      -o "$OUT/$n.$be.exe" > "$OUT/$n.$be.txt" 2> "$OUT/$n.$be.err"
    rc=$?
    # A binary that FAULTS prints nothing and can still look like a
    # non-build. Only a run with NO executable and a named refusal is a
    # TRAP; empty stdout from a binary that exists is a WRONG answer.
    if [ ! -s "$OUT/$n.$be.txt" ] && [ ! -f "$OUT/$n.$be.exe" ] && [ $rc -ne 0 ]; then
      if rg -q "error SC[0-9]+" "$OUT/$n.$be.err" "$OUT/$n.$be.txt" 2>/dev/null; then
        echo "$n $be TRAP $(rg -o 'error SC[0-9]+[^\n]{0,90}' "$OUT/$n.$be.err" "$OUT/$n.$be.txt" 2>/dev/null | head -1)"
      else
        echo "$n $be DID-NOT-RUN rc=$rc $(head -c 160 "$OUT/$n.$be.err" | tr '\n' ' ')"
      fi
      continue
    fi
    if [ -s "$OUT/$n.node.txt" ] && [ ! -s "$OUT/$n.$be.txt" ]; then
      echo "$n $be WRONG (empty stdout, exe exists, rc=$rc -- a fault, not a non-build)"
      continue
    fi
    if diff -q "$OUT/$n.node.txt" "$OUT/$n.$be.txt" >/dev/null 2>&1; then
      echo "$n $be MATCH"
    else
      echo "$n $be WRONG"
    fi
  done
done
