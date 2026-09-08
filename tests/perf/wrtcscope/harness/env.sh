# env.sh — block/wrtcscope. Source before ANY build. Pins every cache to G:.
# Usage: . tests/perf/wrtcscope/harness/env.sh
export TMP="${BLOCKS_ROOT:-<blocks>}\wrtcscope\tmp"
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\wrtcscope\cache"
export npm_config_cache="${BLOCKS_ROOT:-<blocks>}\wrtcscope\npmcache"
export SCRIPTC_PROVENANCE_CACHE="${BLOCKS_ROOT:-<blocks>}\wrtcscope\prov"
export ZIG_LOCAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\wrtcscope\zig"
export ZIG_GLOBAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\wrtcscope\zig-g"
export USERPROFILE="${HOME_ROOT:-<home>}"
export SCRIPTC_TARGET="x86_64-windows-gnu"
export SCRIPTC_CC="zigcc"
export SCRIPTC_TEST_CC="zig cc"
export WRTCSCOPE_WT="${BLOCKS_ROOT:-<blocks>}/wrtcscope/wt"
# node v25.9.0 = gate/oracle lane. Git's GNU tar BEFORE System32's bsdtar.
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
export PATH="${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0:${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"
# The guard is the gate: nothing runs if a cache var is unset or off G:.
node "$WRTCSCOPE_WT/tests/perf/wrtcscope/harness/guard.mjs" || return 1
