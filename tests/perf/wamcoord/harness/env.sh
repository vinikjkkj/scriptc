# Block env. EVERY path is derived from one name, and the file REFUSES to be
# sourced if any pin is missing or off G:.
#
# Why it is shaped this way rather than as a list of literals. Twelve committed
# tests/perf/*/harness/env.sh files hardcode one block's private cache paths,
# and two of them already point at a DIFFERENT block's cache than their own
# name: tests/perf/pkgstatus2/env.sh pins <blocks>/wamfix-lab/prov and
# tests/perf/voipfix/env.sh pins <blocks>/pkgstatus-lab/prov. Copying one of
# these is the normal way to start a block, so copying one is the normal way to
# inherit someone else's cache. Setting BLOCK below is one edit that cannot be
# half-done.
#
# And the pins are CHECKED, not just set. On 2026-09-07 an unpinned
# `node checkmap.mjs` -- one invocation out of thirty-four, from a shell that
# had not sourced this file -- extracted five attested trees to
# <home>\.cache\scriptc\provenance, 254 files, 10,904,581 bytes,
# because provenance.ts falls back to homedir() with no warning. The resolving
# .mjs entry points now self-guard through pins.mjs; this is the second layer,
# for a shell that sets some of these and not others.

BLOCK="${BLOCK:-wamcoord}"
ROOT="${BLOCKS_ROOT:-<blocks>}\\${BLOCK}"

export TMP="${ROOT}-tmp"
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="${ROOT}-cache"
export npm_config_cache="${ROOT}-npmcache"
export SCRIPTC_PROVENANCE_CACHE="${ROOT}-prov"
export ZIG_LOCAL_CACHE_DIR="${ROOT}-zig"
export ZIG_GLOBAL_CACHE_DIR="${ROOT}-zig-g"

# USERPROFILE is deliberately the real one: scr_os_homedir traps without it, and
# a detached shell that loses it produces 8 corpus failures that look like code.
# It is also exactly why every cache above must be pinned explicitly -- they are
# the things that would otherwise be derived from it.
export USERPROFILE="${HOME_ROOT:-<home>}"

export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
unset SCRIPTC_TEST_WORKERS

export WT="${BLOCKS_ROOT:-<blocks>}/${BLOCK}"
export LAB="${BLOCKS_ROOT:-<blocks>}/${BLOCK}-lab"
export NODE22="${HOME_ROOT:-<home>}/AppData/Local/nvm/v22.18.0"
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
export NODE25="${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0"
# GNU tar (Git usr/bin) MUST precede System32: bsdtar rejects --force-local and
# the provenance lane then silently falls back to the island and reports phantom
# SC2013s while finishing fast.
export PATH="${PS_NODE:-$NODE25}:${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"

scriptc_check_pins() {
  local bad=0 v
  for v in TMP TEMP TMPDIR SCRIPTC_CACHE_DIR SCRIPTC_PROVENANCE_CACHE npm_config_cache ZIG_LOCAL_CACHE_DIR ZIG_GLOBAL_CACHE_DIR; do
    case "${!v}" in
      [Gg]:*) ;;
      "") echo "PIN UNSET: $v" >&2; bad=1 ;;
      *)  echo "PIN NOT ON G:: $v = ${!v}" >&2; bad=1 ;;
    esac
  done
  if [ "$bad" = 1 ]; then
    echo "REFUSING: an unpinned cache extracts into \$HOME, which is the user's C: drive." >&2
    return 1
  fi
  return 0
}
scriptc_check_pins || return 1 2>/dev/null || exit 1
