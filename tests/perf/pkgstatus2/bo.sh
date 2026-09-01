#!/bin/bash
# build-and-oracle: $1 = driver path relative to $LAB/app, $2 = name, $3.. = flags
. /g/blocks/pkgstatus2-lab/env.sh
cd "$LAB/app" || exit 1
SRC="$1"; NAME="$2"; shift 2
mkdir -p "$LAB/bin"
rm -f "$LAB/bin/$NAME.exe" "$LAB/bin/$NAME.c.exe" "$LAB/bin/$NAME.c.c" "$LAB/bin/$NAME.llvm.out" "$LAB/bin/$NAME.c.out"
rc_llvm=1; rc_c=1
echo "### $NAME  ($SRC)  flags: $*"
timeout 2400 node "$WT/packages/cli/dist/main.js" build "$SRC" -o "$LAB/bin/$NAME.exe" "$@" > "$LAB/bin/$NAME.build-llvm.log" 2>&1
rc_llvm=$?
timeout 2400 node "$WT/packages/cli/dist/main.js" build "$SRC" --backend c -o "$LAB/bin/$NAME.c.exe" "$@" > "$LAB/bin/$NAME.build-c.log" 2>&1
rc_c=$?
echo "build llvm rc=$rc_llvm  c rc=$rc_c"
if [ $rc_llvm -ne 0 ]; then
  echo "-- llvm diagnostics: $(rg -a -o -c '\[SC[0-9]{4}' "$LAB/bin/$NAME.build-llvm.log" 2>/dev/null || echo 0) SC-tagged lines"
  tail -15 "$LAB/bin/$NAME.build-llvm.log"
fi
[ $rc_c -ne 0 ] && tail -6 "$LAB/bin/$NAME.build-c.log"

if [ $rc_llvm -eq 0 ]; then
  echo "bytes llvm: $(stat -c%s "$LAB/bin/$NAME.exe")"
  timeout 300 "$LAB/bin/$NAME.exe" > "$LAB/bin/$NAME.llvm.out" 2>&1; echo "run llvm exit=$?"
fi
if [ $rc_c -eq 0 ]; then
  echo "bytes c:    $(stat -c%s "$LAB/bin/$NAME.c.exe")"
  timeout 300 "$LAB/bin/$NAME.c.exe" > "$LAB/bin/$NAME.c.out" 2>&1; echo "run c    exit=$?"
fi
timeout 300 "$NODE25/node.exe" "$WT/node_modules/tsx/dist/cli.mjs" "$SRC" > "$LAB/bin/$NAME.node.out" 2>&1
echo "node v25 exit=$?"

for b in llvm c; do
  f="$LAB/bin/$NAME.$b.out"
  [ -f "$f" ] || continue
  if diff -q "$f" "$LAB/bin/$NAME.node.out" > /dev/null; then echo "ORACLE $b: MATCH (byte-exact)"; else echo "ORACLE $b: DIFF"; diff "$f" "$LAB/bin/$NAME.node.out" | head -14; fi
done

for e in "$LAB/bin/$NAME.exe" "$LAB/bin/$NAME.c.exe"; do
  [ -f "$e" ] || continue
  printf 'engine scan %s: quickjs=%s ScrDyn=%s JS_NewRuntime=%s\n' "$(basename "$e")" \
    "$(strings -a "$e" | grep -c quickjs)" "$(strings -a "$e" | grep -c ScrDyn)" "$(strings -a "$e" | grep -c JS_NewRuntime)"
done

# fences in the emitted C TU
SBASE=$(basename "$SRC"); SBASE="${SBASE%.*}"
CFILE=$(ls -1 "$LAB/bin/$SBASE.c" "$LAB/bin/$NAME.c" 2>/dev/null | head -1)
if [ -n "$CFILE" ]; then
  tot=$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$CFILE" | wc -l)
  uniq=$(rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$CFILE" | sort -u | wc -l)
  echo "FENCES in $(basename "$CFILE"): total=$tot distinct=$uniq"
  rg -a -o '\[SC[0-9]{4} at [^]]*\]' "$CFILE" | sort | uniq -c | sort -rn | head -25
else
  echo "FENCES: no .c TU kept (ls $LAB/bin/$NAME*)"
fi
