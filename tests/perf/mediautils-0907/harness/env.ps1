$env:TMP="$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-tmp"; $env:TEMP=$env:TMP; $env:TMPDIR=$env:TMP
$env:SCRIPTC_CACHE_DIR="$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-cache"; $env:npm_config_cache="$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-npmcache"
$env:SCRIPTC_PROVENANCE_CACHE="$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-prov"
$env:ZIG_LOCAL_CACHE_DIR="$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-zig"; $env:ZIG_GLOBAL_CACHE_DIR="$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-zig-g"
$env:USERPROFILE="$(if ($env:HOME_ROOT) { $env:HOME_ROOT } else { '<home>' })"; $env:SCRIPTC_TARGET="x86_64-windows-gnu"
$env:SCRIPTC_CC="zigcc"; $env:SCRIPTC_TEST_CC="zig cc"
Remove-Item Env:SCRIPTC_TEST_WORKERS -ErrorAction SilentlyContinue
$env:PATH="$(if ($env:HOME_ROOT) { $env:HOME_ROOT } else { '<home>' })\AppData\Local\nvm\v22.18.0;$(if ($env:ZAPO_WORK_ROOT) { $env:ZAPO_WORK_ROOT } else { '<zapo-work>' })\tools\zig;C:\Program Files\Git\usr\bin;C:\msys64\ucrt64\bin;$env:PATH"
