# v2-rig.sh -- environment for the FIBER/STACKLESS lane variance slice.
# Verbatim evidence-variance/v1-rig.sh with this block's own scratch roots.
# Source it. NOTHING IN THIS SLICE IS BUILT.
export TMP='G:\blocks\v2-tmp'
export TEMP='G:\blocks\v2-tmp'
export TMPDIR='G:\blocks\v2-tmp'
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\v2-prov'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\v2-zig-local'
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\v2-zig-global'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export USERPROFILE='C:\Users\vinicius'
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"
export ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
export SCRIPTC_NO_CACHE=1
# NOT SET, deliberately: SCRIPTC_STACKLESS. Both exes are prebuilt; the lane
# is a property of the binary, certified by its .ll (sa2 1488 scr_fiber refs,
# sb 3 -- 496x), not of an env var at run time. Setting it here would be
# theatre: nothing compiles.
