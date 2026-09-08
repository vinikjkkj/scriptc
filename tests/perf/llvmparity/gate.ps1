# The regression gate for block `llvmparity`, run DETACHED.
#
# WHY DETACHED. A long foreground call is killed at a turn boundary and its
# workers are orphaned onto a dead pipe -- the run keeps burning cores and
# its result is unreadable. That happened once here (exit 127, a 0-byte log,
# two vitest processes still alive 45 minutes later). Launch with
# Start-Process -WindowStyle Hidden and redirect to files; the log is then
# the record, not the terminal.
#
# GATE LANE IS NODE v25.9.0, and that is not cosmetic: the differential
# spawns a BARE `node` as its oracle, so whichever node is first on PATH IS
# the oracle. Builds are pinned to v22 by env.ps1; this file overrides for
# the gate only.
#
# The suites, and why each one:
#   llvm-runtime-abi   every literal `declare @scr_*` in the LLVM backend is
#                      checked against the prototype in scr_runtime.h. A .ll
#                      declare is taken on faith by the linker, so a
#                      mismatch is silent UB. This is the suite that covers
#                      the scr_weak_* declares added for WeakMap.
#   llvm-differential  the LLVM lane's own corpus comparison.
#   differential       all ~1867 corpus programs, each run under Node AND as
#                      a native binary, stdout/stderr/exit-code byte-exact.
#                      This is the regression gate for a shared-path change
#                      like the union-truthiness set.

param([string]$LogDir = "<blocks>\llvmparity\gate")

$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
Set-Location $repo
. "$PSScriptRoot\env.ps1"
Remove-Item Env:\SCRIPTC_LLVM_CENSUS -ErrorAction SilentlyContinue
$env:PATH = "<home>\AppData\Local\nvm\v25.9.0;" + $env:PATH

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }
Write-Output ("gate oracle node = " + (& node --version))

$suites = @(
  @{ n = "abi";   p = "packages/compiler/test/llvm-runtime-abi.test.ts" },
  @{ n = "llvmd"; p = "tests/harness/llvm-differential.test.ts" },
  @{ n = "diff";  p = "tests/harness/differential.test.ts" }
)

foreach ($s in $suites) {
  $log = Join-Path $LogDir ($s.n + ".log")
  Write-Output ("===== " + $s.n + " : " + $s.p + " =====")
  & npx vitest run $s.p --reporter=dot *>&1 | Tee-Object -FilePath $log | Out-Null
  $rc = $LASTEXITCODE
  $line = (Select-String -Path $log -Pattern '^\s+Tests\s' | Select-Object -Last 1).Line
  Write-Output ("  rc=" + $rc + "  " + $line)
}
# The sentinel. A truncated log is a killed turn, not a clean pass, so a
# reader must require this line rather than infer success from silence.
Write-Output "===== GATE-EXIT ====="
