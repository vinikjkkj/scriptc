#!/usr/bin/env bash
# Weigh the two recorded size classes with the harness's own recipe:
# the C backend, plain (non-ASan), the exact two sources island.test.ts
# and regex.test.ts build.
#
#   $1  label for the run
#   env SCRIPTC_TARGET decides which of the two win32 configurations this
#       is; size-class.ts records the NATIVE one (flag unset), and a brief
#       that pins the triple reads ~2.5 KB low on both programs.
set -u
LABEL="${1:?label}"
W=G:/blocks/wrtcjoin
D=G:/blocks/wrtcjoin-lab/size/$LABEL
rm -rf "$D"; mkdir -p "$D"

printf 'console.log("hello", "world");\n' > "$D/size-static.ts"
printf 'console.log("a-b c".replace(/[-\s]/g, "_"), /\p{L}+/u.test("h\xc3\xa9llo"));\n' > "$D/size-regex.ts"

for prog in size-static size-regex; do
  node "$W/packages/cli/dist/main.js" build "$D/$prog.ts" --backend c -o "$D/$prog.exe" > "$D/$prog.build" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "$LABEL $prog BUILD-FAILED rc=$rc"
    grep -c "error:" "$D/$prog.build" | sed "s/^/$LABEL $prog error-lines=/"
    tail -3 "$D/$prog.build"
    continue
  fi
  sz=$(stat -c %s "$D/$prog.exe")
  echo "$LABEL $prog $sz  (SCRIPTC_TARGET=${SCRIPTC_TARGET:-unset})"
done
