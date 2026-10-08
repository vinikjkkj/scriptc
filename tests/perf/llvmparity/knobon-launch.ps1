# LAUNCH the knob-on measurement run, end to end.
#
# Order matters and is not negotiable:
#   pre-flight (seconds, CAN REFUSE)  ->  gate (45+ min)  ->  extract (seconds)
#
# The pre-flight runs FIRST and a refusal stops everything, because every
# condition it checks is one that would otherwise be discovered at minute 45
# -- and in the case that cost us that today, the gate still printed GREEN.
#
# The run has TWO products, and the second is not optional:
#   A  the named failure list
#   B  the extractor's own validation, via cross-check against each shard's
#      "Test Files" / "Tests" summary lines
# If B refuses, A is void. The exit code carries that, it is not a reading.

$ErrorActionPreference = "Continue"
$Blocks   = if ($env:BLOCKS_ROOT) { $env:BLOCKS_ROOT } else { "G:\blocks" }
$GateName = "knobon-measure"
$Node25   = if ($env:SCRIPTC_NODE25) { $env:SCRIPTC_NODE25 } else { "C:\Users\vinicius\AppData\Local\nvm\v25.9.0" }

$env:SCRIPTC_REPO = "G:\blocks\slice-wt"
$env:GATE_NAME    = $GateName
$env:BLOCKS_ROOT  = $Blocks

"KNOBON-LAUNCH $(Get-Date -Format 'HH:mm:ss')"
"=== (1) PRE-FLIGHT ==="
& "$Blocks\knobon-preflight.ps1"
if ($LASTEXITCODE -ne 0) {
  "KNOBON-LAUNCH ABORTED: pre-flight refused. The 45 minutes were not spent."
  exit 2
}

"=== (2) GATE (knob ON, lane C) ==="
$gateOut = & "$Blocks\knobon-measure-gate.ps1" 2>&1
$gateRc  = $LASTEXITCODE
$gateOut | ForEach-Object { $_ }

# --- find the run's own log directory, from the gate's own line ----------
$logDir = $null
foreach ($l in $gateOut) {
  if ("$l" -match "GATE-EXIT .*logs=(.+?)\s*$") { $logDir = $Matches[1].Trim() }
}
if (-not $logDir) {
  $cand = Get-ChildItem "$Blocks\$GateName\logs" -Directory -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime | Select-Object -Last 1
  if ($cand) { $logDir = $cand.FullName }
}
if (-not $logDir -or -not (Test-Path $logDir)) {
  "KNOBON-RESULT VOID: no log directory -- gate rc=$gateRc, nothing to read."
  exit 2
}
"logDir=$logDir  gateRc=$gateRc"

# --- expected-files comes from THIS RUN's PARTITION line, never memory ---
# The killed 09:10 run said 214 and the current tree says 216. A remembered
# number would satisfy the guard while two files went unrun.
$partition = $null
$g5 = Join-Path $logDir "gate5.log"
if (Test-Path $g5) {
  foreach ($l in Get-Content $g5) {
    if ($l -match "PARTITION expected-files=(\d+)") { $partition = [int]$Matches[1] }
  }
}
if (-not $partition) {
  "KNOBON-RESULT VOID: no PARTITION line in $g5 -- the expected file count is unknown,"
  "and a guard fed a remembered number is not a guard."
  exit 2
}
"expected-files=$partition (read from this run's PARTITION line)"

"=== (3) PRODUCTS A AND B ==="
& "$Node25\node.exe" "$Blocks\knobon-names.mjs" $logDir --expect-shards=6 --expect-files=$partition
$exRc = $LASTEXITCODE

""
switch ($exRc) {
  0 { "KNOBON-VERDICT COMPLETE-CLEAN (gate rc=$gateRc)" }
  1 { "KNOBON-VERDICT COMPLETE-WITH-FAILURES -- the named list above is Product A (gate rc=$gateRc)" }
  default {
    "KNOBON-VERDICT VOID -- the run is incomplete or the two instruments disagree."
    "No failure list is published from this run. Fix the reader and re-read the"
    "same artefacts; a re-run is not required."
  }
}
"KNOBON-LAUNCH-EXIT extractor=$exRc gate=$gateRc $(Get-Date -Format 'HH:mm:ss')"
exit $exRc
