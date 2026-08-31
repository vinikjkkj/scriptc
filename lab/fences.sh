#!/usr/bin/env bash
# Fence PARITY: every surface that refuses for a 32-bit typed array must
# refuse identically for the 16-bit one (same code, same shape of message).
# A new element kind that ANSWERS where its neighbours refuse is a silent
# divergence; one that refuses where they answer is a regression.
set -u
WT=/g/blocks/twobyte
TMPD=/g/blocks/twobyte-tmp/fences
mkdir -p "$TMPD"
run() { # $1 = tag, $2 = source text
  printf '%s\n' "$2" > "$TMPD/$1.ts"
  node "$WT/packages/cli/dist/main.js" build "$TMPD/$1.ts" --backend c -o "$TMPD/$1.exe" 2>&1 \
    | rg -o "error SC[0-9]+: .*" | head -1
}
for pair in "Int32Array Int16Array" "Uint32Array Uint16Array"; do
  set -- $pair; A=$1; B=$2
  for probe in "BYTES_PER_ELEMENT:console.log(a.BYTES_PER_ELEMENT)" \
               "inspect:console.log(a)" \
               "json:console.log(JSON.stringify(a))" \
               "indexOf:console.log(a.indexOf(1))" \
               "viewform:const v = new TA(a.buffer, 2); console.log(v.length)" \
               "map:console.log(a.map((x) => x + 1).length)" \
               "reverse:console.log(a.reverse().length)" \
               "sortdefault:console.log(a.sort().length)" \
               "join:console.log(a.join(','))" \
               "at:console.log(a.at(0))" ; do
    name=${probe%%:*}; body=${probe#*:}
    for TA in "$A" "$B"; do
      src="const a = new $TA([1, 2, 3]); ${body//TA/$TA}"
      printf '%-14s %-12s %s\n' "$name" "$TA" "$(run "${name}_${TA}" "$src")"
    done
  done
done
