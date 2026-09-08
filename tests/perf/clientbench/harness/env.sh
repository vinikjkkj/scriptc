# env.sh — the ONLY environment any run in this block uses.
# Every path is under <blocks>\clientbench. Nothing here points at C: except
# USERPROFILE, which is read-only for scr_os_homedir and must stay set or a
# detached shell makes 8 corpus programs trap.
#
# NOTE: do NOT source tests/perf/*/harness/env.sh or <blocks>\msgbench-lab\env.sh
# — several hardcode other blocks' private caches, and msgbench-lab's env.sh has
# no SCRIPTC_PROVENANCE_CACHE at all, so it uses the C: default.

export CB=${BLOCKS_ROOT:-<blocks>}/clientbench
export TMP="${BLOCKS_ROOT:-<blocks>}\clientbench\tmp"
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\clientbench\cache"
export npm_config_cache="${BLOCKS_ROOT:-<blocks>}\clientbench\npmcache"
export SCRIPTC_PROVENANCE_CACHE="${BLOCKS_ROOT:-<blocks>}\clientbench\prov"
export ZIG_LOCAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\clientbench\zig"
export ZIG_GLOBAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\clientbench\zig-g"
export USERPROFILE="${HOME_ROOT:-<home>}"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export SCRIPTC_TEST_WORKERS=3
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
export PATH="${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0:${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"

export WT=${BLOCKS_ROOT:-<blocks>}/clientbench/work
export LAB=${BLOCKS_ROOT:-<blocks>}/clientbench/lab
export APP=${BLOCKS_ROOT:-<blocks>}/clientbench/lab/app
export SCC="$LAB/scc.mjs"
export SCC_RAW="$WT/packages/cli/dist/main.js"

node "$LAB/guard.mjs" || return 1 2>/dev/null || exit 1
