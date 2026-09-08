export ZIG_GLOBAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\twobyte\.zig"
export ZIG_LOCAL_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\twobyte\.zig"
export SCRIPTC_CACHE_DIR="${BLOCKS_ROOT:-<blocks>}\twobyte\.cache"
export TMP="${BLOCKS_ROOT:-<blocks>}\twobyte-tmp" TEMP="${BLOCKS_ROOT:-<blocks>}\twobyte-tmp" TMPDIR="${BLOCKS_ROOT:-<blocks>}\twobyte-tmp"
export SCRIPTC_CC=zigcc SCRIPTC_TEST_CC='zig cc' SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_TEST_WORKERS=3
export WT="${BLOCKS_ROOT:-<blocks>}/twobyte"
export LAB="${BLOCKS_ROOT:-<blocks>}/twobyte-lab"
# NOTE: PATH is colon-separated, so a Windows-spelled root splits into two entries --
# the drive letter becomes an entry of its own and the rest of the path is lost.
# *_ROOT_POSIX holds the MSYS spelling: a different VALUE, not a restyling of one.
# Do not collapse the pair back into a single variable.
export PATH="${ZAPO_WORK_ROOT_POSIX:-<zapo-work>}/tools/zig:$PATH"
export NODE25="${HOME_ROOT_POSIX:-<home>}/AppData/Local/nvm/v25.9.0"
export SCRIPTC_PROVENANCE_CACHE="${BLOCKS_ROOT:-<blocks>}\pkgstatus-lab\prov"
