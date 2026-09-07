#!/bin/bash
# prov2 block environment. Source before ANY build or gate.
# Every private path derives from ONE name, so the edit cannot be half-done.
# With BLOCK unset this file resolves to exactly the paths it always did,
# apart from the one line noted below where that is the point.
BLOCK="${BLOCK:-prov2}"
ROOT="<blocks>\\${BLOCK}"
ROOTP="<blocks>/${BLOCK}"

export TMP="${ROOT}\tmp"
export TEMP="${ROOT}\tmp"
export TMPDIR="${ROOT}\tmp"
export SCRIPTC_CACHE_DIR="${ROOT}\cache"
export SCRIPTC_PROVENANCE_CACHE="${ROOT}\cache\provenance"
export ZIG_GLOBAL_CACHE_DIR="${ROOT}\zig"
export ZIG_LOCAL_CACHE_DIR="${ROOT}\zig"
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC="zig cc"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_TEST_WORKERS=2
export PATH="<zapo-work>/tools/zig:$PATH"
export WT=<blocks>/prov2/wt
export BASE=<blocks>/prov2/base
export LAB=<blocks>/prov2/lab
export NODE22="$(command -v node)"
export NODE25='<home>\AppData\Local\nvm\v25.9.0\node.exe'
export NODE_EXTRA_CA_CERTS='<zapo-work>\ca-bundle.pem'
export npm_config_cache="${ROOT}\cache\npm"

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
