#!/bin/sh
# sb-compare.sh -- the lane's effect on the SETTLED heap, and route B honest.
# Reads only committed artifacts plus this block's own run.
set -u
WT=/g/blocks/sb-wt
EP=$WT/tests/perf/heapcensus/evidence-postfix
EI=$WT/tests/perf/heapcensus/evidence-idle
SB=/g/blocks/sb-run

row() { # <label> <file> <lane>
  awk -v L="$1" -v LANE="$3" '/^\[heapcen\] heap 0 /{
    for (i = 1; i <= NF; i++) {
      split($i, kv, "=");
      if (kv[1] == "busy") b = kv[2];
      if (kv[1] == "busyBlocks") bb = kv[2];
      if (kv[1] == "free") f = kv[2];
      if (kv[1] == "freeBlocks") fb = kv[2];
      if (kv[1] == "uncommitted") u = kv[2];
    }
    printf "%-10s %-10s %12d %8d %12d %8d %12d\n", L, LANE, b, bb, f, fb, u;
    exit
  }' "$2"
}

echo "=== THE SETTLED CRT HEAP, heap 0, by arm and by LANE ==="
printf "%-10s %-10s %12s %8s %12s %8s %12s\n" arm lane busy busyBlk free freeBlk uncommitted
row "idle/on"  "$EI/on.heapcen.txt"  STACKLESS
row "idle/off" "$EI/off.heapcen.txt" STACKLESS
row "idle/long" "$EI/long.heapcen.txt" STACKLESS
row "postfix/sa" "$EP/sa.heapcen.txt" FIBER
row "postfix/sb" "$SB/sb.heapcen.txt" STACKLESS

echo
echo "=== THE LANE'S EFFECT ON THE SETTLED HEAP (sb STACKLESS - sa FIBER) ==="
echo "    Same recipe, same knobs, same source tree for runtime/compiler/cli."
echo "    The intended difference is the coroutine lane."
SAB=$(awk '/^\[heapcen\] heap 0 /{for(i=1;i<=NF;i++){split($i,kv,"=");if(kv[1]=="busy")print kv[2]}; exit}' "$EP/sa.heapcen.txt")
SBB=$(awk '/^\[heapcen\] heap 0 /{for(i=1;i<=NF;i++){split($i,kv,"=");if(kv[1]=="busy")print kv[2]}; exit}' "$SB/sb.heapcen.txt")
ONB=$(awk '/^\[heapcen\] heap 0 /{for(i=1;i<=NF;i++){split($i,kv,"=");if(kv[1]=="busy")print kv[2]}; exit}' "$EI/on.heapcen.txt")
echo "    sa  FIBER      busy = $SAB B"
echo "    sb  STACKLESS  busy = $SBB B"
awk -v a="$SAB" -v b="$SBB" 'BEGIN{d=b-a; printf "    delta            = %+d B (%+.3f MiB, %+.2f%% of the fiber arm)\n", d, d/1048576, 100*d/a}'

echo
echo "=== ROUTE A and ROUTE B, both with their denominators named ==="
LIVE=$(awk '$1=="PROF" && /scr_string[.]c:820$/{print $2}' "$SB/sb.prof.txt")
FREED=$(awk '$1=="PROF" && /scr_string[.]c:822$/{print $4; f=1} END{if(!f) print 0}' "$SB/sb.prof.txt")
CHUNKS=$((LIVE - FREED))
SAVED=$((CHUNKS * 65536))
echo "    live string-arena chunks in sb = $LIVE alloc - $FREED freed = $CHUNKS"
echo "    realized release               = $CHUNKS x 65536 = $SAVED B"
awk -v s="$SAVED" -v b="$SBB" -v o="$ONB" 'BEGIN{
  cf = b + s;
  printf "\n    ROUTE A  this run against ITS OWN counterfactual pre-fix heap\n";
  printf "             %d / (%d + %d = %d) = %.3f%%\n", s, b, s, cf, 100*s/cf;
  printf "\n    ROUTE B  this run against the STACKLESS baseline evidence-idle/on\n";
  printf "             %d / %d = %.3f%%\n", s, o, 100*s/o;
  printf "             numerator and denominator are now BOTH on the stackless lane.\n";
  printf "\n    agreement between the two routes: %.3f pp\n", (100*s/cf) - (100*s/o) < 0 ? (100*s/o) - (100*s/cf) : (100*s/cf) - (100*s/o);
}'
