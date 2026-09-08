. "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus3-lab\env.ps1"
$log = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus3-lab\install.log"
"ORACLE-NODE $(node --version)" | Out-File -Encoding utf8 $log
"WHICH-TAR $((Get-Command tar).Source)" | Out-File -Append -Encoding utf8 $log
"WHICH-ZIG $((Get-Command zig).Source)  $(zig version)" | Out-File -Append -Encoding utf8 $log
"PNPM $(pnpm --version)" | Out-File -Append -Encoding utf8 $log
Set-Location "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus"
pnpm install --frozen-lockfile *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== INSTALL-EXIT rc=$LASTEXITCODE ==="
