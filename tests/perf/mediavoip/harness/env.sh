# Every private path derives from ONE name, so the edit cannot be half-done.
# With BLOCK unset this file resolves to exactly the paths it always did,
# apart from the one line noted below where that is the point.
BLOCK="${BLOCK:-mediavoip}"
ROOT="${BLOCKS_ROOT:-<blocks>}\\${BLOCK}"
ROOTP="${BLOCKS_ROOT:-<blocks>}/${BLOCK}"

export TMP="${ROOT}\tmp"
export TEMP="${ROOT}\tmp"
export TMPDIR="${ROOT}\tmp"
export SCRIPTC_CACHE_DIR="${ROOT}\cache"
export SCRIPTC_PROVENANCE_CACHE="${ROOT}\cache\provenance"
export ZIG_GLOBAL_CACHE_DIR="${ROOT}\zig"
export ZIG_LOCAL_CACHE_DIR="${ROOT}\zig\local"
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC="zig cc"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_TEST_WORKERS=2
export WT="${ROOTP}/wt"
export LAB="${ROOTP}/lab"
export ZPKG="${ZAPO_WORK_ROOT:-<zapo-work>}/caches/provenance/250f9af5229a545eec28ddbd3e8774a397cdb0bb/packages"
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
export PATH="${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig:$PATH"

# GUARD. An unpinned cache extracts under homedir(), which on Windows is the
# user's C: drive: provenance.ts falls back to
# homedir()/.cache/scriptc/provenance with no warning, and that has filled it
# three times, once with 2.17 GB. Sourcing this file now CHECKS the pins
# rather than merely setting them -- a shell that sets some and not others is
# the other way to get there.
scriptc_check_pins() {
  local bad=0 v
  for v in TMP TEMP TMPDIR SCRIPTC_CACHE_DIR SCRIPTC_PROVENANCE_CACHE ZIG_LOCAL_CACHE_DIR ZIG_GLOBAL_CACHE_DIR npm_config_cache; do
    [ -z "${!v}" ] && continue
    case "${!v}" in
      [Gg]:*) ;;
      *) echo "PIN NOT ON G:: $v = ${!v}" >&2; bad=1 ;;
    esac
  done
  for v in TMP TMPDIR SCRIPTC_PROVENANCE_CACHE; do
    [ -z "${!v}" ] && { echo "PIN UNSET: $v" >&2; bad=1; }
  done
  if [ "$bad" = 1 ]; then
    echo "REFUSING: an unpinned cache extracts into $HOME, the user C: drive." >&2
    return 1
  fi
  return 0
}
scriptc_check_pins || return 1 2>/dev/null || exit 1
