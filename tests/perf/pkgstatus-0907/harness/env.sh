ial() { :; }
export TMP='<blocks>\pkgstatus-tmp'
export TEMP='<blocks>\pkgstatus-tmp'
export TMPDIR='<blocks>\pkgstatus-tmp'
export SCRIPTC_CACHE_DIR='<blocks>\pkgstatus-cache'
export npm_config_cache='<blocks>\pkgstatus-npmcache'
export SCRIPTC_PROVENANCE_CACHE='<blocks>\pkgstatus-prov'
export ZIG_LOCAL_CACHE_DIR='<blocks>\pkgstatus-zig'
export ZIG_GLOBAL_CACHE_DIR='<blocks>\pkgstatus-zig-g'
export USERPROFILE='<home>'
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC='zig cc'
unset SCRIPTC_TEST_WORKERS
export WT='<blocks>/pkgstatus'
export LAB='<blocks>/pkgstatus3-lab'
export NODE22='<home>/AppData/Local/nvm/v22.18.0'
export NODE25='<home>/AppData/Local/nvm/v25.9.0'
# GNU tar (Git usr/bin) MUST precede System32; bsdtar rejects --force-local and
# the provenance lane silently falls back to the island if it wins.
export PATH="${PS_NODE:-$NODE25}:<zapo-work>/tools/zig:/c/Program Files/Git/usr/bin:/c/msys64/ucrt64/bin:$PATH"
