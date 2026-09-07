. <blocks>\pkgstatus3-lab\env.ps1
$log = "<blocks>\pkgstatus3-lab\ninstall.log"
"ORACLE-NODE $(node --version)" | Out-File -Encoding utf8 $log
"NPM $(npm --version)" | Out-File -Append -Encoding utf8 $log
"NPM_CACHE $env:npm_config_cache" | Out-File -Append -Encoding utf8 $log
Set-Location <blocks>\pkgstatus3-lab\napp
npm install --no-audit --no-fund *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== INSTALL-EXIT rc=$LASTEXITCODE ==="
