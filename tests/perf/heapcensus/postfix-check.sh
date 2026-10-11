#!/bin/sh
# postfix-check.sh - score ONE census against the prediction registered in
# PLAN-POSTFIX-CENSUS.md, before the run that produces it exists.
#
#   sh tests/perf/heapcensus/postfix-check.sh <tag>.heapcen.txt <tag>.prof.txt
#
# Exit 0 only when every assertion passes. THE SELF-TEST IS THE POINT: run it
# against a committed BASELINE arm, where it must report FAIL on P1 and on P2.
# A checker that cannot fail on the baseline cannot pass on the treatment -
# this corpus has published a zero from a dead detector more than once.
#
#   sh tests/perf/heapcensus/postfix-check.sh \
#      tests/perf/heapcensus/evidence-idle/on.heapcen.txt \
#      tests/perf/heapcensus/evidence-idle/on.prof.txt
#   -> must print FAIL for P1/P2 and exit 1.
#
# Every constant below is re-read from a committed file; the provenance is in
# the comment beside it, file:line.
#
# ---------------------------------------------------------------------------
# REVISION 2026-10-11 -- three defects this file's OWN first run exposed, and
# POSTFIX-CENSUS.md section 7 wrote down as debts. All three are repaired here
# and each repair FAILS LOUD where the original went quiet.
#
#   (1) SILENT SKIP.  P5d and P7 were guarded on `fc >= 0`, and `fc` is -1
#       when scr_string.c:822 has no PROF row. The first real run had no such
#       row, so P7 -- which the plan calls "the single most dangerous failure
#       in this design" -- was NEVER EVALUATED while the footer printed
#       "---- 2 failed". Fixed two ways: an absent free row now means
#       freed = 0 BY THE EMITTER'S OWN RULE (scr_prof.h:771 skips a row only
#       when count == 0 AND freed == 0, so "no row" is "no frees" and nothing
#       else), and a DECLARED/SCORED counter makes any unscored assertion a
#       failure in its own right. "Did not apply" is never "not scored".
#
#   (2) A HARDCODED BASELINE INSIDE A JOIN.  P5d compared the string arena's
#       live count against `n65 - BASE65536`, where BASE65536=118 is a
#       measurement OF ANOTHER RUN. The cycle arena moved by one block
#       between the baseline and the first post-fix run, so the join would
#       have reported disagreement between two lanes that agreed exactly.
#       The join now measures BOTH owners inside the run under test, from
#       that run's own PROF rows, and asserts the residual.
#
#   (3) A WINDOW THAT WAS A GUESS.  P2b allowed "up to six" extra granules
#       with no derivation; the run carried ten and the assertion failed
#       while the thing it existed to assert held exactly. The bound is now
#       DERIVED from the census's own accumulation rule and the granule model
#       (OWNER-131079.md:300): every block contributes size + overhead, the
#       overhead of a 65,536-byte request is 65,552 - 65,536 = 16, and a
#       block carrying one extra 16-byte granule contributes 32. So the row
#       is bounded BELOW by n x 65,552 and ABOVE by n x 65,568, and the
#       surplus must be a whole number of 16-byte granules. That is a bound,
#       not a tolerance, and it is reported as a per-block rate.
# ---------------------------------------------------------------------------
set -u

HC=${1:?usage: postfix-check.sh <heapcen.txt> <prof.txt>}
PR=${2:?usage: postfix-check.sh <heapcen.txt> <prof.txt>}

