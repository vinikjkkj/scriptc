$env:TMP="<blocks>\mediautils-tmp"; $env:TEMP=$env:TMP; $env:TMPDIR=$env:TMP
$env:SCRIPTC_CACHE_DIR="<blocks>\mediautils-cache"; $env:npm_config_cache="<blocks>\mediautils-npmcache"
$env:SCRIPTC_PROVENANCE_CACHE="<blocks>\mediautils-prov"
$env:ZIG_LOCAL_CACHE_DIR="<blocks>\mediautils-zig"; $env:ZIG_GLOBAL_CACHE_DIR="<blocks>\mediautils-zig-g"
$env:USERPROFILE="<home>"; $env:SCRIPTC_TARGET="x86_64-windows-gnu"
$env:SCRIPTC_CC="zigcc"; $env:SCRIPTC_TEST_CC="zig cc"
Remove-Item Env:SCRIPTC_TEST_WORKERS -ErrorAction SilentlyContinue
$env:PATH="<home>\AppData\Local\nvm\v22.18.0;<zapo-work>\tools\zig;C:\Program Files\Git\usr\bin;C:\msys64\ucrt64\bin;$env:PATH"
