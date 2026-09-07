# Every private path derives from ONE name, so the edit cannot be half-done.
# With BLOCK unset this file resolves to exactly the paths it always did,
# apart from the one line noted below where that is the point.
BLOCK="${BLOCK:-wamvoip}"
ROOT="<blocks>\\${BLOCK}"
ROOTP="<blocks>/${BLOCK}"

export ZIG_GLOBAL_CACHE_DIR="${ROOT}\.zig"
export ZIG_LOCAL_CACHE_DIR="${ROOT}\.zig"
export SCRIPTC_CACHE_DIR="${ROOT}\cache"
export SCRIPTC_PROVENANCE_CACHE="${ROOT}\prov"
# NOT '${ROOT}\tmp'. This block's WORKTREE is ${ROOT}
# itself (other blocks keep theirs at <blocks>\<name>\wt, with tmp as a
# SIBLING), so a tmp under it is INSIDE the repo — and tests that stage a
# fixture in mkdtemp then resolve @types/node by walking UP get the repo's
# own. tests/harness/fetch-dispatcher.test.ts fails two cells that way, on
# a clean tree, with no compiler change at all: its fixture declares its own
# structural `Dispatcher` and casts an object literal `as RequestInit`, and
# the repo's real @types/node types RequestInit.dispatcher as undici's
# class. Outside the worktree the same fixture is 210 statements, 0 failed.
export TMP="${ROOT}-tmp"
export TEMP="${ROOT}-tmp"
export TMPDIR="${ROOT}-tmp"
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_TEST_WORKERS=2
export PATH="<zapo-work>/tools/zig:$PATH"
export WT="${ROOTP}"
export LAB="${ROOTP}/lab"
export ZSRC='<zapo-work>/caches/provenance/250f9af5229a545eec28ddbd3e8774a397cdb0bb'
export ZPKG="$ZSRC/packages"
export NODE25='<home>/AppData/Local/nvm/v25.9.0'
export SCRIPTC="${ROOTP}/packages/cli/dist/main.js"

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