# --- the constants, each with its source -----------------------------------
# evidence-idle/{off,on,long}.heapcen.txt:{269,266,268} all read "HCSIZE 65536
# 118": the cycle-collector arena, invariant across the SQLite idle knob.
# USED ONLY as the registered prediction's addend in P2a. It is NOT used in
# any join any more - see defect (2) above.
BASE65536=118
# evidence-idle/{off,on,long}.heapcen.txt:{223,221,223} all read 46 blocks at
# 131079. half-on (CONVS=200) reads 33 - the count is load-dependent, so this
# constant is valid ONLY at CONVS=400.
EXPCHUNKS=46
EXP65536=$((BASE65536 + EXPCHUNKS))                       # 164
# OWNER-131079.md:300 - granule = round16(request + 8). For a 65,536-byte
# request that is 65,552, so the minimum per-block overhead is 16 and a block
# carrying ONE extra granule contributes 32. scr_heap_census.h accumulates
# `bytes += size + overhead`, so the row is bounded in BOTH directions.
GRAN65536=65552                                           # round16(65536 + 8)
GRANSTEP=16
# the row that dies
OLDROWBYTES=6030160            # evidence-idle/on.heapcen.txt:221
# the prof sites on strarena/drop-64k-alignment (41ce4373c)
ALLOCSITE='scr_string[.]c:820$'
FREESITE='scr_string[.]c:822$'
# the cycle-collector arena's OWN sites, so the 65,536 row can be split by
# owner INSIDE the run under test. DECOMP-ON.md section 1 prescribes exactly
# this subtraction; its positive control is that evidence-idle/on.prof.txt
# solves to the committed "114 of the 118 blocks".
CYCALLOC='scr_cycle[.]c:1546$'
CYCFREE='scr_cycle[.]c:1589$'
# the 65,536 class's remaining occupants, measured on the baseline as
# 118 - 114 (POSTFIX-CENSUS.md section 3). This residual is what the
# three-way join asserts, and it is the only cross-run constant left in a
# join anywhere in this file.
OTHER65536=4

# --- scoring: every declared assertion must EXECUTE -------------------------
# DECLARED is the number of ok/bad/miss calls a complete run must make. If
# fewer execute, the run FAILED even if no line said FAIL. The roster is
# N1 N2 N3a N3b N4 P1 P2a P2b P5a P5b P5c P5d P7 = 13; every one of them
# is reached on EVERY path, which is the property this counter enforces.
# (It earned its keep immediately: the first draft of this revision
# declared 16 by miscounting, and the counter said so instead of passing.)
DECLARED=13
scored=0
fails=0
ok()   { scored=$((scored + 1)); echo "PASS $1  $2"; }
bad()  { scored=$((scored + 1)); echo "FAIL $1  $2"; fails=$((fails + 1)); }
# MISS is a FAILURE WITH A DIFFERENT CAUSE: the input could not supply what
# the assertion needs. It is never silence.
miss() { scored=$((scored + 1)); echo "MISS $1  NOT EVALUABLE: $2"; fails=$((fails + 1)); }

for f in "$HC" "$PR"; do
  [ -s "$f" ] || { echo "DEAD  $f is missing or empty - that is a dead instrument, not a zero result"; exit 2; }
done

# --- N: is the instrument alive? -------------------------------------------
# N1  scr_heap_census.h:278 writes this as the first line of every report.
if head -1 "$HC" | grep -q '^\[heapcen\] ARMED '; then
  ok N1 "census armed (the -include reached the link)"
else
  bad N1 "no ARMED banner on line 1 - the header never got -included"
fi
# N2  the census's own arm. WHICH-BUFFER.md:"137 blocks of 5,113 B = 703,632".
if grep -q '^HCSIZE 5113 ' "$HC"; then
  ok N2 "the census allocated its own arm (HCSIZE 5113 present)"
else
  bad N2 "no HCSIZE 5113 row - the walk produced no table of its own"
fi
# N3  a truncated result is not an empty result. COUNT, and check the tail is
#     a whole record.
rows=$(grep -c '^HCSIZE ' "$HC")
if [ "$rows" -ge 200 ]; then ok N3a "HCSIZE rows=$rows (on reads 247)"
else bad N3a "HCSIZE rows=$rows - truncated, not empty"; fi
if tail -1 "$HC" | grep -Eq '^(HCSIZE|HCFREE|HCPAGE|\[heapcen\])'; then
  ok N3b "last line is a complete record"
else
  bad N3b "last line is a fragment - the file was cut mid-write"
fi
# N4  PROF-TOTAL is the prof report's own terminator; absent means _Exit ran
#     without the prof half of the chain (scr_heap_census.h:478-480).
if grep -q '^PROF-TOTAL ' "$PR"; then
  ok N4 "prof report terminated (the _Exit chain carried both halves)"
else
  bad N4 "no PROF-TOTAL - the prof half of the _Exit chain did not fire"
fi

