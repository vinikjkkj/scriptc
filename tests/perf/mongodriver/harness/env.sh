# mongodriver block environment (sh). Source before anything.
ROOT="<blocks>\mongodriver"
ROOTP="<blocks>/mongodriver"
export TMP="${ROOT}\tmp"; export TEMP="$TMP"; export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="${ROOT}\cache"
export npm_config_cache="${ROOT}\npmcache"
export SCRIPTC_PROVENANCE_CACHE="${ROOT}\prov"
export ZIG_LOCAL_CACHE_DIR="${ROOT}\zig"
export ZIG_GLOBAL_CACHE_DIR="${ROOT}\zig-g"
export USERPROFILE='<home>'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export SCRIPTC_TEST_WORKERS=3
export WT="${ROOTP}/wt"
export LAB="${ROOTP}/lab"
export NODE22='<home>/AppData/Local/nvm/v22.18.0'
export NODE25='<home>/AppData/Local/nvm/v25.9.0'
# GNU tar (Git usr/bin) MUST precede System32: bsdtar rejects --force-local and
# the provenance lane then silently falls back to the island.
export PATH="${PS_NODE:-$NODE25}:<zapo-work>/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"
scriptc_check_pins() {
  local bad=0 v
  for v in TMP TEMP TMPDIR SCRIPTC_CACHE_DIR SCRIPTC_PROVENANCE_CACHE ZIG_LOCAL_CACHE_DIR ZIG_GLOBAL_CACHE_DIR npm_config_cache; do
    [ -z "${!v}" ] && { echo "PIN UNSET: $v" >&2; bad=1; continue; }
    case "${!v}" in [Gg]:*) ;; *) echo "PIN NOT ON G:: $v = ${!v}" >&2; bad=1 ;; esac
  done
  [ "$bad" = 1 ] && { echo "REFUSING: an unpinned cache extracts into HOME, the user C: drive." >&2; return 1; }
  return 0
}
scriptc_check_pins || return 1 2>/dev/null || exit 1
