#!/bin/sh
# e2e.sh — block/wrtcscope.
#
# The smallest END-TO-END slice of the vendored data-channel stack, rebuilt
# and re-run on the CURRENT main rather than quoted from the block that first
# landed it (tests/perf/wrtc/JOIN-STATUS.md, stage 4, main acdd8b96).
#
# It builds two things and makes them talk over a real UDP socket:
#   * wrtc_peer.exe   -- a standalone relay in C: DTLS 1.2 server + the
#                        hand-written scripted SCTP peer. NOT a WebRTC
#                        endpoint: no STUN, no ICE, and it is code in this
#                        repository, so a wire-format bug could in principle
#                        agree with itself. Named, not hidden.
#   * rtc-e2e.exe     -- a COMPILED SCRIPTC BINARY from TypeScript, strict,
#                        no --best-effort. This is the half that matters:
#                        every state change after "answer applied" arrives
#                        through the event loop, not through the harness.
#
# The negative control is half the probe. The same binary against the same
# relay with ONE BYTE of the answer's fingerprint changed MUST fail to open
# the channel. A stack that connects in both cases has no authentication at
# all -- RFC 8122's fingerprint is the only identity check WebRTC has.
#
# Usage: . tests/perf/wrtcscope/harness/env.sh
#        sh tests/perf/wrtcscope/harness/e2e.sh [runs]

set -u
WT="${WRTCSCOPE_WT:?source tests/perf/wrtcscope/harness/env.sh first}"
LAB="${WRTCSCOPE_LAB:-${BLOCKS_ROOT:-<blocks>}/wrtcscope/lab}"
BIN="$LAB/e2e"
RUNS="${1:-1}"
PROBES="$WT/tests/perf/wrtc/probes"
RT="$WT/packages/runtime/src"
# The .cache dir holds ONLY the archive; the headers live in the pinned vendor
# snapshot (cc.ts:1304 resolves them the same way). Two different paths, and
# -I at the wrong one fails as "file not found", which reads like a missing
# vendor tree rather than a wrong flag.
MBEDLIB="$WT/packages/runtime/vendor/.cache/mbedtls-3.6.7-plain-x86_64-windows-gnu"
MBEDINC="$WT/packages/runtime/vendor/mbedtls/include"

node "$WT/tests/perf/wrtcscope/harness/guard.mjs" || exit 2
mkdir -p "$BIN"

echo "== e2e   main $(cd "$WT" && git rev-parse --short HEAD)   node $(node -v)   zig $(zig version)"

# ---- the relay ---------------------------------------------------------------
echo "-- building wrtc_peer.exe"
zig cc -target x86_64-windows-gnu -std=c11 -O1 -Wall -Wextra \
  -I"$RT" -I"$MBEDINC" \
  "$PROBES/wrtc_peer.c" \
  "$RT/scr_wrtc_fp.c" "$RT/scr_wrtc_cert.c" "$RT/scr_sctp.c" "$RT/scr_sctp_assoc.c" \
  "$MBEDLIB/libmbedtls.a" -lbcrypt -lcrypt32 -lws2_32 -ladvapi32 \
  -o "$BIN/wrtc_peer.exe" 2>"$BIN/peer-build.err"
prc=$?
# Grep the WHOLE buffer, never the tail: a truncated stderr can end at
# "N warnings generated." with the error line scrolled off, and that reads
# like contention when it is a real compile error.
echo "   rc=$prc  errors=$(grep -c 'error:' "$BIN/peer-build.err")  warnings=$(grep -c 'warning:' "$BIN/peer-build.err")"
[ $prc -ne 0 ] && { echo "PEER BUILD FAILED"; grep 'error:' "$BIN/peer-build.err" | head -20; exit 1; }

# ---- the compiled client -----------------------------------------------------
echo "-- building rtc-e2e.exe from TypeScript (strict, no --best-effort)"
cp "$PROBES/rtc-e2e.ts" "$LAB/noPkg/src/rtc-e2e.ts"
( cd "$LAB/noPkg" && node "$WT/packages/cli/dist/main.js" build src/rtc-e2e.ts \
    -o "$BIN/rtc-e2e.exe" --keep-c ) >"$BIN/client-build.out" 2>&1
crc=$?
echo "   rc=$crc  size=$(stat -c %s "$BIN/rtc-e2e.exe" 2>/dev/null || echo n/a) B"
echo "   backend: $(grep -oE 'backend [a-z]+ \(llvm refused: [^)]*\)|backend [a-z]+' "$BIN/client-build.out" | head -1)"
echo "   tier by artifact: .ll=$(ls "$BIN"/*.ll 2>/dev/null | wc -l | tr -d ' ') .c=$(ls "$BIN"/*.c 2>/dev/null | wc -l | tr -d ' ')"
if [ $crc -ne 0 ]; then
  echo "CLIENT BUILD FAILED"
  tr -d '\r' <"$BIN/client-build.out" | grep -oE 'SC[0-9]{4}.*' | grep -vE '^SC900[234]' | head -20
  exit 1
fi
echo "   engine scan: quickjs=$(strings -a "$BIN/rtc-e2e.exe" | grep -c quickjs)" \
     "ScrDyn=$(strings -a "$BIN/rtc-e2e.exe" | grep -c ScrDyn)" \
     "JS_NewRuntime=$(strings -a "$BIN/rtc-e2e.exe" | grep -c JS_NewRuntime)" \
     "control(ice-ufrag)=$(strings -a "$BIN/rtc-e2e.exe" | grep -c 'ice-ufrag')"

echo
sh "$PROBES/run-e2e.sh" "$BIN" "${E2E_BASE_PORT:-34820}" "$RUNS"
