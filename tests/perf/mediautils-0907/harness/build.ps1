. "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-work\env.ps1"
$log = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-work\build1.log"
"ORACLE-NODE $(node --version)" | Out-File -Encoding utf8 $log
Set-Location "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils\packages\compiler"
& node node_modules\typescript5\bin\tsc -p tsconfig.json *>&1 | Out-File -Append -Encoding utf8 $log
$rc1 = $LASTEXITCODE
Set-Location "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils\packages\cli"
& node ..\compiler\node_modules\typescript5\bin\tsc -p tsconfig.json *>&1 | Out-File -Append -Encoding utf8 $log
$rc2 = $LASTEXITCODE
Add-Content $log "=== BUILD-EXIT rc=$rc1/$rc2 ==="
