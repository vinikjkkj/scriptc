#!/bin/bash
# build.sh <driver> <cli-dist-main.js> <out-prefix>
# Real driver build, the same recipe as the box's canonical rigs (~/sc/rigs/<driver>/build.sh):
# compile the driver's zapo store entry with --provenance-sources on the C backend.
# mysql2 is measured WITH --npm-static mysql2 (the defined mysql2 count).
# Writes <out-prefix>.txt (the compiler's full output, ending with rc=N) and, on rc=0, <out-prefix>.bin.
# Exits 0 for the measured drivers (mysql2 pg ioredis mongodb): a refused build (rc=1) is the expected measurement, not a job failure.
# The zapo entries (zapo-core, zapo-startup) are STRICT, see the end of this file: they exit with the compiler's rc and fail on a zero WaClient control.
set -u
driver=$1; cli=$(readlink -f "$2"); out=$(readlink -m "$3")
here=$(cd "$(dirname "$0")" && pwd)
. "$here/entries.sh"
mkdir -p "$(dirname "$out")"
cd "$here"
timeout 19800 node --max-old-space-size="${DRIVER_NODE_HEAP_MB:-12288}" "$cli" build "$entry" --provenance-sources "${extra[@]}" --backend "$backend" -o "$out.bin" > "$out.txt" 2>&1
rc=$?
# zapo-core entries: which zapo-js core sources the build reached. A lowered class keeps its name in the binary (error texts and
# inspect names), so `lowered` counts the class-name strings of a successful build; `errors` counts the error lines a refused build
# names the file in. The controls: WaClient (always reached) must read above zero in lowered, and NoSuchFileZ (no package has it)
# must read zero in both.
if [ "${entry}" = zapo-core.ts ]; then
  for f in WaMessageDispatchCoordinator SenderKeyManager WaNoiseSession WaMediaTransferClient SignalIdentitySyncApi WaClient NoSuchFileZ; do
    lowered=0; [ "$rc" = 0 ] && lowered=$(strings -a "$out.bin" | grep -c "$f")
    errs=$(grep ' - error SC' "$out.txt" | grep -c "/$f.ts:")
    echo "reach $f: lowered=$lowered errors=$errs" | tee -a "$out.txt"
  done
fi
# The zapo entries are STRICT: they are the gate for real zapo, so a build that did not complete (an out-of-memory abort, a crash, a refusal) must
# fail the job instead of reading as "0 errors", and a build that completed but lowered nothing (the WaClient control at zero) fails too.
strict=0
case "${entry}" in zapo-core.ts|zapo-startup.ts) strict=1 ;; esac
wlow=0
if [ "$strict" = 1 ]; then
  [ "$rc" = 0 ] && wlow=$(strings -a "$out.bin" | grep -c "WaClient")
  echo "gate control WaClient: lowered=$wlow" | tee -a "$out.txt"
fi
echo "rc=$rc" >> "$out.txt"
# keep the binary of a successful build (uploaded as its own artifact); drop a partial one
[ "$rc" = 0 ] || rm -f "$out.bin"
echo "$driver: $(tail -1 "$out.txt") errors=$(grep -c ' - error SC' "$out.txt")"
if [ "$strict" = 1 ]; then
  [ "$rc" = 0 ] || { echo "GATE FAIL: the build of $driver exited $rc"; exit "$rc"; }
  [ "$wlow" -gt 0 ] || { echo "GATE FAIL: the build of $driver lowered no WaClient (control at zero)"; exit 3; }
fi
exit 0
