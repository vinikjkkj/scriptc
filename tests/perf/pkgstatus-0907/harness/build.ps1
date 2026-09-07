. <blocks>\pkgstatus3-lab\env.ps1
$log = "<blocks>\pkgstatus3-lab\build1.log"
"ORACLE-NODE $(node --version)" | Out-File -Encoding utf8 $log
Set-Location <blocks>\pkgstatus\packages\compiler
node node_modules/typescript5/bin/tsc -p tsconfig.json *>&1 | Out-File -Append -Encoding utf8 $log
$rc1 = $LASTEXITCODE
Set-Location <blocks>\pkgstatus\packages\cli
node ../compiler/node_modules/typescript5/bin/tsc -p tsconfig.json *>&1 | Out-File -Append -Encoding utf8 $log
$rc2 = $LASTEXITCODE
Add-Content $log "=== BUILD-EXIT rc=$rc1/$rc2 ==="
