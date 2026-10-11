#!/bin/sh
# f2-chain.sh -- waits for the POS build to land, ASSERTS it, then runs the six.
# Writes ONLY /g/blocks/f2-run/chain.log (and whatever f2-six.sh writes, which
# is /g/blocks/f2-run/<tag>.* and nothing else).  Touches no other directory.
set -u
LOG=/g/blocks/f2-run/chain.log
EXE=/g/blocks/f2-out182-POS/zapo-rest-182.exe
ENVF=/g/blocks/f2-run/POS.build-env.txt
echo "CHAIN-START $(date -u +%H:%M:%S)" > "$LOG"
i=0
while [ $i -lt 240 ]; do
  if grep -q '^BUILD-EXIT' "$ENVF" 2>/dev/null; then break; fi
  i=$((i+1)); sleep 10
done
RC=$(awk '/^BUILD-EXIT/{print $2}' "$ENVF" 2>/dev/null)
EC=$(awk '/^EARLY-CACHE/{print $2}' "$ENVF" 2>/dev/null)
LLN=$(awk '/^EMITTED-LL-N/{print $2}' "$ENVF" 2>/dev/null)
CN=$(awk '/^EMITTED-C-N/{print $2}' "$ENVF" 2>/dev/null)
{
  echo "BUILD-EXIT    ${RC:-<none>}"
  echo "EARLY-CACHE   ${EC:-<none>}   (must be 0: SCRIPTC_PROF_CFLAGS is in the cache key)"
  echo "EMITTED-LL-N  ${LLN:-<none>}  EMITTED-C-N ${CN:-<none>}"
  echo "EXE           $(stat -c %s "$EXE" 2>/dev/null || echo MISSING)"
} >> "$LOG"
if [ "${RC:-1}" != "0" ] || [ ! -s "$EXE" ] || [ "${EC:-1}" != "0" ]; then
  echo "CHAIN-ABORT   build did not satisfy the assertions; NO RUNS STARTED" >> "$LOG"
  exit 2
fi
echo "CHAIN-OK      assertions passed, starting the six at $(date -u +%H:%M:%S)" >> "$LOG"
sh /g/blocks/f2-six.sh >> "$LOG" 2>&1
echo "CHAIN-END     $(date -u +%H:%M:%S)" >> "$LOG"
