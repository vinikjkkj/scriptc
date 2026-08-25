#!/bin/bash
# prov2 block environment. Source before ANY build or gate.
export TMP='<blocks>\prov2\tmp'
export TEMP='<blocks>\prov2\tmp'
export TMPDIR='<blocks>\prov2\tmp'
export SCRIPTC_CACHE_DIR='<blocks>\prov2\cache'
export SCRIPTC_PROVENANCE_CACHE='<blocks>\prov2\cache\provenance'
export ZIG_GLOBAL_CACHE_DIR='<blocks>\prov2\zig'
export ZIG_LOCAL_CACHE_DIR='<blocks>\prov2\zig'
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
export npm_config_cache='<blocks>\prov2\cache\npm'
