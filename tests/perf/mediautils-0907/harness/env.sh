export TMP="${BLOCKS_ROOT:-<blocks>}\mediautils-tmp"
export TEMP="${BLOCKS_ROOT:-<blocks>}\mediautils-tmp"
export TMPDIR="${BLOCKS_ROOT:-<blocks>}\mediautils-tmp"
export SCRIPTC_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\mediautils-cache"
export npm_config_cache="${BLOCKS_ROOT:-<blocks>}\mediautils-npmcache"
export SCRIPTC_PROVENANCE_CACHE="${BLOCKS_ROOT:-<blocks>}\mediautils-prov"
export ZIG_LOCAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\mediautils-zig"
export ZIG_GLOBAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\mediautils-zig-g"
export USERPROFILE="${HOME_ROOT:-<home>}"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
unset SCRIPTC_TEST_WORKERS
export WT="${BLOCKS_ROOT:-<blocks>}/mediautils"
export LAB="${BLOCKS_ROOT:-<blocks>}/mediautils-work"
export NODE22="${HOME_ROOT:-<home>}/AppData/Local/nvm/v22.18.0"
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
export NODE25="${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0"
export PATH="${PS_NODE:-$NODE25}:${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"
