# The LLVM refusal census over zapo-js 1.8.2 (`tests/perf/zapo-rest/app182`).
#
# WHY THIS EXISTS. A build reports its FIRST refusal and stops, so
# `llvm refused: weakmap:intrinsic` is a lower bound of one: nothing behind
# it is knowable from the build log. SCRIPTC_LLVM_CENSUS=1 attempts every
# statement and every function inside a recovery boundary and collects the
# whole set, then rethrows the first refusal so the build still fails exactly
# as it would have. A census run NEVER yields a linkable artifact -- that is
# by design (backend/llvm/unsupported.ts), not a limitation of this script.
#
# SELF-TEST BEFORE YOU TRUST IT. Run with -SelfTest to see the harness report
# the expected NULL (tests/corpus/001-hello.ts: no census lines, a .ll and no
# .c, rc=0) and then a known POSITIVE (7782: weakmap:new + weakmap:intrinsic,
# a .c and no .ll). A harness that cannot report "nothing here" cannot be
# trusted when it reports something.
#
# The lane is read OFF THE ARTIFACT -- a .ll means the LLVM tier, a .c means
# the build demoted -- never off the absence of a refusal message.

param(
  [switch]$SelfTest,
  [string]$OutRoot = "<blocks>\llvmparity"
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $repo
. "$PSScriptRoot\env.ps1"

$env:SCRIPTC_LLVM_CENSUS = "1"
$cli = "packages\cli\dist\main.js"

function Invoke-Probe {
  param([string]$Entry, [string]$OutDir, [string]$Exe, [string[]]$Extra = @())
  if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  $log = Join-Path $OutDir "build.log"
  # -o names a FILE, not a directory. A directory here fails at LINK, after
  # the whole build has already been paid for.
  $cargs = @("build", $Entry, "-o", (Join-Path $OutDir $Exe), "--keep-c") + $Extra
  & node $cli @cargs *>&1 | Tee-Object -FilePath $log
  $rc = $LASTEXITCODE
  $ll = @(Get-ChildItem $OutDir -Filter *.ll -ErrorAction SilentlyContinue).Count
  $c  = @(Get-ChildItem $OutDir -Filter *.c  -ErrorAction SilentlyContinue).Count
  $lane = if ($ll -gt 0 -and $c -eq 0) { "LLVM tier (.ll, no .c)" }
          elseif ($c -gt 0 -and $ll -eq 0) { "DEMOTED to C (.c, no .ll)" }
          elseif ($c -gt 0 -and $ll -gt 0) { "MIXED (.ll AND .c) -- investigate" }
          else { "n/a -- no artifact emitted (not 0)" }
  Write-Output ""
  Write-Output ("ARTIFACT-LANE  " + $lane + "   [.ll=" + $ll + " .c=" + $c + "]  rc=" + $rc)
  Write-Output ("LOG            " + $log)
}

if ($SelfTest) {
  Write-Output "===== NULL CONTROL: tests/corpus/001-hello.ts ====="
  Write-Output "expect: no SCRIPTC_LLVM_CENSUS lines, .ll and no .c, rc=0"
  Invoke-Probe "tests\corpus\001-hello.ts" "$OutRoot\probe\null" "hello.exe"
  Write-Output ""
  Write-Output "===== POSITIVE CONTROL: tests/corpus/7782-weakmap-uint8array-identity-keys.ts ====="
  Write-Output "expect: weakmap:new + weakmap:intrinsic, .c and no .ll"
  Invoke-Probe "tests\corpus\7782-weakmap-uint8array-identity-keys.ts" "$OutRoot\probe\pos" "w.exe"
  exit 0
}

Write-Output "===== CENSUS: tests/perf/zapo-rest/app182 (zapo-js 1.8.2) ====="
# --provenance-sources is REQUIRED: @zapo-js/store-sqlite is only compilable
# from its attested source. STRICT -- no --best-effort, which would defer
# per-statement refusals into runtime throws and make the count a lie.
Invoke-Probe "tests\perf\zapo-rest\app182\zapo-rest.ts" "$OutRoot\out182" `
             "zapo-rest-182.exe" @("--provenance-sources")
Write-Output "===== CENSUS DONE ====="
