# f2-rig.sh -- environment for the chunk-ref PEAK slice.
# v3-rig.sh term for term; only the scratch roots differ (f2-* instead of v3-*).
export TMP="G:\blocks\f2-tmp-$ARMTAG"
export TEMP="G:\blocks\f2-tmp-$ARMTAG"
export TMPDIR="G:\blocks\f2-tmp-$ARMTAG"
export SCRIPTC_PROVENANCE_CACHE="G:\blocks\f2-prov-$ARMTAG"
export ZIG_LOCAL_CACHE_DIR="G:\blocks\f2-zig-local-$ARMTAG"
export ZIG_GLOBAL_CACHE_DIR="G:\blocks\f2-zig-global-$ARMTAG"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export USERPROFILE='C:\Users\vinicius'
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"
export ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
export SCRIPTC_NO_CACHE=1
