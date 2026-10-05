#!/bin/sh
# Coverage of the D1 slice in a REAL emitted binary, counted from the C.
#
# Calibrated on a probe whose answer was known by hand (1 of 5 async functions
# converted, 4 left on fibers) and carrying that case's invariant as a guard:
#   converted + still-fiber == total async functions
# A count that breaks it is miscounting, not reporting a finding.
#
#   sc_as_X  the spawn wrapper -- one per async function, emitted either way
#   sc_tr_X  the fiber trampoline -- present only if X stayed a fiber
#   sc_cr_X  the coroutine resume -- present only if X became a state machine
set -u
dir="$1"; label="$2"
TMPD=$(mktemp -d)
trap 'rm -rf "$TMPD"' EXIT
c=$(ls "$dir"/*.c 2>/dev/null | head -1)
[ -n "$c" ] || { echo "$label: no emitted C found in $dir" >&2; exit 2; }
# a split program emits part2.c, part3.c ... count across all of them
set -- "$dir"/*.c
# Every suspendable function gets EXACTLY ONE lowering: a fiber trampoline
# (sc_tr_) or a coroutine resume (sc_cr_). emit-coro.ts says so in as many
# words -- "a function appearing in neither or both would emit a duplicate
# symbol or none at all" -- so the real invariant is that the two sets are
# DISJOINT, and the total is their union.
#
# sc_as_ (the spawn wrapper) is a cross-check, not the denominator: async
# GENERATORS have a trampoline but no spawn wrapper, because they are built
# through scr_agen_new instead of scr_async_spawn. A first version of this
# used sc_as_ as the total and its guard fired at 1489 vs 1487 -- the two
# async generators this program has, which an independent IR census had
# already counted as exactly two.
rg -o 'sc_tr_[A-Za-z0-9_]+' "$@" 2>/dev/null | sed 's/.*://' | sort -u > "$TMPD/tr"
rg -o 'sc_cr_[A-Za-z0-9_]+' "$@" 2>/dev/null | sed 's/.*://' | sort -u > "$TMPD/cr"
rg -o 'sc_as_[A-Za-z0-9_]+' "$@" 2>/dev/null | sed 's/.*://' | sort -u > "$TMPD/as"
fib=$(wc -l < "$TMPD/tr"); cor=$(wc -l < "$TMPD/cr"); spawn=$(wc -l < "$TMPD/as")
sed 's/^sc_cr_/X_/' "$TMPD/cr" | sort > "$TMPD/crn"
sed 's/^sc_tr_/X_/' "$TMPD/tr" | sort > "$TMPD/trn"
both=$(comm -12 "$TMPD/crn" "$TMPD/trn" | wc -l)
tot=$((fib + cor))
parks=$(rg -o 'scr_coro_park\(' "$@" 2>/dev/null | wc -l)
awaits=$(rg -o 'scr_await_(f64|bool|str|ref|void|dyn)\(' "$@" 2>/dev/null | wc -l)
frames=$(rg -o 'ScrCoroBase base;' "$@" 2>/dev/null | wc -l)
bytes=$(cat "$@" | wc -c)
echo "== $label"
echo "   suspendable functions         : $tot   (spawn wrappers $spawn + async generators)"
echo "   became state machines (sc_cr_): $cor"
echo "   still fibers (sc_tr_)         : $fib"
echo "   frame structs emitted         : $frames"
echo "   suspensions on frames (park)  : $parks"
echo "   suspensions on fibers (await) : $awaits"
if [ "$tot" -gt 0 ]; then
  echo "   FUNCTION coverage             : $(awk -v a=$cor -v b=$tot 'BEGIN{printf "%.1f%%", 100*a/b}')"
fi
if [ $((parks + awaits)) -gt 0 ]; then
  echo "   SUSPENSION-POINT coverage     : $(awk -v a=$parks -v b=$((parks+awaits)) 'BEGIN{printf "%.1f%%", 100*a/b}')"
fi
echo "   emitted C bytes               : $bytes"
if [ "$both" -ne 0 ]; then
  echo "   GUARD FAILED: $both function(s) have BOTH a trampoline and a resume --" >&2
  echo "                 duplicate lowering, so these counts mean nothing" >&2
  exit 1
fi
