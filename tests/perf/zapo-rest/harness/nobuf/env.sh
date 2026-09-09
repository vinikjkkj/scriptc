# env.sh — the ONLY environment the nobuf arms are built and measured in.
#
# Sourced by build.sh, pair.sh and wsprobe.sh. Every path lives under
# $BLOCKS_ROOT/nobuffer; nothing here points at C: except USERPROFILE, which is
# read-only and must stay set or scr_os_homedir traps in a detached shell.
#
# TWO NODE LANES, and the difference is load-bearing:
#
#   BUILD lane  — node v22.18.0, pnpm 10.6.4. This is the DEFAULT node on this
#                 host, reached by NOT prepending a node directory to PATH.
#                 Prepending v25 resolves pnpm through corepack (11.x), which
#                 purges the v22 install and reads back as a red build.
#   GATE  lane  — node v25.9.0, prepended explicitly. memrig runs here: it
#                 needs the global WebSocket constructor v22 does not have.
#
# Select with:  . env.sh build   |   . env.sh gate
#
# NO MACHINE-SPECIFIC PATH IS COMMITTED. Roots come from the environment:
#
#   BLOCKS_ROOT        Windows spelling of the blocks root   (e.g. X:\blocks)
#   BLOCKS_ROOT_POSIX  MSYS spelling of the same root        (e.g. /x/blocks)
#   HOME_ROOT          Windows spelling of the user profile
#   HOME_ROOT_POSIX    MSYS spelling of the same
#   ZAPO_WORK_ROOT_POSIX  MSYS spelling of the zapo-work root
#
# The *_POSIX variables hold a different VALUE, not a restyling of one: PATH is
# colon-separated, so a Windows-spelled entry splits at the drive colon and the
# rest of the path is lost. Do not collapse the pairs.

NOBUF_LANE="${1:-build}"

_BW="${BLOCKS_ROOT:-<blocks>}"
_BP="${BLOCKS_ROOT_POSIX:-<blocks>}"

export NB="$_BP/nobuffer"
export NB_WIN="$_BW\\nobuffer"

export TMP="$NB_WIN\\tmp"
export TEMP="$TMP"
export TMPDIR="$TMP"
export SCRIPTC_CACHE_DIR="$NB_WIN\\cache"
export npm_config_cache="$NB_WIN\\npmcache"
export SCRIPTC_PROVENANCE_CACHE="$NB_WIN\\prov"
export ZIG_LOCAL_CACHE_DIR="$NB_WIN\\zig"
export ZIG_GLOBAL_CACHE_DIR="$NB_WIN\\zig-g"
export USERPROFILE="${HOME_ROOT:-<home>}"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'

# The TREE zig (0.16.0) ahead of Chocolatey's (0.15.2) — they build the size
# class 20 KB apart. GNU tar ahead of System32's bsdtar, which rejects
# `--force-local` and makes the provenance lane fall back to the island and
# report 58 unrelated refusals.
_ZIG="${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig"
_GNU='/c/Program Files/Git/usr/bin'
_UCRT='/c/msys64/ucrt64/bin'
if [ "$NOBUF_LANE" = "gate" ]; then
  export PATH="${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0:$_ZIG:$_GNU:$_UCRT:$PATH"
else
  export PATH="$_ZIG:$_GNU:$_UCRT:$PATH"
fi

export WT="$NB/wt"
export WT_WIN="$NB_WIN\\wt"
export OUT_BUF="$NB_WIN\\out-buf"
export OUT_NOBUF="$NB_WIN\\out-nobuf"
export EXE_BUF="$OUT_BUF\\zapo-rest.exe"
export EXE_NOBUF="$OUT_NOBUF\\zapo-rest-nobuf.exe"
export LOGS="$NB/logs"
export MEMRIG_OUT="$NB_WIN\\memrig"
export MEMRIG_PMON="$WT_WIN\\tests\\perf\\zapo-rest\\harness\\pmon.exe"

mkdir -p "$NB/tmp" "$NB/cache" "$NB/npmcache" "$NB/prov" "$NB/zig" "$NB/zig-g" \
         "$NB/out-buf" "$NB/out-nobuf" "$NB/logs" "$NB/memrig" 2>/dev/null

echo "lane=$NOBUF_LANE node=$(node --version) pnpm=$(pnpm --version 2>/dev/null) zig=$(zig version) target=$SCRIPTC_TARGET"
