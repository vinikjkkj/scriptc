# run-build.ps1 -Name <label> [-Prov <cacheRoot>] [-Twins off|on] [-Extra ...]
# A REAL build (analyze -> IR validate -> emit -> cc -> link), not analyze().
# The brief's rule: a closed site count is NOT a build. analyze() stops before
# ir/validate.ts and before both emitters, and a merge has already died in that
# gap. Every claim about "reaches a binary" has to come from here.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Prov = "",
  [string]$Twins = "off",
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Extra
)
. <blocks>\mongodriver\lab\env.ps1
if ($Prov -ne "") {
  if ($Prov.Substring(0, 3) -ne 'G:\' -and $Prov.Substring(0, 3) -ne 'G:/') { throw "PIN BAD: -Prov $Prov is not on G:" }
  $env:SCRIPTC_PROVENANCE_CACHE = $Prov
}
if ($Twins -eq "off") { $env:SCRIPTC_PROVENANCE_SPEC_TWINS = "off" } else { Remove-Item Env:SCRIPTC_PROVENANCE_SPEC_TWINS -ErrorAction SilentlyContinue }

$lab = "<blocks>\mongodriver\lab"
$log = "$lab\logs\build-$Name.log"
New-Item -ItemType Directory -Force "$lab\logs", "$lab\out" | Out-Null
# -o names a FILE, never a directory: given a directory it fails at LINK, after
# the whole typecheck and codegen have been paid for.
$exe = "$lab\out\$Name.exe"

"BUILD $Name" | Out-File -Encoding utf8 $log
"NODE $(node --version)" | Out-File -Append -Encoding utf8 $log
"HEAD $(git -C <blocks>\mongodriver\wt rev-parse HEAD)" | Out-File -Append -Encoding utf8 $log
"PROV $env:SCRIPTC_PROVENANCE_CACHE" | Out-File -Append -Encoding utf8 $log
"SPEC_TWINS $(if ($env:SCRIPTC_PROVENANCE_SPEC_TWINS) { $env:SCRIPTC_PROVENANCE_SPEC_TWINS } else { '(unset -> default)' })" | Out-File -Append -Encoding utf8 $log
"CC $env:SCRIPTC_CC  TARGET $env:SCRIPTC_TARGET  ZIG $(zig version)" | Out-File -Append -Encoding utf8 $log
"OUT $exe" | Out-File -Append -Encoding utf8 $log
"EXTRA $($Extra -join ' ')" | Out-File -Append -Encoding utf8 $log
"START $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log

node "$lab\harness\guard.mjs" 2>&1 | Out-File -Append -Encoding utf8 $log
if ($LASTEXITCODE -ne 0) { "GUARD REFUSED" | Out-File -Append -Encoding utf8 $log; "=== GATE-EXIT rc=99 ===" | Out-File -Append -Encoding utf8 $log; exit 99 }

node "<blocks>\mongodriver\wt\packages\cli\dist\main.js" build "$lab\napp\drivers\store-mongo.ts" -o $exe --provenance-sources @Extra *>&1 |
  Out-File -Append -Encoding utf8 $log
$rc = $LASTEXITCODE
"BUILD-RC $rc" | Out-File -Append -Encoding utf8 $log
"EXE-EXISTS $(Test-Path $exe)" | Out-File -Append -Encoding utf8 $log
if (Test-Path $exe) { "EXE-BYTES $((Get-Item $exe).Length)" | Out-File -Append -Encoding utf8 $log }
"END $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log
"C-FALLBACK $(Test-Path '<home>\.cache\scriptc')" | Out-File -Append -Encoding utf8 $log
"=== GATE-EXIT rc=$rc ===" | Out-File -Append -Encoding utf8 $log
