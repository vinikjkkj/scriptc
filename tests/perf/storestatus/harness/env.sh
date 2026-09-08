# env.sh -- block/storestatus. Source before ANY build or analyse.
#   . tests/perf/storestatus/harness/env.sh
#
# Every private path derives from ONE root, so the edit cannot be half-done.
# The guard at the bottom REFUSES rather than merely setting: an unpinned
# SCRIPTC_PROVENANCE_CACHE makes provenance.ts fall back to
# homedir()/.cache/scriptc with no warning, and that has filled the user's
# C: drive three times.
BLOCK="${BLOCK:-storestatus}"
ROOT="<blocks>\\${BLOCK}"
ROOTP="<blocks>/${BLOCK}"

export TMP="${ROOT}\\tmp"
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="${ROOT}\\cache"
export npm_config_cache="${ROOT}\\npmcache"
export SCRIPTC_PROVENANCE_CACHE="${ROOT}\\prov"
export ZIG_LOCAL_CACHE_DIR="${ROOT}\\zig"
export ZIG_GLOBAL_CACHE_DIR="${ROOT}\\zig-g"
export USERPROFILE='<home>'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export SCRIPTC_TEST_WORKERS=3
export WT="${ROOTP}/wt"
export LAB="${ROOTP}/lab"
export OUT="${ROOTP}/lab/out"
export NODE22='<home>/AppData/Local/nvm/v22.18.0'
export NODE25='<home>/AppData/Local/nvm/v25.9.0'
# GNU tar (Git usr/bin) MUST precede System32: bsdtar rejects --force-local and
# the provenance lane then silently falls back to the island.
export PATH="${PS_NODE:-$NODE25}:<zapo-work>/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"

# The guard is the gate. It refuses on an unset or off-G: pin, and it can
# self-test (STORESTATUS_GUARD_SELFTEST=1) so a check that can only say "yes"
# is not trusted on its silence.
node "${WT}/tests/perf/storestatus/harness/guard.mjs" || return 1 2>/dev/null || exit 1
