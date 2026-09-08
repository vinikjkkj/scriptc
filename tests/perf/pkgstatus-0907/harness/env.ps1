# Block pkgstatus environment. Dot-source before ANY build/analyse/gate.
$env:TMP    = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-tmp"
$env:TEMP   = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-tmp"
$env:TMPDIR = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-tmp"
$env:SCRIPTC_CACHE_DIR        = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-cache"
$env:npm_config_cache         = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-npmcache"
$env:SCRIPTC_PROVENANCE_CACHE = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-prov"
$env:ZIG_LOCAL_CACHE_DIR      = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-zig"
$env:ZIG_GLOBAL_CACHE_DIR     = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus-zig-g"
$env:USERPROFILE = "$(if ($env:HOME_ROOT) { $env:HOME_ROOT } else { '<home>' })"
$env:SCRIPTC_TARGET = "x86_64-windows-gnu"
$env:SCRIPTC_CC = "zigcc"
$env:SCRIPTC_TEST_CC = "zig cc"
Remove-Item Env:\SCRIPTC_TEST_WORKERS -ErrorAction SilentlyContinue

# v22 to BUILD the compiler; v25.9.0 wherever an oracle is needed.
$nodeVer = if ($env:PS_NODE) { $env:PS_NODE } else { "v22.18.0" }
$nodeDir = "$(if ($env:HOME_ROOT) { $env:HOME_ROOT } else { '<home>' })\AppData\Local\nvm\$nodeVer"

$hostPath = [Environment]::GetEnvironmentVariable("PATH", "User") + ";" +
            [Environment]::GetEnvironmentVariable("PATH", "Machine")
# GNU tar (Git usr\bin) MUST precede System32: bsdtar rejects --force-local and
# the provenance lane then silently falls back to the island.
$env:PATH = (@(
  $nodeDir,
  "$(if ($env:ZAPO_WORK_ROOT) { $env:ZAPO_WORK_ROOT } else { '<zapo-work>' })\tools\zig",
  "C:\Program Files\Git\usr\bin",
  "C:\msys64\ucrt64\bin",
  "C:\Windows\System32",
  "C:\Windows",
  "C:\Windows\System32\Wbem",
  "C:\Windows\System32\WindowsPowerShell\v1.0",
  "C:\Program Files\Git\cmd"
) + ($hostPath -split ';' | Where-Object { $_ -ne '' })) -join ';'