# --- P: the prediction ------------------------------------------------------
n131=$(awk '$1=="HCSIZE" && $2==131079 {print $3; found=1} END{if(!found) print 0}' "$HC")
if [ "$n131" -eq 0 ]; then
  ok P1 "HCSIZE 131079 is gone (was $EXPCHUNKS blocks / $OLDROWBYTES B)"
else
  bad P1 "HCSIZE 131079 still reads $n131 blocks - the padding is still paid"
fi

set -- $(awk '$1=="HCSIZE" && $2==65536 {print $3, $4; found=1} END{if(!found) print 0, 0}' "$HC")
n65=$1; b65=$2
if [ "$n65" -eq "$EXP65536" ]; then
  ok P2a "HCSIZE 65536 reads $n65 blocks (= $BASE65536 cycle + $EXPCHUNKS string)"
else
  bad P2a "HCSIZE 65536 reads $n65 blocks, predicted $EXP65536"
fi

# P2b  THE BOUND, DERIVED. Floor n x 65,552, ceiling n x 65,568, and the
#      surplus a whole number of granules. Reported as a rate so a reader can
#      compare it to the committed arms (on 1/118, long 2/118, off 4/118, and
#      the old 131,079 row 7/46) instead of to a number somebody picked.
if [ "$n65" -le 0 ]; then
  miss P2b "HCSIZE 65536 is absent, so there is no row to bound"
else
  FLOOR=$((n65 * GRAN65536))
  CEIL=$((n65 * (GRAN65536 + GRANSTEP)))
  SURPLUS=$((b65 - FLOOR))
  if [ "$SURPLUS" -ge 0 ] && [ "$b65" -le "$CEIL" ] && [ $((SURPLUS % GRANSTEP)) -eq 0 ]; then
    ok P2b "HCSIZE 65536 bytes=$b65 = $n65 x $GRAN65536 + $((SURPLUS / GRANSTEP)) extra granules of $GRANSTEP (floor $FLOOR, ceiling $CEIL)"
  else
    bad P2b "HCSIZE 65536 bytes=$b65 breaks the granule model: floor=$FLOOR ceiling=$CEIL surplus=$SURPLUS must be >=0, <=$((CEIL - FLOOR)), and a multiple of $GRANSTEP"
  fi
fi

# P5  the second instrument. The fix moves this site INTO the prof lane for the
#     first time: scr_prof.h:1060 interposes malloc, and _aligned_malloc was
#     never one of the four names it covers (OWNER-131079.md section 2).
set -- $(awk -v s="$ALLOCSITE" '$1=="PROF" && $0 ~ s {print $2, $3; found=1} END{if(!found) print -1, -1}' "$PR")
ac=$1; ab=$2
if [ "$ac" -lt 0 ]; then
  bad P5a "no PROF row at scr_string.c:820 - the fix is NOT in this binary, or the prof -include missed scr_string.c"
else
  ok P5a "PROF row at scr_string.c:820 exists: count=$ac bytes=$ab"
fi
if [ "$ac" -lt 0 ]; then
  miss P5b "no alloc row, so there is no per-request size to check"
elif [ "$ab" -eq $((ac * 65536)) ]; then
  ok P5b "every chunk request is exactly 65536 ($ac x 65536 = $ab)"
else
  bad P5b "bytes=$ab != count*65536=$((ac * 65536)) - a chunk was requested at another size"
fi

# P5c  AN ABSENT ROW IS ZERO FREES, AND THAT IS THE EMITTER'S RULE, NOT AN
#      INFERENCE. scr_prof.h:771 reads
#        if (r->key == NULL || (r->count == 0 && r->freed == 0)) continue;
#      so a site never called has no row and a site called has one. The
#      previous revision read an absent row as "the free side is not
#      interposed", which is a claim about the BINARY that these two text
#      files cannot support in either direction; the first real run's absent
#      row was zero calls, with the interposition proved by the preprocessed
#      TU and by the site string in .rdata (POSTFIX-CENSUS.md section 4).
#      What IS checkable here is the arithmetic, so that is what is asserted.
fc=$(awk -v s="$FREESITE" '$1=="PROF" && $0 ~ s {print $4; found=1} END{if(!found) print 0}' "$PR")
if [ "$ac" -lt 0 ]; then
  miss P5c "no alloc row, so frees cannot be compared against allocations"
