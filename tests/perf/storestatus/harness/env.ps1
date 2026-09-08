# env.ps1 -- block/storestatus. Dot-source before ANY build/analyse/gate.
# Mirror of harness/env.sh. Every path derives from one root.
$root = "<blocks>\storestatus"
$env:TMP    = "$root\tmp"
$env:TEMP   = "$root\tmp"
$env:TMPDIR = "$root\tmp"
$env:SCRIPTC_CACHE_DIR        = "$root\cache"
$env:npm_config_cache         = "$root\npmcache"
$env:SCRIPTC_PROVENANCE_CACHE = "$root\prov"
$env:ZIG_LOCAL_CACHE_DIR      = "$root\zig"
$env:ZIG_GLOBAL_CACHE_DIR     = "$root\zig-g"
$env:USERPROFILE = "<home>"
$env:SCRIPTC_TARGET  = "x86_64-windows-gnu"
$env:SCRIPTC_CC      = "zigcc"
$env:SCRIPTC_TEST_CC = "zig cc"
$env:SCRIPTC_TEST_WORKERS = "3"

# v22.18.0 BUILDS the compiler; v25.9.0 is the oracle/measuring lane.
# $env:PS_NODE selects; default is the build lane.
$nodeVer = if ($env:PS_NODE) { $env:PS_NODE } else { "v22.18.0" }
$nodeDir = "<home>\AppData\Local\nvm\$nodeVer"

$hostPath = [Environment]::GetEnvironmentVariable("PATH", "User") + ";" +
            [Environment]::GetEnvironmentVariable("PATH", "Machine")
# GNU tar (Git usr\bin) MUST precede System32: bsdtar rejects --force-local and
# the provenance lane then silently falls back to the island.
$env:PATH = (@(
  $nodeDir,
  "<zapo-work>\tools\zig",
  "C:\Program Files\Git\usr\bin",
  "C:\msys64\ucrt64\bin",
  "C:\Windows\System32",
  "C:\Windows",
  "C:\Windows\System32\Wbem",
  "C:\Windows\System32\WindowsPowerShell\v1.0",
  "C:\Program Files\Git\cmd"
) + ($hostPath -split ';' | Where-Object { $_ -ne '' })) -join ';'

# The same guard the sh lane uses. It refuses on an unset or off-G: pin.
& node "$root\wt\tests\perf\storestatus\harness\guard.mjs"
if ($LASTEXITCODE -ne 0) { throw "storestatus guard refused (rc=$LASTEXITCODE)" }
