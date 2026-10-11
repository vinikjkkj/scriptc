# v3-rig.sh -- environment for the PEAK lane-variance slice.
# evidence-lane/v2-rig.sh term for term, with this block's own scratch roots
# and, unlike v2, a per-ARM cache so the two builds can run concurrently
# without sharing a zig cache.  Source it with ARMTAG already set.
export TMP="G:\blocks\v3-tmp-$ARMTAG"
export TEMP="G:\blocks\v3-tmp-$ARMTAG"
export TMPDIR="G:\blocks\v3-tmp-$ARMTAG"
export SCRIPTC_PROVENANCE_CACHE="G:\blocks\v3-prov-$ARMTAG"
export ZIG_LOCAL_CACHE_DIR="G:\blocks\v3-zig-local-$ARMTAG"
export ZIG_GLOBAL_CACHE_DIR="G:\blocks\v3-zig-global-$ARMTAG"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export USERPROFILE='C:\Users\vinicius'
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"
export ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
export SCRIPTC_NO_CACHE=1