elif [ "$fc" -ge 0 ] && [ "$fc" -le "$ac" ]; then
  ok P5c "scr_string.c:822 freed=$fc of $ac allocated (no row = 0 frees, by scr_prof.h:771)"
else
  bad P5c "scr_string.c:822 freed=$fc against $ac allocated - more frees than allocations is impossible"
fi

# P5d  FLUX MINUS FLUX IS RETENTION, and it must equal what the census holds.
#      THE JOIN IS NOW MEASURED ON BOTH SIDES. Each owner of the 65,536 class
#      is counted from ITS OWN PROF sites in THIS run; the only cross-run
#      constant left is the residual, OTHER65536.
cyca=$(awk -v s="$CYCALLOC" '$1=="PROF" && $0 ~ s {print $2; found=1} END{if(!found) print -1}' "$PR")
cycf=$(awk -v s="$CYCFREE"  '$1=="PROF" && $0 ~ s {print $4; found=1} END{if(!found) print 0}' "$PR")
live=-1
if [ "$ac" -lt 0 ] || [ "$cyca" -lt 0 ]; then
  miss P5d "the 65,536 row cannot be split by owner: string alloc row ac=$ac, cycle alloc row cyca=$cyca (-1 means absent)"
else
  live=$((ac - fc))
  cyclive=$((cyca - cycf))
  other=$((n65 - cyclive - live))
  if [ "$other" -eq "$OTHER65536" ]; then
    ok P5d "65,536 row splits $cyclive cycle + $live string + $other other = $n65 - the two PROF lanes and the census agree"
  else
    bad P5d "65,536 row splits $cyclive cycle + $live string + $other other = $n65; the residual should be $OTHER65536"
  fi
fi

# P7  THE FALSE PASS THIS DESIGN MUST SURVIVE. With SCR_STRING_ARENA cleared
#     the arena is OFF, no chunk exists, and P1 passes for the wrong reason.
#     The committed floor is 33 (half-on at CONVS=200). THIS IS THE ASSERTION
#     THE PREVIOUS REVISION SILENTLY SKIPPED.
if [ "$live" -lt 0 ]; then
  miss P7 "no live-chunk count, so the arena-disabled false pass is UNGUARDED - treat P1 as unproven"
elif [ "$live" -ge 33 ]; then
  ok P7 "the arena ran ($live chunks live; the floor is half-on's 33)"
else
  bad P7 "only $live chunks live - the arena may have been DISABLED, which fakes P1"
fi

# --- the realized saving, computed from this run and nothing else ----------
# THE BLOCK DELTA IS EXACTLY 64 KiB PER CHUNK, and the overhead model cancels:
# granule = round16(request + 8) -- OWNER-131079.md:300 -- so a 131,079 request
# occupies round16(131,087) = 131,088 and a 65,536 request occupies
# round16(65,544) = 65,552. The difference is 65,536 to the byte, with no term
# left over from either overhead. THE CHUNK COUNT IS THIS RUN'S MEASURED LIVE
# COUNT, not the row total minus a constant from another run.
if [ "$n131" -eq 0 ] && [ "$live" -gt 0 ]; then
  awk -v c="$live" 'BEGIN{
    s = c * 65536;
    printf "SAVED %d B over %d live chunks (%.3f MiB), residue band +-%d B\n", s, c, s/1048576, c*16;
    printf "NOTE  OWNER-131079.md:217 prints 3,014,768 for c=46, a carved estimate.\n";
    printf "NOTE  The band is the per-chunk extra granule, unattributable after\n";
    printf "NOTE  the merge into a row shared with the cycle-collector arena.\n";
  }'
fi

echo "---- $fails failed, $scored of $DECLARED assertions scored"
if [ "$scored" -ne "$DECLARED" ]; then
  echo "BROKEN  the checker declared $DECLARED assertions and executed $scored."
  echo "BROKEN  An assertion that can vanish without a line of output cannot"
  echo "BROKEN  certify anything. This is a failure of the CHECKER, and it is"
  echo "BROKEN  not a verdict on the run."
  exit 3
fi
[ "$fails" -eq 0 ]
