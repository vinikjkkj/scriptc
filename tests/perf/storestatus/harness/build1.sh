#!/bin/bash
# build1.sh -- ONE strict build, no --best-effort. Records build-LEVEL evidence.
#   bash build1.sh <src-relative-to-$LAB/napp> <name> [extra flags...]
#
# Counting traps this script is armed against, each one having produced a
# false number in this tree before:
#   * a build LOG carries " - error SCxxxx: "; an emitted C TU carries
#     "[SCxxxx at file:line]". Scanning a log with the C pattern reads a
#     silent zero, and vice versa. Both are counted with their own pattern and
#     the BYTE SIZE of what was scanned is printed beside every count, so an
#     empty or absent file cannot pass as a zero.
#   * a build that exits non-zero emits no complete C TU: its fence count is
#     n/a, NEVER 0. The script says so in words.
#   * the per-code tally is cross-checked against the compiler's own
#     "N errors." line, printed verbatim.
#   * fences are counted over EVERY emitted TU (.c, .partN.c, .scrh, .h), and
#     split into SC900x (assertions emitted for CORRECT code) and everything
#     else, because 3,782 of 3,786 SC occurrences in one clean build were
#     SC900x and quoting the raw total invents a refusal count.
set -o pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh" || exit 1
cd "$LAB/napp" || exit 1
SRC="$1"; NAME="$2"; shift 2
mkdir -p "$OUT"
rm -f "$OUT/$NAME.exe" "$OUT/$NAME".c "$OUT/$NAME".part*.c "$OUT/$NAME".scrh \
      "$OUT/$NAME".ll "$OUT/$NAME.build.log" "$OUT/$NAME.run.out" "$OUT/$NAME.node.out"
echo "### $NAME  src=$SRC  flags:[$*]"
echo "### node=$(node --version)  zig=$(zig version)  tar=$(tar --version | head -1)  cc=$SCRIPTC_CC  target=$SCRIPTC_TARGET"
echo "### wt=$WT  head=$(git -C "$WT" rev-parse --short HEAD)"
t0=$(date +%s)
timeout "${BUILD_TIMEOUT:-7200}" node "$WT/packages/cli/dist/main.js" build "$SRC" -o "$OUT/$NAME.exe" "$@" > "$OUT/$NAME.build.log" 2>&1
rc=$?
t1=$(date +%s)
LOGB=$(stat -c%s "$OUT/$NAME.build.log")
echo "BUILD rc=$rc  $((t1 - t0))s  log=${LOGB}B"
echo "--- provenance notes (the driver's alias table, in the compiler's words) ---"
rg -a -n '^provenance:' "$OUT/$NAME.build.log" | head -60
echo "--- log error SITES: pattern [ - error SCxxxx: ] over ${LOGB} bytes ---"
printf 'LOG-SITES total=%s\n' "$(rg -a -c ' - error SC[0-9]{4}: ' "$OUT/$NAME.build.log" 2>/dev/null || echo 0)"
rg -a -o ' - error (SC[0-9]{4}): ' -r 'LOG-CODE  $1' "$OUT/$NAME.build.log" 2>/dev/null | sort | uniq -c | sort -rn
echo "--- uncoded refusals (a refusal need not carry a code) ---"
printf 'LOG-UNCODED total=%s\n' "$(rg -a -c ' - error (?!SC[0-9]{4}: )' "$OUT/$NAME.build.log" 2>/dev/null || echo 0)"
echo "--- compiler's own totals line (cross-check) ---"
rg -a -n '^[0-9]+ errors?\.$' "$OUT/$NAME.build.log" | tail -2
if [ $rc -eq 0 ]; then
  echo "BINARY bytes=$(stat -c%s "$OUT/$NAME.exe")"
  timeout 600 "$OUT/$NAME.exe" > "$OUT/$NAME.run.out" 2>&1
  echo "RUN exit=$?  stdout=$(stat -c%s "$OUT/$NAME.run.out")B"
  # The emitted TUs are named after the ENTRY, not after -o. Scanning only
  # "$NAME" found nothing for a 141 MB, 16-file emission and (correctly, but
  # uselessly) reported ABSENT. Both basenames are scanned.
  bash "$HERE/fences.sh" "$OUT" "$NAME" "$(basename "$SRC" .ts)"
  timeout 600 "$NODE25/node.exe" "$WT/node_modules/tsx/dist/cli.mjs" "$SRC" > "$OUT/$NAME.node.out" 2>&1
  echo "ORACLE node $("$NODE25/node.exe" --version) exit=$?  stdout=$(stat -c%s "$OUT/$NAME.node.out")B"
  if diff -q "$OUT/$NAME.run.out" "$OUT/$NAME.node.out" > /dev/null 2>&1; then
    echo "ORACLE: MATCH (byte-exact)"
  else
    echo "ORACLE: DIFF"; diff "$OUT/$NAME.run.out" "$OUT/$NAME.node.out" | head -12
  fi
  echo "--- engine scan: is quickjs linked in? ---"
  bash "$HERE/engine-scan.sh" "$OUT/$NAME.exe"
else
  echo "BINARY: none (rc=$rc) -- FENCE COUNT n/a, NOT 0; ENGINE SCAN n/a"
  echo "--- last 25 log lines ---"
  tail -25 "$OUT/$NAME.build.log"
fi
echo "### DONE $NAME rc=$rc"
