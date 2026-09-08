#!/bin/sh
# pair.sh — the paired, interleaved, ORDER-ROTATED runner for the two arms.
#
#   sh pair.sh <experiment> <reps>
#
# Experiments (each names its two arms, and every arm names its lane):
#
#   aa1 / aa2   buf vs buf — the SAME binary with the SAME knobs on both arms.
#               aa1 is the floor. aa2 is scored AGAINST that floor and must come
#               back DRAW on every metric; if it does not, the host is not as
#               quiet as it looks and no A/B taken on it means anything.
#   ab          buf vs nobuf on the DOCUMENTED workload.
#   ablive      buf vs nobuf with LIVEMSGS=1500 — the only workload in which the
#               event ring actually fills. The documented one delivers its
#               19,200 messages as a history sync, which zapo-rest pushes as
#               eight tiny events, so it never puts more than ~30 entries in a
#               ring whose cap is 1,000.
#   msgkeep     nobuf vs nobuf, ring-loaded, with ZAPO_MSG_KEEP=1000 against
#               ZAPO_MSG_KEEP=0 — the SAME BINARY. This measures the OTHER
#               bounded buffer: the typed incoming-message array the media
#               download routes read back from, which survives this change and
#               which holds the very objects the ring used to point at. If the
#               ring turns out to be a draw, this is where the message bytes
#               actually are, and being on one binary it carries no build
#               variance at all.
#
#               It is NOT possible to ask the same question of the buffered
#               binary: there, ONE knob (ZAPO_EVENT_BUFFER) caps both the ring
#               and the typed array, so ZAPO_EVENT_BUFFER=1 would move both and
#               attribute nothing. Separating the caps is part of what the
#               no-buffer arm makes measurable.
#
# WHY THE ORDER ROTATES. Pairing removes drift between repetitions; it does NOT
# remove a bias attached to POSITION within a repetition. A previous block on
# this project found exactly that — the arm that ran second won one metric 6 of
# 6 times, sign test p = 0.031 — with a paired design that looked sound. Every
# odd repetition here runs arm A first, every even one runs arm B first, and
# memstat.mjs refuses a log in which that did not happen.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh" gate

EXP="${1:?usage: pair.sh <aa1|aa2|ab|ablive|msgkeep> <reps>}"
REPS="${2:-4}"

# The workload dials, one place. The documented workload is the one every
# earlier settled figure in tests/perf/zapo-rest was taken with; it is not
# changed here, only extended by LIVEMSGS where an experiment says so.
BASE="CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 IDLE_S=60 SAMPLE_MS=250"
LIVE="LIVEMSGS=1500 LIVE_TEXTLEN=300"

case "$EXP" in
  aa1|aa2)
    A_LABEL=buf;   A_EXE="$EXE_BUF";   A_KNOBS="$BASE"
    B_LABEL=nobuf; B_EXE="$EXE_BUF";   B_KNOBS="$BASE"
    NOTE="A/A — both arms are the SAME binary ($EXE_BUF) with the same knobs" ;;
  ab)
    A_LABEL=buf;   A_EXE="$EXE_BUF";   A_KNOBS="$BASE"
    B_LABEL=nobuf; B_EXE="$EXE_NOBUF"; B_KNOBS="$BASE"
    NOTE="A/B — documented workload; the ring never fills on it, by construction" ;;
  ablive)
    A_LABEL=buf;   A_EXE="$EXE_BUF";   A_KNOBS="$BASE $LIVE"
    B_LABEL=nobuf; B_EXE="$EXE_NOBUF"; B_KNOBS="$BASE $LIVE"
    NOTE="A/B — ring-loaded workload; 1500 live messages take the ring to its cap" ;;
  msgkeep)
    A_LABEL=buf;   A_EXE="$EXE_NOBUF"; A_KNOBS="$BASE $LIVE ZAPO_MSG_KEEP=1000"
    B_LABEL=nobuf; B_EXE="$EXE_NOBUF"; B_KNOBS="$BASE $LIVE ZAPO_MSG_KEEP=0"
    NOTE="SAME BINARY (nobuf), typed message array 1000 vs 0 — the buffer this change did NOT remove" ;;
  *) echo "pair.sh: unknown experiment '$EXP'"; exit 2 ;;
esac

LOG="$LOGS/pair-$EXP.log"
: > "$LOG"
{
  echo "### PAIR $EXP  reps=$REPS"
  echo "###   note       $NOTE"
  echo "###   armA       $A_LABEL exe=$A_EXE knobs=[$A_KNOBS]"
  echo "###   armB       $B_LABEL exe=$B_EXE knobs=[$B_KNOBS]"
  echo "###   rev        $(git -C "$WT" rev-parse --short HEAD)"
  echo "###   node(rig)  $(node --version)"
  echo "###   zig        $(zig version)"
  echo "###   target     $SCRIPTC_TARGET"
  echo "###   runroot    $MEMRIG_OUT"
  echo "###   pmon       $MEMRIG_PMON"
  echo "###   fakesrv    $ZAPO_FAKE_SERVER"
  echo "###   started    $(date -Is)"
  echo "###   sizeA      $(stat -c%s "$(printf '%s' "$A_EXE" | sed -e 's|\\|/|g' -e 's|^\([A-Za-z]\):|/\L\1|')" 2>/dev/null || echo MISSING) bytes"
  echo "###   sizeB      $(stat -c%s "$(printf '%s' "$B_EXE" | sed -e 's|\\|/|g' -e 's|^\([A-Za-z]\):|/\L\1|')" 2>/dev/null || echo MISSING) bytes"
} | tee -a "$LOG"

# memrig resolves fake-server's `zapo-js/*` specifiers through the ZAPO ROOT's
# tsconfig "paths", and tsx reads that tsconfig from the LAUNCH directory —
# before a line of the rig runs. So the rig must be launched from there.
cd "${ZAPO_FAKE_SERVER_POSIX:?set ZAPO_FAKE_SERVER_POSIX to the zapo root}"

run_arm() {
  label="$1"; exe="$2"; knobs="$3"; rep="$4"; pos="$5"
  tag="$EXP-r$rep-$label"
  echo "===ARM $label REP $rep POS $pos TAG $tag exe=$exe knobs=$knobs" | tee -a "$LOG"
  set +e
  node --import tsx "$WT/tests/perf/zapo-rest/harness/memrig.mts" "$exe" "$tag" $knobs \
    > "$LOGS/run-$tag.log" 2>&1
  rc=$?
  set -e
  echo "===ARMEXIT $label REP $rep rc=$rc $(date +%H:%M:%S)" | tee -a "$LOG"
  grep -aE '\[phase\] (REFUSAL|ws-|events-|LIVE-|SETTLED|shutdown|clean-exit)' "$LOGS/run-$tag.log" \
    | sed 's/^/     /' | tee -a "$LOG" || true
}

rep=1
while [ "$rep" -le "$REPS" ]; do
  if [ $((rep % 2)) -eq 1 ]; then
    run_arm "$A_LABEL" "$A_EXE" "$A_KNOBS" "$rep" 1
    run_arm "$B_LABEL" "$B_EXE" "$B_KNOBS" "$rep" 2
  else
    run_arm "$B_LABEL" "$B_EXE" "$B_KNOBS" "$rep" 1
    run_arm "$A_LABEL" "$A_EXE" "$A_KNOBS" "$rep" 2
  fi
  rep=$((rep + 1))
done
echo "=== PAIR-DONE $EXP $(date -Is) ===" | tee -a "$LOG"
