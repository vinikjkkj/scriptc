#!/bin/bash
# build.sh <driver> <cli-dist-main.js> <out-prefix>
# Real driver build, the same recipe as the box's canonical rigs (~/sc/rigs/<driver>/build.sh):
# compile the driver's zapo store entry with --provenance-sources on the C backend.
# mysql2 is measured WITH --npm-static mysql2 (the defined mysql2 count).
# Writes <out-prefix>.txt (the compiler's full output, ending with rc=N).
# Always exits 0: a refused build (rc=1) is the expected measurement, not a job failure.
set -u
driver=$1; cli=$(readlink -f "$2"); out=$(readlink -m "$3")
here=$(cd "$(dirname "$0")" && pwd)
case "$driver" in
  mysql2)  entry=mysql-entry.ts; extra=(--npm-static mysql2) ;;
  pg)      entry=pg-entry.ts;    extra=() ;;
  ioredis) entry=redis-entry.ts; extra=() ;;
  mongodb) entry=mongo-entry.ts; extra=() ;;
  *) echo "unknown driver: $driver" >&2; exit 2 ;;
esac
mkdir -p "$(dirname "$out")"
cd "$here"
timeout 3000 node "$cli" build "$entry" --provenance-sources "${extra[@]}" --backend c -o "$out.bin" > "$out.txt" 2>&1
echo "rc=$?" >> "$out.txt"
rm -f "$out.bin"
echo "$driver: $(tail -1 "$out.txt") errors=$(grep -c ' - error SC' "$out.txt")"
exit 0
