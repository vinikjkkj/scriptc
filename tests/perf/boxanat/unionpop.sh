#!/bin/sh
# unionpop.sh — how many union-typed fields are actually POPULATED at peak.
#
#   REPO_ROOT=<repo> OUT_DIR=<dir> ZAPO_FAKE_SERVER=<...>/packages/fake-server \
#     sh tests/perf/boxanat/unionpop.sh [tag]
#
# WHY. tests/perf/boxanat counts 2,425 COLLAPSIBLE union-typed record fields —
# two arms, one unit, one pointer, the shape a nullable pointer could carry
# with no allocation. That is a CAP, not a saving: 64 B is charged per
# POPULATED field per INSTANCE, and a field holding its unit arm costs nothing
# (an immortal static singleton). How often a hot instance leaves a nullable
# field null is a run-time fact and no artifact can answer it.
#
# THE INSTRUMENT, and the one it replaced. `scr_live_unions` under
# SCR_RC_AUDIT looks right and is not: scr_console.c reads it AT EXIT, prints
# only when some count is non-zero, and _Exit(99)s. On an RC-clean program it
# reads 0 — no population, no information. A check that can only say "you
# leaked" cannot answer "how many are live at peak".
#
# tests/perf/cycensus can. It keys every scr_cyc_alloc on the ScrCycFreeFn it
# is handed, which identifies the kind EXACTLY, and a ScrUnion's free function
# is scr_union_gcfree. Its `snap` columns are each kind's live count at the
# census's own HIGH-WATER MARK (`live` is at exit), and it separates `live`
# from `pool` where a malloc-level lane cannot.
#
# And it needs NO SCR_RC_AUDIT — so scr_cyc_arena_on() stays 1 and the run
# places blocks the way a shipping binary does. That matters more than it
# looks: ScrUnion nodes live in that arena, so measuring them with it disabled
# would measure the wrong thing twice over.
#
# THE ARMS, named because two are in play and they are not the same:
#   binary       app182 = zapo-js 1.8.2, the arm the 2,425 cap was counted on,
#                so cap and population agree.
#   fake server  whatever ZAPO_FAKE_SERVER points at. The shared fixture is
#                1.6.2; driving an app182 binary from it is established
#                practice (harness/census-arms.sh does exactly that).
#   sync         UNSERIALISED, as zapo ships. PLAN-RETENTION.md's serialised
#                arm measures 76.17 MiB settled against 146.87 — forbidden to
#                us, and it does part of our job for us, so a population taken
#                there would overstate what our end is worth.
#
# NO PHONE AND NO QR GATE: memrig.mts drives pairing and a history sync with
# no phone and samples kernel-side. This is machine time, nothing else.
set -e
: "${REPO_ROOT:?set REPO_ROOT to the scriptc worktree}"
: "${OUT_DIR:?set OUT_DIR to the directory holding the cycensus-instrumented binary}"
: "${ZAPO_FAKE_SERVER:?set it to the zapo checkout's packages/fake-server}"
TAG=${1:-unionpop}
EXE="$OUT_DIR/zapo-rest.exe"
H="$REPO_ROOT/tests/perf/zapo-rest/harness"

[ -f "$EXE" ] || { echo "unionpop: no binary at $EXE — build it with" >&2
  echo "  SCRIPTC_PROF_CFLAGS=\"-include $REPO_ROOT/tests/perf/cycensus/scr_cyc_census.h -I$REPO_ROOT/tests/perf/cycensus -DSCR_CYCEN_ARM=64\"" >&2
  exit 2; }
[ -d "$ZAPO_FAKE_SERVER" ] || { echo "unionpop: no fake-server at $ZAPO_FAKE_SERVER" >&2; exit 2; }

export MEMRIG_OUT="${MEMRIG_OUT:-$OUT_DIR/memrig-run}"
export MEMRIG_PMON="${MEMRIG_PMON:-$H/pmon.exe}"
# The sampler is one C file. Build it rather than refuse over it.
[ -f "$MEMRIG_PMON" ] || zig cc -O2 -o "$MEMRIG_PMON" "$H/pmon.c" -lpsapi

# THE LAUNCH DIRECTORY IS PART OF THE PROTOCOL. fake-server imports zapo-js/*
# through tsconfig "paths" at the ZAPO ROOT, and tsx reads the tsconfig from
# the launch cwd at --import registration time. memrig refuses from anywhere
# else rather than produce a number it could not have measured.
ZAPO_ROOT=$(cd "$ZAPO_FAKE_SERVER/../.." && pwd)
echo "binary      $EXE"
echo "fake-server $ZAPO_FAKE_SERVER"
echo "launch cwd  $ZAPO_ROOT"
echo "census out  $MEMRIG_OUT/$TAG.cyc.txt"

# SCR_CYCEN_OUT rides as a KEY=VAL argument: memrig passes anything it does not
# recognise straight to the CHILD, which is the process that must write it.
( cd "$ZAPO_ROOT" && node --import tsx "$H/memrig.mts" \
    "$EXE" "$TAG" CHUNKS=8 CONVS=400 MSGS=6 \
    "SCR_CYCEN_OUT=$MEMRIG_OUT/$TAG.cyc.txt" )

echo
echo "read it with:  node $REPO_ROOT/tests/perf/cycensus/cycensus.mjs $MEMRIG_OUT/$TAG.cyc.txt"
echo "the row to take is scr_union_gcfree; its snap liveN is the POPULATED count."
