#!/bin/bash
# build-and-oracle: $1 = driver path relative to $LAB/app, $2 = name, $3.. = flags
# Builds on BOTH backends, runs both, runs the same source under node v25.9.0,
# and scans for the engine with the only two markers that discriminate.
. /g/blocks/pkgstatus-lab/env.sh
cd "$LAB/app" || exit 1
SRC="$1"; NAME="$2"; shift 2
mkdir -p "$LAB/bin"
rc_llvm=1; rc_c=1
echo "### $NAME  ($SRC)  flags: $*"
timeout 2400 node "$WT/packages/cli/dist/main.js" build "$SRC" -o "$LAB/bin/$NAME.exe" "$@" > "$LAB/bin/$NAME.build-llvm.log" 2>&1
rc_llvm=$?
timeout 2400 node "$WT/packages/cli/dist/main.js" build "$SRC" --backend c -o "$LAB/bin/$NAME.c.exe" "$@" > "$LAB/bin/$NAME.build-c.log" 2>&1
rc_c=$?
echo "build llvm rc=$rc_llvm  c rc=$rc_c"
[ $rc_llvm -ne 0 ] && tail -12 "$LAB/bin/$NAME.build-llvm.log"
[ $rc_c -ne 0 ] && tail -6 "$LAB/bin/$NAME.build-c.log"

if [ $rc_llvm -eq 0 ]; then
  echo "bytes llvm: $(stat -c%s "$LAB/bin/$NAME.exe")"
  "$LAB/bin/$NAME.exe" > "$LAB/bin/$NAME.llvm.out" 2>&1; echo "run llvm exit=$?"
fi
if [ $rc_c -eq 0 ]; then
  echo "bytes c:    $(stat -c%s "$LAB/bin/$NAME.c.exe")"
  "$LAB/bin/$NAME.c.exe" > "$LAB/bin/$NAME.c.out" 2>&1; echo "run c    exit=$?"
fi
"$NODE25/node.exe" "$WT/node_modules/tsx/dist/cli.mjs" "$SRC" > "$LAB/bin/$NAME.node.out" 2>&1
echo "node v25 exit=$?"

for b in llvm c; do
  f="$LAB/bin/$NAME.$b.out"
  [ -f "$f" ] || continue
  if diff -q "$f" "$LAB/bin/$NAME.node.out" > /dev/null; then echo "ORACLE $b: MATCH (byte-exact)"; else echo "ORACLE $b: WRONG"; diff "$f" "$LAB/bin/$NAME.node.out" | head -20; fi
done

# Engine scan. JS_NewRuntime / JS_Eval / __island_eval read ZERO in a binary
# that certainly embeds the engine, so only quickjs and ScrDyn discriminate.
for e in "$LAB/bin/$NAME.exe" "$LAB/bin/$NAME.c.exe"; do
  [ -f "$e" ] || continue
  printf 'engine scan %s: quickjs=%s ScrDyn=%s JS_NewRuntime=%s\n' "$(basename "$e")" \
    "$(strings -a "$e" | grep -c quickjs)" "$(strings -a "$e" | grep -c ScrDyn)" "$(strings -a "$e" | grep -c JS_NewRuntime)"
done
