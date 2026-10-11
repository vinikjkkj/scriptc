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
set -u

HC=${1:?usage: postfix-check.sh <heapcen.txt> <prof.txt>}
PR=${2:?usage: postfix-check.sh <heapcen.txt> <prof.txt>}

# --- the constants, each with its source -----------------------------------
# evidence-idle/{off,on,long}.heapcen.txt:{269,266,268} all read "HCSIZE 65536
# 118": the cycle-collector arena, invariant across the SQLite idle knob.
BASE65536=118
# evidence-idle/{off,on,long}.heapcen.txt:{223,221,223} all read 46 blocks at
# 131079. half-on (CONVS=200) reads 33 - the count is load-dependent, so this
# constant is valid ONLY at CONVS=400.
EXPCHUNKS=46
EXP65536=$((BASE65536 + EXPCHUNKS))                       # 164
# OWNER-131079.md:247 - granule = round16(request + 8); for 65536 that is
# 65552, so overhead = 16/block. A few blocks carry one extra 16-byte granule
# (off +64, on +16, long +32 over 118 blocks); the window allows six.
MIN65536B=$((EXP65536 * 65536 + EXP65536 * 16))           # 10750528
MAX65536B=$((MIN65536B + 96))                             # 10750624
# the row that dies
OLDROWBYTES=6030160            # evidence-idle/on.heapcen.txt:221
# the prof sites on strarena/drop-64k-alignment (41ce4373c)
ALLOCSITE='scr_string[.]c:820$'
FREESITE='scr_string[.]c:822$'

fails=0
ok()   { echo "PASS $1  $2"; }
bad()  { echo "FAIL $1  $2"; fails=$((fails + 1)); }

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
if [ "$b65" -ge "$MIN65536B" ] && [ "$b65" -le "$MAX65536B" ]; then
  ok P2b "HCSIZE 65536 bytes=$b65 in [$MIN65536B,$MAX65536B]"
else
  bad P2b "HCSIZE 65536 bytes=$b65 outside [$MIN65536B,$MAX65536B]"
fi

# P5  the second instrument. The fix moves this site INTO the prof lane for the
#     first time: scr_prof.h:1060 interposes malloc, and _aligned_malloc was
#     never one of the four names it covers (OWNER-131079.md section 2).
set -- $(awk -v s="$ALLOCSITE" '$1=="PROF" && $0 ~ s {print $2, $3, $4; found=1} END{if(!found) print -1, -1, -1}' "$PR")
ac=$1; ab=$2
if [ "$ac" -lt 0 ]; then
  bad P5a "no PROF row at scr_string.c:820 - the fix is NOT in this binary, or the prof -include missed scr_string.c"
else
  ok P5a "PROF row at scr_string.c:820 exists: count=$ac bytes=$ab"
  if [ "$ab" -eq $((ac * 65536)) ]; then
    ok P5b "every chunk request is exactly 65536 ($ac x 65536 = $ab)"
  else
    bad P5b "bytes=$ab != count*65536=$((ac * 65536)) - a chunk was requested at another size"
  fi
fi
fc=$(awk -v s="$FREESITE" '$1=="PROF" && $0 ~ s {print $4; found=1} END{if(!found) print -1}' "$PR")
if [ "$fc" -lt 0 ]; then
  bad P5c "no PROF row at scr_string.c:822 - the free side is not interposed"
else
  ok P5c "PROF row at scr_string.c:822: freed=$fc"
fi
# P5d  FLUX MINUS FLUX IS RETENTION, and it must equal what the census holds.
#      This is the only place the two lanes may be joined: PROF counts the whole
#      run, HCSIZE counts what is live at _Exit, and their difference is live.
if [ "$ac" -ge 0 ] && [ "$fc" -ge 0 ]; then
  live=$((ac - fc))
  if [ "$live" -eq $((n65 - BASE65536)) ]; then
    ok P5d "alloc-free = $live = HCSIZE 65536 excess over $BASE65536 - the two lanes agree"
  else
    bad P5d "alloc-free = $live but HCSIZE 65536 excess = $((n65 - BASE65536))"
  fi
  # P7  THE FALSE PASS THIS DESIGN MUST SURVIVE. With SCR_STRING_ARENA cleared
  #     the arena is OFF, no chunk exists, and P1 passes for the wrong reason.
  #     The committed floor is 33 (half-on at CONVS=200).
  if [ "$live" -ge 33 ]; then
    ok P7 "the arena ran ($live chunks live; the floor is half-on's 33)"
  else
    bad P7 "only $live chunks live - the arena may have been DISABLED, which fakes P1"
  fi
fi

# --- the realized saving, computed from this run and nothing else ----------
# THE BLOCK DELTA IS EXACTLY 64 KiB PER CHUNK, and the overhead model cancels:
# granule = round16(request + 8) -- OWNER-131079.md:247 -- so a 131,079 request
# occupies round16(131,087) = 131,088 and a 65,536 request occupies
# round16(65,544) = 65,552. The difference is 65,536 to the byte, with no term
# left over from either overhead. The band is the "extra granule" some blocks
# carry (off +64, on +16, long +32 across 118 blocks); it is bounded by 16/chunk.
if [ "$n131" -eq 0 ] && [ "$n65" -gt "$BASE65536" ]; then
  awk -v c="$((n65 - BASE65536))" 'BEGIN{
    s = c * 65536;
    printf "SAVED %d B over %d chunks (%.3f MiB), band +-%d B\n", s, c, s/1048576, c*16;
    printf "NOTE  OWNER-131079.md:217 prints 3,014,768 for c=46; this reads %d.\n", s;
    printf "NOTE  The 112 B gap is that line subtracting a MODELLED new overhead\n";
    printf "NOTE  (46x16=736) from an OBSERVED old one (526). Both are inside the band.\n";
  }'
fi

echo "---- $fails failed"
[ "$fails" -eq 0 ]
