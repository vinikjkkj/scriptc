# Three-arm A/B for the provenance spec-twin selection.
#   arm "off"      -- SCRIPTC_PROVENANCE_SPEC_TWINS=off, the NULL arm. Must be
#                     site-for-site identical to the pre-fix revision. A harness
#                     that cannot report "nothing changed" cannot be trusted
#                     when it reports a change.
#   arm "on"       -- the shipped default: twins the prescan closure reached.
#   arm "twophase" -- the exact oracle the scan is validated against.
# Usage: spec-twins-ab.ps1 -drv store-sqlite -arm off -tag S-off
param(
  [Parameter(Mandatory=$true)][string]$drv,
  [Parameter(Mandatory=$true)][ValidateSet("off","on","twophase")][string]$arm,
  [Parameter(Mandatory=$true)][string]$tag,
  [string]$napp = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\pkgstatus3-lab\napp\drivers",
  [string]$harness = "$(if ($env:REPO_ROOT) { $env:REPO_ROOT } else { '<repo>' })\tests\perf\pkgstatus-0907\harness\sites.mjs"
)
. "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mongoasync\env.ps1"
$env:WT = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })/mongoasync/work"
if ($arm -eq "on") { Remove-Item Env:\SCRIPTC_PROVENANCE_SPEC_TWINS -ErrorAction SilentlyContinue }
else { $env:SCRIPTC_PROVENANCE_SPEC_TWINS = $arm }
$env:SCRIPTC_PROVENANCE_SPEC_WHY = "1"
$entry = "$napp\$drv.ts"
Set-Location $napp
$log = "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mongoasync\sites\$tag.log"
"ARM=$arm DRV=$drv node=$(node --version) zig=$(zig version) target=$env:SCRIPTC_TARGET" | Out-File -Encoding utf8 $log
node $harness $entry "$(if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { '<blocks>' })\mongoasync\sites\$tag.json" --provenance-sources *>&1 | Out-File -Append -Encoding utf8 $log
Add-Content $log "=== GATE-EXIT rc=$LASTEXITCODE ==="
