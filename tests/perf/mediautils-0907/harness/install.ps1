. "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-work\env.ps1"
$log = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils-work\install.log"
"ORACLE-NODE $(node --version)" | Out-File -Encoding utf8 $log
"WHICH-TAR $((Get-Command tar).Source)" | Out-File -Append -Encoding utf8 $log
"WHICH-ZIG $((Get-Command zig).Source)  $(zig version)" | Out-File -Append -Encoding utf8 $log
"PNPM $(pnpm --version)" | Out-File -Append -Encoding utf8 $log
Set-Location "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils"
& pnpm install *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== INSTALL-EXIT rc=$LASTEXITCODE ==="
Set-Location "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils\packages\compiler"
& node ..\..\node_modules\typescript5\bin\tsc -p tsconfig.json *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== TSC-COMPILER-EXIT rc=$LASTEXITCODE ==="
Set-Location "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mediautils\packages\cli"
& node ..\..\node_modules\typescript\bin\tsc -p tsconfig.json *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== TSC-CLI-EXIT rc=$LASTEXITCODE ==="
Add-Content $log "=== GATE-EXIT rc=$LASTEXITCODE ==="
