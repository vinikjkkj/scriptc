# mb-rig.sh -- evidence-postfix/sb-rig.sh verbatim except this block's own
# scratch roots (mb-*). Source it; do not execute it. STACKLESS lane:
# SCRIPTC_STACKLESS stays ABSENT -- the shipping default since 8f4100d7a.
# Mirrors G:\blocks\h2-rig.sh (quoted verbatim in PLAN-POSTFIX-CENSUS.md s.1),
# with this block's own scratch roots. Source it; do not execute it.
export TMP='G:\blocks\mb-tmp'
export TEMP='G:\blocks\mb-tmp'
export TMPDIR='G:\blocks\mb-tmp'
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\mb-prov'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\mb-zig-local'
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\mb-zig-global'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export USERPROFILE='C:\Users\vinicius'
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"
export ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
export SCRIPTC_NO_CACHE=1
# NOT SET, deliberately: SCRIPTC_STACKLESS. The shipping default is stackless
# since 8f4100d7a and this arm must take the default. The guard proves the
# compiler can actually see the absence.
