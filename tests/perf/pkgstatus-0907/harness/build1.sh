#!/bin/bash
# build1.sh -- ONE strict build, no --best-effort. $1 = source (relative to
# $LAB/napp), $2 = name, $3.. = extra flags.
#
# Counting traps this script is armed against:
#   * a build LOG carries " - error SCxxxx: "; an emitted C TU carries
#     "[SCxxxx at file:line]". Scanning a log with the C pattern reads a
#     silent zero, and vice versa. Both are counted with their own pattern
#     and the BYTE SIZE of what was scanned is printed beside every count,
#     so an empty file cannot pass as a zero.
#   * a build that exits non-zero emits no C TU: its fence count is n/a,
#     never 0. The script says so in words.
#   * the per-code tally is cross-checked against the compiler's own
#     "N errors." line, printed verbatim.
. <blocks>/pkgstatus3-lab/env.sh
cd "$LAB/napp" || exit 1
SRC="$1"; NAME="$2"; shift 2
OUT="$LAB/out"
mkdir -p "$OUT"
rm -f "$OUT/$NAME.exe" "$OUT/$NAME.c" "$OUT/$NAME.build.log" "$OUT/$NAME.run.out" "$OUT/$NAME.node.out"
echo "### $NAME  src=$SRC  flags:[$*]"
echo "### node=$(node --version)  zig=$(zig version)  tar=$(tar --version | head -1)  cc=$SCRIPTC_CC  target=$SCRIPTC_TARGET"
t0=$(date +%s)
timeout 5400 node "$WT/packages/cli/dist/main.js" build "$SRC" -o "$OUT/$NAME.exe" "$@" > "$OUT/$NAME.build.log" 2>&1
rc=$?
t1=$(date +%s)
LOGB=$(stat -c%s "$OUT/$NAME.build.log")
echo "BUILD rc=$rc  $((t1 - t0))s  log=${LOGB}B"
echo "--- provenance notes ---"
rg -a -n '^provenance:' "$OUT/$NAME.build.log" | head -40
echo "--- log error sites: pattern [ - error SCxxxx: ] over ${LOGB} bytes ---"
printf 'LOG-SITES total=%s\n' "$(rg -a -c ' - error SC[0-9]{4}: ' "$OUT/$NAME.build.log" 2>/dev/null || echo 0)"
rg -a -o ' - error (SC[0-9]{4}): ' -r 'LOG-CODE  $1' "$OUT/$NAME.build.log" 2>/dev/null | sort | uniq -c | sort -rn
echo "--- compiler's own totals line (cross-check) ---"
rg -a -n '^[0-9]+ errors?\.$' "$OUT/$NAME.build.log" | tail -2
if [ $rc -eq 0 ]; then
  echo "BINARY bytes=$(stat -c%s "$OUT/$NAME.exe")"
  timeout 300 "$OUT/$NAME.exe" > "$OUT/$NAME.run.out" 2>&1
  echo "RUN exit=$?  stdout=$(stat -c%s "$OUT/$NAME.run.out")B"
  CFILE=""
  for c in "$OUT/$NAME.c" "$OUT/$NAME.exe.c" "$OUT/$(basename "$SRC" .ts).c"; do
    [ -f "$c" ] && { CFILE="$c"; break; }
  done
  if [ -n "$CFILE" ]; then
    CB=$(stat -c%s "$CFILE")
    echo "FENCES in $(basename "$CFILE") over ${CB} bytes: pattern [SCxxxx at file:line]"
    printf 'FENCE-SITES total=%s distinct=%s\n' \
      "$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$CFILE" | wc -l)" \
      "$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$CFILE" | sort -u | wc -l)"
    rg -a -o '\[(SC[0-9]{4}) at' -r 'FENCE-CODE  $1' "$CFILE" | sort | uniq -c | sort -rn | head -15
  else
    echo "FENCES: no .c TU found next to the binary (ls: $(ls "$OUT/$NAME"* 2>/dev/null | tr '\n' ' '))"
  fi
  timeout 300 "$NODE25/node.exe" "$WT/node_modules/tsx/dist/cli.mjs" "$SRC" > "$OUT/$NAME.node.out" 2>&1
  echo "ORACLE node $("$NODE25/node.exe" --version) exit=$?  stdout=$(stat -c%s "$OUT/$NAME.node.out")B"
  if diff -q "$OUT/$NAME.run.out" "$OUT/$NAME.node.out" > /dev/null 2>&1; then
    echo "ORACLE: MATCH (byte-exact)"
  else
    echo "ORACLE: DIFF"; diff "$OUT/$NAME.run.out" "$OUT/$NAME.node.out" | head -12
  fi
else
  echo "BINARY: none (rc=$rc) -- FENCE COUNT n/a, NOT 0"
  echo "--- last 25 log lines ---"
  tail -25 "$OUT/$NAME.build.log"
fi
echo "### DONE $NAME rc=$rc"
