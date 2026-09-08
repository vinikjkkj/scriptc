# env.sh — the ONLY environment any run in this block uses.
# Every path is under <blocks>\clientbench. Nothing here points at C: except
# USERPROFILE, which is read-only for scr_os_homedir and must stay set or a
# detached shell makes 8 corpus programs trap.
#
# NOTE: do NOT source tests/perf/*/harness/env.sh or <blocks>\msgbench-lab\env.sh
# — several hardcode other blocks' private caches, and msgbench-lab's env.sh has
# no SCRIPTC_PROVENANCE_CACHE at all, so it uses the C: default.

export CB=<blocks>/clientbench
export TMP='<blocks>\clientbench\tmp'
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR='<blocks>\clientbench\cache'
export npm_config_cache='<blocks>\clientbench\npmcache'
export SCRIPTC_PROVENANCE_CACHE='<blocks>\clientbench\prov'
export ZIG_LOCAL_CACHE_DIR='<blocks>\clientbench\zig'
export ZIG_GLOBAL_CACHE_DIR='<blocks>\clientbench\zig-g'
export USERPROFILE='<home>'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export SCRIPTC_TEST_WORKERS=3
export PATH="<home>/AppData/Local/nvm/v25.9.0:<zapo-work>/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"

export WT=<blocks>/clientbench/work
export LAB=<blocks>/clientbench/lab
export APP=<blocks>/clientbench/lab/app
export SCC="$LAB/scc.mjs"
export SCC_RAW="$WT/packages/cli/dist/main.js"

node "$LAB/guard.mjs" || return 1 2>/dev/null || exit 1
