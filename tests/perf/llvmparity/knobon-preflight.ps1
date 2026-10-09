# PRE-FLIGHT for the knob-on measurement run. Costs seconds, and CAN REFUSE.
#
# The run is 45+ minutes. Every condition checked here is one that, if wrong,
# is invisible until the end -- and we have already lost 45 minutes to exactly
# that today, in a case where the gate still printed GREEN.
#
# Nothing here is checked by reading an environment variable back. A variable
# says what was set, not what the binary does with it.
#
# Exit 0 = cleared for launch. Exit 2 = refused, nothing was compiled.

$ErrorActionPreference = "Continue"
$fail = 0
function Ok   ($m) { "  PASS  $m" }
function Bad  ($m) { $script:fail++; "  FAIL  $m" }

"PREFLIGHT-START $(Get-Date -Format 'HH:mm:ss')"

# --- configuration, same shape the gate itself resolves -------------------
$Repo     = if ($env:SCRIPTC_REPO)   { $env:SCRIPTC_REPO }   else { "G:\blocks\slice-wt" }
$GateName = if ($env:GATE_NAME)      { $env:GATE_NAME }      else { "knobon-measure" }
$Blocks   = if ($env:BLOCKS_ROOT)    { $env:BLOCKS_ROOT }    else { "G:\blocks" }
$Node25   = if ($env:SCRIPTC_NODE25) { $env:SCRIPTC_NODE25 } else { "C:\Users\vinicius\AppData\Local\nvm\v25.9.0" }
$ZigDir   = if ($env:SCRIPTC_ZIG)    { $env:SCRIPTC_ZIG }    else { "G:\tools\zig" }
$WantNode = "v25.9.0"
$WantZig  = "0.16.0"

# ==========================================================================
# (1) THE SELF-TEST IS THE ENTRY GATE, not a line in the report.
#     If the instrument that will read the result cannot prove itself, the
#     run does not start. 16/16 or nothing.
# ==========================================================================
$st = & "$Node25\node.exe" "$Blocks\knobon-selftest.mjs" 2>&1 | Out-String
if ($LASTEXITCODE -eq 0 -and $st -match "SELFTEST ARMED pass=16 fail=0") {
  Ok "extractor self-test ARMED 16/16"
} else {
  Bad "extractor self-test did NOT come back ARMED 16/16 -- the reader of this run is unproven"
  ($st -split "`n" | Select-Object -Last 3) | ForEach-Object { "          $_" }
}

