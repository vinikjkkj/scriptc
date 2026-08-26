export ZIG_GLOBAL_CACHE_DIR='G:\blocks\wamvoip\.zig'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\wamvoip\.zig'
export SCRIPTC_CACHE_DIR='G:\blocks\wamvoip\cache'
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\wamvoip\prov'
# NOT 'G:\blocks\wamvoip\tmp'. This block's WORKTREE is G:\blocks\wamvoip
# itself (other blocks keep theirs at G:\blocks\<name>\wt, with tmp as a
# SIBLING), so a tmp under it is INSIDE the repo — and tests that stage a
# fixture in mkdtemp then resolve @types/node by walking UP get the repo's
# own. tests/harness/fetch-dispatcher.test.ts fails two cells that way, on
# a clean tree, with no compiler change at all: its fixture declares its own
# structural `Dispatcher` and casts an object literal `as RequestInit`, and
# the repo's real @types/node types RequestInit.dispatcher as undici's
# class. Outside the worktree the same fixture is 210 statements, 0 failed.
export TMP='G:\blocks\wamvoip-tmp'
export TEMP='G:\blocks\wamvoip-tmp'
export TMPDIR='G:\blocks\wamvoip-tmp'
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_TEST_WORKERS=2
export PATH="/g/zapo-work/tools/zig:$PATH"
export WT='G:/blocks/wamvoip'
export LAB='G:/blocks/wamvoip/lab'
export ZSRC='G:/zapo-work/caches/provenance/250f9af5229a545eec28ddbd3e8774a397cdb0bb'
export ZPKG="$ZSRC/packages"
export NODE25='/c/Users/vinicius/AppData/Local/nvm/v25.9.0'
export SCRIPTC='G:/blocks/wamvoip/packages/cli/dist/main.js'
