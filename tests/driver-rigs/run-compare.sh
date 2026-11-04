#!/bin/bash
# run-compare.sh <driver> <built-binary> <out-dir>
# Runs the driver's entry on Node and the compiled binary of the same entry, then compares stdout, stderr and the exit code.
# Writes <out-dir>/<driver>.node.{out,err} and <driver>.bin.{out,err} (the exit code is the last line of .out); exits 1 on any difference.
set -u
driver=$1; bin=$(readlink -f "$2"); out=$(readlink -m "$3")
here=$(cd "$(dirname "$0")" && pwd)
. "$here/entries.sh"
mkdir -p "$out"
cd "$here"
timeout 300 node --no-warnings "$entry" > "$out/$driver.node.out" 2> "$out/$driver.node.err"
echo "exit=$?" >> "$out/$driver.node.out"
timeout 300 "$bin" > "$out/$driver.bin.out" 2> "$out/$driver.bin.err"
echo "exit=$?" >> "$out/$driver.bin.out"
rc=0
for s in out err; do
  if cmp -s "$out/$driver.node.$s" "$out/$driver.bin.$s"; then
    echo "$driver: std$s SAME ($(wc -c < "$out/$driver.node.$s") bytes)"
  else
    echo "$driver: std$s DIFFERS (node vs binary):"
    diff "$out/$driver.node.$s" "$out/$driver.bin.$s" | head -40
    rc=1
  fi
done
echo "--- node stdout"; cat "$out/$driver.node.out"
exit $rc
