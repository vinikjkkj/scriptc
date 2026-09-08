# env.sh — block/wrtcscope. Source before ANY build. Pins every cache to G:.
# Usage: . tests/perf/wrtcscope/harness/env.sh
export TMP="<blocks>\wrtcscope\tmp"
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="<blocks>\wrtcscope\cache"
export npm_config_cache="<blocks>\wrtcscope\npmcache"
export SCRIPTC_PROVENANCE_CACHE="<blocks>\wrtcscope\prov"
export ZIG_LOCAL_CACHE_DIR="<blocks>\wrtcscope\zig"
export ZIG_GLOBAL_CACHE_DIR="<blocks>\wrtcscope\zig-g"
export USERPROFILE="<home>"
export SCRIPTC_TARGET="x86_64-windows-gnu"
export SCRIPTC_CC="zigcc"
export SCRIPTC_TEST_CC="zig cc"
export WRTCSCOPE_WT="<blocks>/wrtcscope/wt"
# node v25.9.0 = gate/oracle lane. Git's GNU tar BEFORE System32's bsdtar.
export PATH="<home>/AppData/Local/nvm/v25.9.0:<zapo-work>/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"
# The guard is the gate: nothing runs if a cache var is unset or off G:.
node "$WRTCSCOPE_WT/tests/perf/wrtcscope/harness/guard.mjs" || return 1
