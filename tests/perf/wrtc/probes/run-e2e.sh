#!/usr/bin/env bash
# Drive the end-to-end probe: start the relay, read the fingerprint it
# prints, hand it to the compiled scriptc binary, and check the transcript.
#
# Two cases, and the second matters as much as the first:
#   good  the answer names the relay's REAL certificate  -> channel opens
#   bad   the answer names a certificate one byte off    -> MUST NOT open
#
# A stack that connects in both cases has no authentication at all, and
# RFC 8122's fingerprint is the only identity check WebRTC has.
#
# Usage: run-e2e.sh <bin-dir> <base-port> [runs]
set -u
BIN="${1:?bin dir}"
BASE="${2:-34820}"
RUNS="${3:-1}"

pass=0
fail=0

check() {
  if [ "$2" = "1" ]; then echo "  ok   $1"; pass=$((pass + 1));
  else echo "  FAIL $1"; fail=$((fail + 1)); fi
}

for i in $(seq 1 "$RUNS"); do
  port=$((BASE + i * 2))
  echo ""
  echo "run $i, port $port"

  # ---- the good case ----
  "$BIN/wrtc_peer.exe" "$port" 25000 > "$BIN/peer-good-$i.out" 2>&1 &
  peer=$!
  for _ in $(seq 1 40); do
    [ -s "$BIN/peer-good-$i.out" ] && break
    sleep 0.1
  done
  fp=$(head -1 "$BIN/peer-good-$i.out" | awk '{print $3}')
  if [ -z "$fp" ]; then check "relay printed its fingerprint" 0; continue; fi
  "$BIN/rtc-e2e.exe" "$port" "$fp" > "$BIN/e2e-good-$i.out" 2>&1
  wait $peer 2>/dev/null

  g="$BIN/e2e-good-$i.out"
  check "offer carries a 4-character ice-ufrag" \
    "$(grep -qx 'local ufrag len=4' "$g" && echo 1 || echo 0)"
  check "gathering is complete once the local description is set" \
    "$(grep -qx 'answer applied, gathering=complete' "$g" && echo 1 || echo 0)"
  check "iceConnectionState reaches connected" \
    "$(grep -qx 'ice=connected' "$g" && echo 1 || echo 0)"
  check "connectionState reaches connected" \
    "$(grep -qx 'conn=connected' "$g" && echo 1 || echo 0)"
  check "the data channel reaches readyState=open" \
    "$(grep -qx 'channel open, readyState=open' "$g" && echo 1 || echo 0)"
  check "send() actually sent" \
    "$(grep -q 'PEER-REPLIED' "$BIN/peer-good-$i.out" && echo 1 || echo 0)"
  check "onmessage fired from the loop with the relay's reply" \
    "$(grep -qx 'message len=10 body=relay-pong' "$g" && echo 1 || echo 0)"
  check "the close cascade ran" \
    "$(grep -qx 'closed, ice=closed signaling=closed' "$g" && echo 1 || echo 0)"

  # ---- the bad case: one byte of the fingerprint flipped ----
  bport=$((port + 1))
  "$BIN/wrtc_peer.exe" "$bport" 8000 > "$BIN/peer-bad-$i.out" 2>&1 &
  peer=$!
  for _ in $(seq 1 40); do
    [ -s "$BIN/peer-bad-$i.out" ] && break
    sleep 0.1
  done
  fp=$(head -1 "$BIN/peer-bad-$i.out" | awk '{print $3}')
  # Replace the first hex pair with one that cannot be its value.
  head=${fp%%:*}
  if [ "$head" = "AA" ]; then bad="BB:${fp#*:}"; else bad="AA:${fp#*:}"; fi
  "$BIN/rtc-e2e.exe" "$bport" "$bad" > "$BIN/e2e-bad-$i.out" 2>&1
  wait $peer 2>/dev/null

  b="$BIN/e2e-bad-$i.out"
  check "a wrong fingerprint NEVER opens the channel" \
    "$(grep -q 'channel open' "$b" && echo 0 || echo 1)"
  check "a wrong fingerprint delivers no message" \
    "$(grep -q 'message len=' "$b" && echo 0 || echo 1)"
  check "and it is reported as a failure, not left hanging" \
    "$(grep -qx 'ice=failed' "$b" && echo 1 || echo 0)"
done

echo ""
echo "$((pass + fail)) checks, $fail failures"
[ "$fail" = "0" ] && echo "RESULT: PASS" || echo "RESULT: FAIL"
exit "$fail"
