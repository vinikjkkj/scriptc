#!/bin/sh
# artifact.sh — the facts that must be READ OFF THE ARTIFACT, never inferred.
#
#   sh artifact.sh <out-dir> <exe-path-posix>
#
# Prints, for one built arm:
#   * the BACKEND LANE, decided by which intermediate the compiler actually
#     emitted — .ll means the LLVM tier, .c means it demoted to C. This is read
#     from the output directory, not from a build-log line that says what the
#     compiler intended.
#   * binary size, beside the zig version and SCRIPTC_TARGET that produced it —
#     two zigs on this host build the size class 20 KB apart, so a size without
#     its toolchain is not a number.
#   * the engine scan (is quickjs/ScrDyn linked in).
#   * the fence count, with SC900x separated out. SC900x is the code emitted
#     for CORRECT code and is not a refusal; 3,782 of 3,786 fences in one
#     census were SC900x, so a total that does not separate them is not a
#     refusal count.
HERE=$(cd "$(dirname "$0")" && pwd)
OUTDIR="${1:?usage: artifact.sh <out-dir> <exe-posix>}"
EXE="${2:?usage: artifact.sh <out-dir> <exe-posix>}"

echo "== artifact: $EXE"
if [ ! -f "$EXE" ]; then echo "   NO BINARY at $EXE — could not look"; exit 2; fi

echo "-- backend lane, read off the emitted intermediate --"
nll=$(find "$OUTDIR" -maxdepth 1 -name '*.ll' | wc -l)
nc=$(find "$OUTDIR" -maxdepth 1 -name '*.c' | wc -l)
find "$OUTDIR" -maxdepth 1 \( -name '*.ll' -o -name '*.c' -o -name '*.scrh' -o -name '*.h' \) \
  -printf '   %f  %s bytes\n' 2>/dev/null | sort
if [ "$nll" -gt 0 ] && [ "$nc" -eq 0 ]; then echo "   LANE: LLVM (.ll emitted, no .c)"
elif [ "$nc" -gt 0 ] && [ "$nll" -eq 0 ]; then echo "   LANE: C (.c emitted, no .ll) — this arm DEMOTED"
elif [ "$nll" -gt 0 ] && [ "$nc" -gt 0 ]; then echo "   LANE: MIXED — both .ll and .c present; read the names above"
else echo "   LANE: UNDETERMINED — no intermediate was kept in $OUTDIR (build without --keep-c?)"; fi

echo "-- size, with the toolchain that made it --"
echo "   $(stat -c%s "$EXE") bytes   zig $(zig version)   SCRIPTC_TARGET=$SCRIPTC_TARGET   SCRIPTC_CC=$SCRIPTC_CC"

echo "-- engine scan --"
node "$HERE/../../../clientbench/harness/engine.mjs" "$EXE" 2>&1 | sed 's/^/   /'

echo "-- fences --"
node "$HERE/../../../clientbench/harness/fences.mjs" "$OUTDIR" 2>&1 | sed 's/^/   /'
echo "   -- SC900x excluded (SC900x is emitted for CORRECT code; it is not a refusal) --"
node "$HERE/../../../clientbench/harness/fences.mjs" "$OUTDIR" 2>&1 \
  | awk '/^    SC/ { code=$1; n=$2; sub(/^x/,"",n); if (code !~ /^SC900/) { t+=n; print "   keep " code " " n } } END { if (t=="") t=0; print "   NON-SC900x TOTAL: " t }'
