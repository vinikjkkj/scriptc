# v1-rig.sh -- environment for the PRE/POST committed-heap variance slice.
# Verbatim sb-rig.sh with this block's own scratch roots. Source it.
export TMP='G:\blocks\v1-tmp'
export TEMP='G:\blocks\v1-tmp'
export TMPDIR='G:\blocks\v1-tmp'
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\v1-prov'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\v1-zig-local'
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\v1-zig-global'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export USERPROFILE='C:\Users\vinicius'
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"
export ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
export SCRIPTC_NO_CACHE=1
# NOT SET, deliberately: SCRIPTC_STACKLESS. Both binaries are prebuilt and
# both were certified STACKLESS by their .ll; nothing here compiles.
