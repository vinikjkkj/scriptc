#!/bin/sh
# ir-readout.sh — the two IR censuses, in the order that makes them believable.
#
#   sh tests/perf/boxanat/ir-readout.sh <outdir>
#
# where <outdir> holds a `--emit-ir` build's `<stem>.ir.json` and `<stem>.scrh`.
#
# THE ORDER IS THE POINT, and it is `set -e` rather than a note in a report.
#
#   1. RECONCILE FIRST. The IR says how many record fields are union-typed;
#      the emitted C says the same thing independently, as `ScrUnion *` slots
#      in the record structs. If the two disagree, one reader is wrong and
#      NEITHER number may be quoted. unioncensus exits non-zero on a
#      mismatch, and this script stops there.
#   2. Only then the union census, which prices the collapsible subset.
#   3. Then the narrowing census.
#
# It reads the `.scrh`, not the part TUs and not a concatenation: a split
# build puts every record struct in the shared header, and all of zapo's
# 7,666 ScrUnion * slots are there. Pointing this at a part TU is refused by
# name rather than reported as a 7,666-wide disagreement.
set -e
dir=${1:?usage: ir-readout.sh <outdir-of-an---emit-ir-build>}
here=$(dirname "$0")

ir=$(ls "$dir"/*.ir.json 2>/dev/null | head -1)
scrh=$(ls "$dir"/*.scrh 2>/dev/null | head -1)
[ -n "$ir" ]   || { echo "no *.ir.json in $dir — was the build run with --emit-ir?" >&2; exit 2; }
[ -n "$scrh" ] || { echo "no *.scrh in $dir — a single-TU build has no shared header; pass its .c" >&2; exit 2; }

echo "IR   $ir  ($(wc -c < "$ir") bytes)"
echo "C    $scrh ($(wc -c < "$scrh") bytes)"
echo

echo "=== 1. reconcile, then the union census ============================="
node "$here/unioncensus.mjs" "$ir" --reconcile "$scrh" --list --top 30

echo
echo "=== 2. the narrowing census ========================================="
node "$here/narrowcensus.mjs" "$ir" --list --top 30
