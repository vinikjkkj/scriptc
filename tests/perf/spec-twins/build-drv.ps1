# Build one napp driver and check it against the node oracle.
#   -arm off|on|twophase  selects the spec-twin selection mode (see
#   spec-twins-ab.ps1). Build-level evidence: analyze() stops before the IR
#   validator and before both emitters, so a closed site count is not a build.
param(
  [Parameter(Mandatory=$true)][string]$drv,
  [Parameter(Mandatory=$true)][string]$tag,
  [ValidateSet("off","on","twophase")][string]$arm = "on"
)
. <blocks>\mongoasync\env.ps1
$entry = "<blocks>\pkgstatus3-lab\napp\drivers\$drv.ts"
$dir   = "<blocks>\mongoasync\out\$tag"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$out   = "$dir\$drv.exe"
$log   = "<blocks>\mongoasync\out\$tag.log"
if ($arm -eq "on") { Remove-Item Env:\SCRIPTC_PROVENANCE_SPEC_TWINS -ErrorAction SilentlyContinue }
else { $env:SCRIPTC_PROVENANCE_SPEC_TWINS = $arm }
$env:SCRIPTC_PROVENANCE_SPEC_WHY = "1"
"ARM=$arm node=$(node --version) zig=$(zig version) target=$env:SCRIPTC_TARGET cc=$env:SCRIPTC_CC" | Out-File -Encoding utf8 $log
Set-Location (Split-Path $entry)
"--- SCRIPTC BUILD ---" | Out-File -Append -Encoding utf8 $log
node <blocks>\mongoasync\work\packages\cli\dist\main.js build $entry -o $out --provenance-sources *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== BUILD-EXIT rc=$LASTEXITCODE ==="
if (Test-Path $out) {
  Add-Content $log "BINARY-BYTES $((Get-Item $out).Length)"
  & $out *>&1 | Out-File -Encoding utf8 "$dir\$drv.run.out"
  Add-Content $log "=== RUN-EXIT rc=$LASTEXITCODE ==="
  # oracle: node v25 via tsx, the harness's own method
  $n25 = "<home>\AppData\Local\nvm\v25.9.0\node.exe"
  & $n25 "<blocks>\mongoasync\work\node_modules\tsx\dist\cli.mjs" $entry *>&1 | Out-File -Encoding utf8 "$dir\$drv.node.out"
  Add-Content $log "=== ORACLE-EXIT rc=$LASTEXITCODE ==="
} else { Add-Content $log "NO BINARY PRODUCED" }
