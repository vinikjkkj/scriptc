#!/bin/bash
# build2.sh -- block wamcoord. ONE strict build, no --best-effort.
#   $1 = source (relative to $LAB/napp), $2 = name, $3.. = extra flags.
# Counting traps armed against, same as pkgstatus's build1.sh:
#   * a build LOG carries " - error SCxxxx: "; an emitted C TU carries
#     "[SCxxxx at file:line]". Both patterns are run, and the BYTE SIZE of
#     what was scanned is printed beside every count.
#   * a non-zero build emits no TU: its fence count is n/a, never 0.
#   * the compiler's own "N errors." line is printed verbatim as a cross-check.
. ${BLOCKS_ROOT:-<blocks>}/wamcoord-lab/env.sh
cd "$LAB/napp" || exit 1
SRC="$1"; NAME="$2"; shift 2
SBASE=$(basename "$SRC" .ts)
OUT="$LAB/out"
mkdir -p "$OUT"
rm -f "$OUT/$NAME.exe" "$OUT/$NAME".*.c "$OUT/$NAME.c" "$OUT/$NAME.scrh" "$OUT/$NAME.build.log" "$OUT/$NAME.run.out" "$OUT/$NAME.node.out"
echo "### $NAME  src=$SRC  flags:[$*]  AUTHORED_JS=${SCRIPTC_PROVENANCE_AUTHORED_JS:-<unset>}"
echo "### node=$(node --version)  zig=$(zig version)  tar=$(tar --version | head -1)  cc=$SCRIPTC_CC  target=$SCRIPTC_TARGET"
t0=$(date +%s)
timeout 9000 node "$WT/packages/cli/dist/main.js" build "$SRC" -o "$OUT/$NAME.exe" "$@" > "$OUT/$NAME.build.log" 2>&1
rc=$?
t1=$(date +%s)
LOGB=$(stat -c%s "$OUT/$NAME.build.log")
echo "BUILD rc=$rc  $((t1 - t0))s  log=${LOGB}B"
echo "--- provenance notes ---"
rg -a -n '^provenance:' "$OUT/$NAME.build.log" | head -40
echo "--- backend line (which backend actually ran) ---"
rg -a -n 'backend' "$OUT/$NAME.build.log" | head -5
echo "--- log error sites: pattern [ - error SCxxxx: ] over ${LOGB} bytes ---"
printf 'LOG-SITES total=%s\n' "$(rg -a -c ' - error SC[0-9]{4}: ' "$OUT/$NAME.build.log" 2>/dev/null || echo 0)"
rg -a -o ' - error (SC[0-9]{4}): ' -r 'LOG-CODE  $1' "$OUT/$NAME.build.log" 2>/dev/null | sort | uniq -c | sort -rn
echo "--- compiler's own totals line (cross-check) ---"
rg -a -n '^[0-9]+ errors?\.$' "$OUT/$NAME.build.log" | tail -2
if [ $rc -eq 0 ]; then
  echo "BINARY bytes=$(stat -c%s "$OUT/$NAME.exe")"
  timeout 600 "$OUT/$NAME.exe" > "$OUT/$NAME.run.out" 2>&1
  echo "RUN exit=$?  stdout=$(stat -c%s "$OUT/$NAME.run.out")B"
  echo "--- fences over EVERY emitted TU (.c, .partN.c, .scrh) ---"
  TOT=0; FILES=0; BYTES=0
  for c in "$OUT/$NAME".c "$OUT/$NAME".part*.c "$OUT/$NAME".scrh "$OUT/$SBASE".c "$OUT/$SBASE".part*.c "$OUT/$SBASE".scrh; do
    [ -f "$c" ] || continue
    CB=$(stat -c%s "$c"); N=$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$c" | wc -l)
    printf '    %-42s bytes=%-14s fences=%s\n' "$(basename "$c")" "$CB" "$N"
    TOT=$((TOT + N)); FILES=$((FILES + 1)); BYTES=$((BYTES + CB))
  done
  echo "    TOTAL files=$FILES bytes=$BYTES FENCES=$TOT"
  for c in "$OUT/$NAME".c "$OUT/$NAME".part*.c "$OUT/$NAME".scrh "$OUT/$SBASE".c "$OUT/$SBASE".part*.c "$OUT/$SBASE".scrh; do
    [ -f "$c" ] && rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$c"
  done | sort | uniq -c | sort -rn | head -10
  echo "--- embedded-engine scan (must all read 0 for a static claim) ---"
  for m in quickjs ScrDyn JS_NewRuntime; do
    printf '    %-14s %s\n' "$m" "$(rg -a -c "$m" "$OUT/$NAME.exe" 2>/dev/null || echo 0)"
  done
  timeout 600 "$NODE25/node.exe" "$WT/node_modules/tsx/dist/cli.mjs" "$SRC" > "$OUT/$NAME.node.out" 2>&1
  echo "ORACLE node $("$NODE25/node.exe" --version) exit=$?  stdout=$(stat -c%s "$OUT/$NAME.node.out")B"
  if diff -q "$OUT/$NAME.run.out" "$OUT/$NAME.node.out" > /dev/null 2>&1; then
    echo "ORACLE: MATCH (byte-exact)"
  else
    echo "ORACLE: DIFF"; diff "$OUT/$NAME.run.out" "$OUT/$NAME.node.out" | head -20
  fi
else
  echo "BINARY: none (rc=$rc) -- FENCE COUNT n/a, NOT 0"
  echo "--- last 25 log lines ---"
  tail -25 "$OUT/$NAME.build.log"
fi
echo "### DONE $NAME rc=$rc"