# ==========================================================================
# (2) TEMP ROOTS: outside the worktree, and where we think they are.
#     A TMP inside the worktree reddened a whole dispatcher in another block.
# ==========================================================================
$roots = @{
  tmp      = "$Blocks\$GateName\tmp"
  cache    = "$Blocks\$GateName\cache"
  ziglocal = "$Blocks\$GateName\zig\local"
  prov     = "$Blocks\$GateName\prov"
}
$repoFull = [System.IO.Path]::GetFullPath($Repo).TrimEnd('\')
foreach ($k in $roots.Keys | Sort-Object) {
  $p = [System.IO.Path]::GetFullPath($roots[$k]).TrimEnd('\')
  if ($p.StartsWith($repoFull, [StringComparison]::OrdinalIgnoreCase)) {
    Bad "temp root '$k' is INSIDE the worktree: $p"
  } elseif ($p -notlike "G:\*") {
    Bad "temp root '$k' is not on G: -- $p"
  } else {
    Ok "temp root '$k' outside the worktree: $p"
  }
}

# ==========================================================================
# (3) TOOLCHAIN IDENTITY, read from the BINARIES that will run.
#     There are two zigs on this host and they build size classes 20 KB
#     apart, so the version is read by executing it, and the PATH is checked
#     to make sure the other one does not win.
# ==========================================================================
$nodeExe = "$Node25\node.exe"
if (Test-Path $nodeExe) {
  $nv = (& $nodeExe -v 2>&1 | Out-String).Trim()
  if ($nv -eq $WantNode) { Ok "node $nv (from $nodeExe)" } else { Bad "node is $nv, want $WantNode" }
} else { Bad "node not found at $nodeExe" }

$zigExe = "$ZigDir\zig.exe"
if (Test-Path $zigExe) {
  $zv = (& $zigExe version 2>&1 | Out-String).Trim()
  if ($zv -eq $WantZig) { Ok "zig $zv (from $zigExe)" } else { Bad "zig is $zv, want $WantZig" }
  # Resolve zig under the PATH THE GATE WILL HAVE, not the ambient one. The
  # gate prepends $ZigDir (gate-sharded.ps1:481) and then asserts the winner,
  # so testing the shell's own PATH tests an environment that never runs --
  # and it false-refused on exactly that the first time this script ran.
  $savePath = $env:PATH
  $env:PATH = "$ZigDir;$env:PATH"
  $onPath = (Get-Command zig -ErrorAction SilentlyContinue).Source
  $env:PATH = $savePath
  if ($onPath -and ([System.IO.Path]::GetFullPath($onPath) -ne [System.IO.Path]::GetFullPath($zigExe))) {
    Bad "under the gate's own PATH a DIFFERENT zig still wins: $onPath"
  } else { Ok "under the gate's PATH the intended zig wins: $onPath" }
} else { Bad "zig not found at $zigExe" }

# ==========================================================================
# (4) DOES THE KNOB ACTUALLY REACH THE COMPILER?
#     Proven by an OBSERVABLE ARTEFACT, never by echoing the variable back.
#     A knob that is set and ignored is the signature of a knob that exists
#     on main and not in the binary, and it has caught us before.
#
#     The link is skipped on purpose -- SCRIPTC_CC is pointed at nothing, so
#     the TU is written and the link fails. We read the C, not the exe, so
#     the whole probe costs about two seconds instead of a minute.
# ==========================================================================
$probe = Join-Path ([System.IO.Path]::GetTempPath()) "knobon-preflight-probe"
Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$probe\t" | Out-Null
@'
async function f(x: number): Promise<number> {
  const y = await Promise.resolve(x + 1);
  return y * 2;
}
f(1).then((v) => console.log(v));
'@ | Set-Content -LiteralPath "$probe\p.ts" -Encoding utf8

$saveCc = $env:SCRIPTC_CC; $saveK = $env:SCRIPTC_STACKLESS
$saveTmp = $env:TMP; $saveTemp = $env:TEMP
$env:SCRIPTC_CC = "G:\nonexistent\no-such-cc.exe"   # emit the TU, fail the link
$env:TMP = "$probe\t"; $env:TEMP = "$probe\t"
$res = @{}
foreach ($arm in @("off", "on")) {
  Remove-Item -LiteralPath "$probe\p.c" -Force -ErrorAction SilentlyContinue
  # THE FIBER ARM IS "0", NOT ABSENT. The lane ships ON since 2026-10-09, so
  # removing the variable selects STACKLESS and this probe would compare the
  # lane with itself -- off and on would both report the same sc_cr_ count
  # and the preflight would conclude the knob does not work.
  if ($arm -eq "on") { $env:SCRIPTC_STACKLESS = "1" }
  else { $env:SCRIPTC_STACKLESS = "0" }
  & $nodeExe "$Repo\packages\cli\dist\main.js" build "$probe\p.ts" --backend c -o "$probe\x.exe" --keep-c *> $null
  if (Test-Path "$probe\p.c") {
    $txt = Get-Content -LiteralPath "$probe\p.c" -Raw
    $res[$arm] = ([regex]::Matches($txt, "sc_cr_")).Count
  } else { $res[$arm] = -1 }
}
$env:SCRIPTC_CC = $saveCc; $env:TMP = $saveTmp; $env:TEMP = $saveTemp
if ($saveK) { $env:SCRIPTC_STACKLESS = $saveK } else { Remove-Item Env:SCRIPTC_STACKLESS -ErrorAction SilentlyContinue }

if ($res["off"] -lt 0 -or $res["on"] -lt 0) {
  Bad "knob probe could not emit C at all (off=$($res['off']) on=$($res['on'])) -- cannot prove the knob"
} elseif ($res["off"] -ne 0) {
  Bad "knob probe: knob-OFF already emitted $($res['off']) state-machine symbols -- the knob is stuck ON"
} elseif ($res["on"] -le 0) {
  Bad "knob probe: knob-ON emitted NO state machine -- the knob does not reach this compiler"
} else {
  Ok "knob reaches the compiler: sc_cr_ symbols off=$($res['off']) on=$($res['on']) (observable artefact, both directions)"
}

# ==========================================================================
"PREFLIGHT-END fail=$fail"
if ($fail -gt 0) {
  "PREFLIGHT-REFUSED -- $fail precondition(s) wrong. NOTHING WAS COMPILED."
  exit 2
}
"PREFLIGHT-CLEARED -- safe to launch"
exit 0
