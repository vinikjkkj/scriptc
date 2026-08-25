#!/bin/bash
# prov2 block environment. Source before ANY build or gate.
export TMP='G:\blocks\prov2\tmp'
export TEMP='G:\blocks\prov2\tmp'
export TMPDIR='G:\blocks\prov2\tmp'
export SCRIPTC_CACHE_DIR='G:\blocks\prov2\cache'
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\prov2\cache\provenance'
export ZIG_GLOBAL_CACHE_DIR='G:\blocks\prov2\zig'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\prov2\zig'
export SCRIPTC_CC=zigcc
export SCRIPTC_TEST_CC="zig cc"
export SCRIPTC_TARGET=x86_64-windows-gnu
export SCRIPTC_TEST_WORKERS=2
export PATH="/g/zapo-work/tools/zig:$PATH"
export WT=/g/blocks/prov2/wt
export BASE=/g/blocks/prov2/base
export LAB=/g/blocks/prov2/lab
export NODE22="$(command -v node)"
export NODE25='C:\Users\vinicius\AppData\Local\nvm\v25.9.0\node.exe'
export NODE_EXTRA_CA_CERTS='G:\zapo-work\ca-bundle.pem'
export npm_config_cache='G:\blocks\prov2\cache\npm'
