# run-sites.ps1 -Entry <entry.ts> -OutName <name> [-Prov <root>] [-Twins off|on] [extra flags...]
# Runs the pkgstatus sites.mjs instrument against one entry, under node v25.9.0,
# with every cache pinned to G:. Writes lab/sites/<OutName>.json and
# lab/logs/<OutName>.log, ending with a GATE-EXIT sentinel so a truncated log
# is distinguishable from a killed run.
#
# -Prov and -Twins are applied AFTER env.ps1 is sourced. They used to be set by
# a caller BEFORE calling this script, and the `. env.ps1` on the first line
# silently reset them: six substitution arms all read the unpatched tree and
# reported a perfect 0-cleared/0-added, which reads exactly like "this line is
# not the cause". The log now prints PROV and SPEC_TWINS so the record carries
# what it actually used.
param(
  [Parameter(Mandatory = $true)][string]$Entry,
  [Parameter(Mandatory = $true)][string]$OutName,
  [string]$Prov = "",
  [string]$Twins = "",
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Extra
)
. <blocks>\mongodriver\lab\env.ps1

if ($Prov -ne "") {
  if (-not (Test-ScriptcPinOnG $Prov)) { throw "PIN BAD: -Prov $Prov is not on G:" }
  if (-not (Test-Path $Prov)) { throw "-Prov $Prov does not exist" }
  $env:SCRIPTC_PROVENANCE_CACHE = $Prov
}
if ($Twins -eq "off") { $env:SCRIPTC_PROVENANCE_SPEC_TWINS = "off" }
elseif ($Twins -eq "on") { Remove-Item Env:SCRIPTC_PROVENANCE_SPEC_TWINS -ErrorAction SilentlyContinue }

$lab = "<blocks>\mongodriver\lab"
$log = "$lab\logs\$OutName.log"
$out = "$lab\sites\$OutName.json"
New-Item -ItemType Directory -Force "$lab\logs", "$lab\sites" | Out-Null

"RUN $OutName" | Out-File -Encoding utf8 $log
"ENTRY $Entry" | Out-File -Append -Encoding utf8 $log
"EXTRA $($Extra -join ' ')" | Out-File -Append -Encoding utf8 $log
"NODE $(node --version)" | Out-File -Append -Encoding utf8 $log
"WT $env:WT" | Out-File -Append -Encoding utf8 $log
"HEAD $(git -C <blocks>\mongodriver\wt rev-parse HEAD)" | Out-File -Append -Encoding utf8 $log
"DIRTY $(git -C <blocks>\mongodriver\wt status --porcelain | Measure-Object -Line | Select-Object -ExpandProperty Lines) lines" | Out-File -Append -Encoding utf8 $log
"PROV $env:SCRIPTC_PROVENANCE_CACHE" | Out-File -Append -Encoding utf8 $log
"SPEC_TWINS $(if ($env:SCRIPTC_PROVENANCE_SPEC_TWINS) { $env:SCRIPTC_PROVENANCE_SPEC_TWINS } else { '(unset -> default)' })" | Out-File -Append -Encoding utf8 $log
"TAR $((Get-Command tar).Source)" | Out-File -Append -Encoding utf8 $log
"START $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log

# The guard runs FIRST and refuses if any pin is missing or off G:.
node "$lab\harness\guard.mjs" 2>&1 | Out-File -Append -Encoding utf8 $log
if ($LASTEXITCODE -ne 0) { "GUARD REFUSED rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 $log; "=== GATE-EXIT rc=99 ===" | Out-File -Append -Encoding utf8 $log; exit 99 }

node "$lab\harness\sites.mjs" $Entry $out @Extra *>&1 | Out-File -Append -Encoding utf8 $log
$rc = $LASTEXITCODE
"END $(Get-Date -Format o)" | Out-File -Append -Encoding utf8 $log
"C-FALLBACK $(Test-Path '<home>\.cache\scriptc')" | Out-File -Append -Encoding utf8 $log
"=== GATE-EXIT rc=$rc ===" | Out-File -Append -Encoding utf8 $log
