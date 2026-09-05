#!/bin/sh
# The 100%-C proof, armed.
#
# A raw byte scan for quickjs / JS_NewRuntime / JS_Eval / scr_dyn_ reads 0 even
# in a --dynamic control, so a bare "0 hits" proves nothing. This scan therefore
# (a) reports the same markers for a KNOWN --dynamic control so you can see which
# ones actually discriminate, and (b) reports positive controls -- symbols that
# ARE linked into a real build -- so you can see the scan is not simply blind.
# The structural proof is separate and stronger: ensureEngineArchive runs only
# under --dynamic and produces libqjs.a; we show none exists.
set -u
# SCAN_CTL   a KNOWN --dynamic binary, so you can see which markers discriminate
# SCAN_ROOT  the block root to search for libqjs.a (the structural proof).
#            It used to be one block's absolute path, which is why the
#            structural half of this scan was only ever true for that block.
CTL=${SCAN_CTL:-/g/blocks/_artifacts/spreadargs-lab/dyn-ctl.exe}
ROOT=${SCAN_ROOT:-$PWD}
BINS="$*"

scan1 () { # file, needle
  if [ ! -f "$1" ]; then echo "-"; return; fi
  printf '%s' "$(LC_ALL=C grep -a -c -o -F "$2" "$1" 2>/dev/null | head -1)"
  echo
}

hdr () { printf '%-34s %9s %8s %14s %9s %10s | %10s %9s %9s %10s\n' \
  binary quickjs ScrDyn JS_NewRuntime JS_Eval scr_dyn_ mbedtls_ deflate inflate sqlite3_; }

row () {
  f=$1
  printf '%-34s %9s %8s %14s %9s %10s | %10s %9s %9s %10s\n' \
    "$(basename "$f")" \
    "$(scan1 "$f" quickjs)" "$(scan1 "$f" ScrDyn)" "$(scan1 "$f" JS_NewRuntime)" \
    "$(scan1 "$f" JS_Eval)" "$(scan1 "$f" scr_dyn_)" \
    "$(scan1 "$f" mbedtls_)" "$(scan1 "$f" deflate)" "$(scan1 "$f" inflate)" "$(scan1 "$f" sqlite3_)"
}

echo "=== engine scan (left of | = engine markers, right of | = POSITIVE CONTROLS) ==="
hdr
if [ -f "$CTL" ]; then row "$CTL"; else echo "CONTROL MISSING: $CTL"; fi
for b in $BINS; do row "$b"; done
echo
echo "Read this table as follows:"
echo "  * a marker that is 0 in the CONTROL is NOT EVIDENCE -- it cannot discriminate."
echo "  * the positive controls must be NON-ZERO in the shipped binary, or the scan is blind."
echo
echo "=== structural proof: ensureEngineArchive output ==="
echo "libqjs.a anywhere under this block's caches and output ($ROOT):"
find "$ROOT" -name 'libqjs.a' 2>/dev/null | head -20
echo "(no lines above = no engine archive was ever produced = no --dynamic build)"
