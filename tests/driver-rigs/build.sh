#!/bin/bash
# build.sh <driver> <cli-dist-main.js> <out-prefix>
# Real driver build, the same recipe as the box's canonical rigs (~/sc/rigs/<driver>/build.sh):
# compile the driver's zapo store entry with --provenance-sources on the C backend.
# mysql2 is measured WITH --npm-static mysql2 (the defined mysql2 count).
# Writes <out-prefix>.txt (the compiler's full output, ending with rc=N) and, on rc=0, <out-prefix>.bin.
# Always exits 0: a refused build (rc=1) is the expected measurement, not a job failure.
set -u
driver=$1; cli=$(readlink -f "$2"); out=$(readlink -m "$3")
here=$(cd "$(dirname "$0")" && pwd)
. "$here/entries.sh"
mkdir -p "$(dirname "$out")"
cd "$here"
timeout 19800 node "$cli" build "$entry" --provenance-sources "${extra[@]}" --backend c -o "$out.bin" > "$out.txt" 2>&1
rc=$?
echo "rc=$rc" >> "$out.txt"
# keep the binary of a successful build (uploaded as its own artifact); drop a partial one
[ "$rc" = 0 ] || rm -f "$out.bin"
echo "$driver: $(tail -1 "$out.txt") errors=$(grep -c ' - error SC' "$out.txt")"
exit 0
