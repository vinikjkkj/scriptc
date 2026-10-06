# ============================================================================
#  gate-sharded.ps1 - the six-shard merge gate.
#
#  THE LOGIC LIVES HERE; the host paths do not. Deploy a wrapper that sets the
#  environment below and invokes this file, and point the scheduled task at the
#  wrapper:
#
#      # <blocks>\<gate-name>\gate.ps1
#      $env:BLOCKS_ROOT     = "<blocks>"
#      $env:GATE_NAME       = "<gate-name>"
#      $env:SCRIPTC_REPO    = "<repo>"
#      $env:SCRIPTC_ZIG     = "<tools>\zig"
#      $env:SCRIPTC_NODE25  = "<home>\AppData\Local\nvm\v25.9.0"
#      $env:SCRIPTC_GIT_USR = "<git>\usr\bin"
#      & "$env:SCRIPTC_REPO\scripts\gate-sharded.ps1" @args
#      exit $LASTEXITCODE
#
#  WHY THE SPLIT. The previous gate and its sibling were both kept outside git
#  and both were lost in one disk cleanup on 2026-10-05, along with the
#  directory they had been preserved into. A copy outside version control is
#  not a backup, it is a second thing to lose. What is host-specific is eight
#  lines; what is expensive is everything below, and it is in here now.
#
#  (The gate reads its own script out of the repository it gates. That is an
#  instrument inside its own subject: a revision that breaks this file breaks
#  the gate rather than failing it. The wrapper can copy this file out first if
#  that ever matters; today it does not, because the gate is run by hand or by
#  a timer against a tree someone already intends to merge.)
#
#  RECONSTRUCTED 2026-10-05 from the specification of the lost original. Every
#  rule below is here because it was paid for once.
#
#  WHAT THIS FILE REFUSES TO DO, and why each refusal is load-bearing:
#
#   1. It does not start before it says so. GATE5-START is written to a FIXED
#      path as the first executable statement after the configuration is
#      resolved, before Set-Location, before any env, before any dot-source.
#      Without it, "the task never fired" and "the task fired and died in the
#      preamble" produce the same evidence: nothing.
#
#   2. It does not trust its own verdict function. Five controls run BEFORE any
#      compiling: planted failures must read RED (sensitivity) and clean logs
#      must read GREEN (specificity). The specificity controls are not
#      decorative - Select-String is case-insensitive by default and this suite
#      has PASSING test names reading "a failed check is CATCHABLE", "a reached
#      class-instance for-in fails the build" and "0xC0000142
#      STATUS_DLL_INIT_FAILED". A whole-log grep for "fail" calls a green gate
#      red, which is how a gate stops being believed.
#
#      PROVED, not asserted: a clone of this file whose Get-ShardVerdict always
#      answers GREEN fails 3 of the 5 controls and aborts with rc=2 before
#      compiling a line. A comparator that cannot be wrong proves nothing when
#      it is right.
#
#   3. It does not read the whole log. Only the vitest SUMMARY lines decide,
#      ANSI stripped, matched CASE-SENSITIVELY.
#
#   4. It does not ask vitest which files a shard owns. `vitest list --shard`
#      IGNORES the flag and answers the full list for every shard, so a
#      partition check built on it is green by construction and proves nothing.
#      MEASURED 2026-10-05, not remembered: --shard=1/6, 2/6 and 5/6 each
#      answered 213 files - the same 213 `list --filesOnly` answers with no
#      shard at all, and the same 213 the glob below produces, which is what
#      makes the partition check meaningful rather than merely present.
#
#   5. It does not inherit its build lane. SCRIPTC_TARGET and the zig install
#      are pinned and then ASSERTED. On 2026-10-05 a block measured the static
#      size anchor host-native, read +8,192 against a figure recorded in the
#      CROSS lane, and opened a regression hunt on a merge that had not grown a
#      byte. The two zig installs on that host differ by 13,312 bytes on the
#      same tree, and the older one is FIRST on the default PATH, so a lane gets
#      chosen by accident unless it is chosen on purpose. lab/env.sh pins the
#      same lane; tests/harness/size-class.ts records the measurement.
#
#   6. It does not purge node_modules/.cache/scriptc-tests between shards. The
#      previous version did, which made every shard recompile from scratch for
#      nothing: vitest's globalSetup already runs pruneScratchOnce once per
#      invocation - once per shard - and the sledgehammer destroyed the very
#      tree that LRU administers. SCRIPTC_TEST_SCRATCH_MAX_MB bounds it instead.
#
#   7. It does not run the neighbours out of disk. Below the floor it aborts,
#      before the first shard and between every pair.
#
#  THE ONE RERUNNABLE SIGNATURE, and the two limits that keep it honest.
#
#  A red shard is a wrong answer until proven otherwise, and this gate does not
#  rerun to chase green. Exactly one signature is environmental rather than a
#  verdict:
#
#      CcCompileError  with ZERO `error:` lines anywhere in the shard log.
#
#  WHY IT IS SAFE TO RERUN. A real codegen defect ALWAYS prints a compiler
#  error - that is what "generated C should always compile" means when it
#  fails. So this signature cannot hide one: the moment a genuine defect
#  appears, `error:` appears with it and the signature no longer matches. It is
#  narrow by construction, not by promise.
#
#  WHAT IT COVERS, all of them environment and all seen on this host: zig
#  exiting nonzero with no diagnostic, another process holding the TU open, and
#  disk pressure. None of the three is a statement about the tree.
#
#  OBSERVED 2026-10-05 on 3701-array-literal-element-release-scope.ts, shard
#  2/6. The summary line names a differential test and reads like a behavioural
#  red; the program never ran. Isolated, it compiled and matched node BYTE FOR
#  BYTE on both the branch and its merge-base, and the same case passed on
#  retest in this gate's own lane. Read the DETAIL, not the test name.
#
#   LIMIT 1 - ONE RERUN, NOT A LOOP. The same signature twice in a row on the
#   same revision is no longer transient: it is an environment problem to
#   diagnose, most likely disk or concurrency. Stop and look; do not spin.
#
#   LIMIT 2 - THE RERUN IS LOGGED AS A RERUN, naming the signature that
#   justified it. A gate that reruns in silence produces a 6/6 nobody can audit
#   afterwards, which costs more than the red it hid.
#
#  AND THE WHOLE GATE RERUNS, never the one red shard. The contract is six
#  greens in ONE run; patching a single shard's result into a previous run's
#  five weakens precisely the thing that makes the verdict worth having.
#
#  -DryRun runs the whole preamble, the controls, the lane assertions and the
#  expected-file glob, then puts TWO cheap test files through the exact
#  Start-Process / log / JSON / verdict plumbing the shards use. It is a dress
#  rehearsal in about twenty seconds; the scheduled task passes no arguments and
#  so always takes the real path.
# ============================================================================
param([switch]$DryRun)

# ---------------------------------------------------------------------------
# (1) THE SENTINEL. First executable statement.
# ---------------------------------------------------------------------------
# CONFIGURATION, in the form lab/env.sh established: every host path arrives
# through the environment and the fallback is a PLACEHOLDER that cannot work.
# A placeholder left in place is refused BY NAME below, so a misdeployment says
# which variable it wants instead of building against nothing.
#
# Resolving these is the ONE thing that precedes the sentinel, and it has to be:
# an unconfigured gate does not know where its log goes, so it cannot leave one.
# Everything that can fail after this point leaves a GATE5-START behind, which
# is the whole distinction the sentinel exists to draw.
$BlocksRoot = if ($env:BLOCKS_ROOT)     { $env:BLOCKS_ROOT }     else { "<blocks>" }
$GateName   = if ($env:GATE_NAME)       { $env:GATE_NAME }       else { "<gate-name>" }
$Repo       = if ($env:SCRIPTC_REPO)    { $env:SCRIPTC_REPO }    else { "<repo>" }
$ZigDir     = if ($env:SCRIPTC_ZIG)     { $env:SCRIPTC_ZIG }     else { "<tools>\zig" }
$NodeDir    = if ($env:SCRIPTC_NODE25)  { $env:SCRIPTC_NODE25 }  else { "<home>\AppData\Local\nvm\v25.9.0" }
$GitUsrBin  = if ($env:SCRIPTC_GIT_USR) { $env:SCRIPTC_GIT_USR } else { "<git>\usr\bin" }
$ZigWant    = if ($env:SCRIPTC_ZIG_VERSION)  { $env:SCRIPTC_ZIG_VERSION }  else { "0.16.0" }
$NodeWant   = if ($env:SCRIPTC_NODE_VERSION) { $env:SCRIPTC_NODE_VERSION } else { "v25.9.0" }

$unset = @()
foreach ($pair in @(@("BLOCKS_ROOT", $BlocksRoot), @("GATE_NAME", $GateName), @("SCRIPTC_REPO", $Repo),
                    @("SCRIPTC_ZIG", $ZigDir), @("SCRIPTC_NODE25", $NodeDir), @("SCRIPTC_GIT_USR", $GitUsrBin))) {
  if ($pair[1] -like "*<*") { $unset += $pair[0] }
}
if ($unset.Count -gt 0) {
  [Console]::Error.WriteLine("gate-sharded.ps1: unconfigured, set: " + ($unset -join ", "))
  [Console]::Error.WriteLine("gate-sharded.ps1: deploy a wrapper that sets them and invokes this file - see the header")
  exit 2
}

$GateRoot = Join-Path $BlocksRoot $GateName
$LastLog  = Join-Path $GateRoot "gate-last.log"
$RunId    = Get-Date -Format "yyyyMMdd-HHmmss"
try { New-Item -ItemType Directory -Force -Path $GateRoot | Out-Null } catch { }
# THE SENTINEL GOES TO THE PER-RUN PATH FIRST, AND APPENDS TO THE SHARED ONE.
#
# It used to be Set-Content -- an EXCLUSIVE write -- to one fixed path. Any
# reader holding that file made the write fail, and it failed on two
# consecutive runs because a `tail -f` was watching it. The damage is worse
# than a missing line: while it fails, gate-last.log still shows an OLDER
# RUN, so a file that is supposed to say "a run started" instead describes a
# different run entirely. A waiter polling it fired within seconds on a
# stale GATE-EXIT and nearly reported the previous gate's verdict as this
# candidate's. That is the same family as head= not seeing uncommitted
# edits: a witness that lies about what it witnessed.
#
# So the authority is the per-runId file, which no one else can hold because
# its name did not exist until now, and the shared file is a convenience
# APPENDED to -- a reader can no longer disarm it, and a failure to write it
# can no longer take the sentinel with it.
$LogDir   = Join-Path $GateRoot "logs\$RunId"
try { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null } catch { }
$StartLine = "{0} GATE5-START runId={1} pid={2} dryRun={3} script={4}" -f
  (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $RunId, $PID, [bool]$DryRun, $PSCommandPath
Set-Content -LiteralPath (Join-Path $LogDir "gate5.log") -Encoding utf8 -Value $StartLine
try { Add-Content -LiteralPath $LastLog -Encoding utf8 -Value $StartLine } catch {
  [Console]::Out.WriteLine("GATE5-WARN shared gate-last.log is held by another process; the per-run log is authoritative")
}

$ErrorActionPreference = "Stop"
# Six is the contract. The override exists so the MID-RUN tree-hash abort can
# be armed without paying a full run: that branch lives at the top of the
# shard loop and needs two real boundaries to fire, which -DryRun cannot give
# (it returns before the loop). A high count makes each shard a handful of
# files, so a real second boundary arrives in minutes. Unset everywhere that
# matters; a merge verdict is still six.
$Shards        = if ($env:GATE_SHARDS) { [int]$env:GATE_SHARDS } else { 6 }
$ShardContract = 6
# Twelve is the contract, by the user's standing rule. It gets the same
# treatment as the shard count for the same reason: a configuration that can
# change in silence produces a green that looks like the green that counts.
# The override exists so 3-vs-12 can be A/B'd, and like GATE_SHARDS it takes
# the run OFF CONTRACT -- a timing experiment must not be able to print a
# mergeable verdict.
#
# The pin lives HERE and not in the wrapper on purpose: the script sets
# SCRIPTC_TEST_WORKERS itself, so a wrapper value is silently overwritten and
# would only mislead (the wrapper says so in a comment).
$Workers        = if ($env:GATE_WORKERS) { [int]$env:GATE_WORKERS } else { 12 }
$WorkerContract = 12
$OffContract   = ($Shards -ne $ShardContract) -or ($Workers -ne $WorkerContract)
$DiskFloorGB = 10
$ExitRc      = 1
$DiskFloorBreached = $false
$Started     = Get-Date

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$MainLog = Join-Path $LogDir "gate5.log"

# Logging must never touch the PIPELINE. Invoke-Judged both logs and returns a
# value, so a Write-Output here prepends every log line to that return value:
# `$r = Invoke-Judged ...` captures them, and RUN-START, RUN-WARN and FAILLINE
# vanish from stdout. They still reach both log files, which is why the
# 2026-10-05 run lost nothing - but PowerShell member enumeration is what makes
# the rest work ($r.Green resolves through the array in BOTH the true and the
# false branch, measured), and the verdict of a gate must not rest on that.
# Console.Out writes past the pipeline entirely.
# ---------------------------------------------------------------------------
# THE WORKING-TREE HASH, and why HEAD was never enough.
# ---------------------------------------------------------------------------
# On 2026-10-06 this gate reported head=f457649d7 verdict=GREEN for all six
# shards while shards 4, 5 and 6 read a tree that had been edited under them:
# liveness.ts changed 11 seconds after shard 4 started, a harness test 13
# seconds after shard 5 started. Nothing went red. Nothing could: an
# UNCOMMITTED EDIT NEVER MOVES HEAD, so the pointer the gate printed stayed
# correct the whole time while the content it measured was a tree that has
# never existed as a commit. vitest aliases SOURCE, not dist, so the edits
# were live immediately.
#
# A verdict that cannot distinguish the tree it measured from the tree it
# claims to have measured is not a verdict. So the gate now hashes CONTENT at
# every shard boundary and refuses to continue if it moved.
#
# The hash covers HEAD, the full diff of every tracked modification, and the
# porcelain status including untracked paths. It does NOT cover the CONTENT of
# untracked files -- only their presence -- which is a known and stated gap,
# not an oversight.
# WHICH tree, as opposed to WHETHER it moved. The content hash proves the
# tree did not change under the run; it cannot say which directory produced
# it, because two clean worktrees at the same commit hash identically -- and
# that is correct behaviour, not a defect. On 2026-10-06 a wrapper edit meant
# to repoint SCRIPTC_REPO silently did not match, and only a dry run printing
# the path revealed that the gate was still reading the old worktree. A
# comment in the wrapper states intent; the log has to carry the witness.
# A RUN OFF THE CONTRACT MAY NOT PRINT A MERGEABLE VERDICT.
#
# Making $Shards overridable opened the same hole the `head=` line was: a
# word that looks like it says what was measured and does not. Six shards of
# 36 files and sixty of four both end in GREEN, and nothing in the text
# separates them. The partition cannot help -- expected=214 ran=214 is
# equally true either way, since every file still runs exactly once. Only the
# count distinguishes them, so only the count can be the guard.
#
# Structural rather than documented: off the contract the word GREEN is never
# produced at all. Both verdict sites go through this one function, so the
# cheap dry-run path exercises the same code the real path uses.
function VerdictWord([bool]$green) {
  if ($OffContract) { return "NOT-MERGEABLE" }
  if ($green) { return "GREEN" }
  return "RED"
}

function RepoRealPath {
  # Normalise FIRST: ResolveLinkTarget throws on a path it considers
  # malformed (a trailing "/." is enough), and a witness that can abort the
  # run it is witnessing is worse than no witness. Never throws; the worst
  # case is the normalised path without link resolution.
  $full = $Repo
  try { $full = [System.IO.Path]::GetFullPath($Repo) } catch {}
  try {
    $t = [System.IO.Directory]::ResolveLinkTarget($full, $true)
    if ($t) { return $t.FullName }
  } catch {}
  return $full
}

function WorkTreeHash {
  $acc = (& git rev-parse HEAD) + "~" + (((& git diff HEAD) -join "~")) + "~" + (((& git status --porcelain -uall) -join "~"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $raw = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($acc))
  return ([System.BitConverter]::ToString($raw)).Replace("-", "").Substring(0, 16).ToLower()
}

function Say([string]$m) {
  $line = "{0} {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Add-Content -LiteralPath $MainLog -Value $line
  # The shared file is a convenience, never the authority: a reader holding
  # it must not be able to stop the run or truncate the real log.
  try { Add-Content -LiteralPath $LastLog -Value $line } catch { }
  [Console]::Out.WriteLine($line)
}

function FreeGB { [math]::Round((Get-PSDrive -Name G).Free / 1GB, 2) }

# ---------------------------------------------------------------------------
# (3) THE VERDICT. Summary lines only, ANSI stripped, CASE-SENSITIVE.
#
# A run is GREEN iff: the process exited 0, it printed BOTH summary lines,
# neither names a failure, and vitest reported no Errors block. A log that
# stops before the summary is RED - that is the truncated-log shape, and a run
# that never summarised has not passed, it has disappeared.
# ---------------------------------------------------------------------------
function Get-ShardVerdict {
  param([string[]]$Lines, [int]$Rc)

  $clean = @($Lines | ForEach-Object { $_ -replace "\x1b\[[0-9;?]*[ -/]*[@-~]", "" })

  $tf = @($clean | Where-Object { $_ -cmatch '^\s*Test Files\s{2,}\S' })
  $tt = @($clean | Where-Object { $_ -cmatch '^\s*Tests\s{2,}\S' })
  $er = @($clean | Where-Object { $_ -cmatch '^\s*Errors\s{2,}\S' })
  $nf = @($clean | Where-Object { $_ -cmatch 'No test files found' })

  if ($nf.Count -gt 0) { return @{ Green = $false; Why = "vitest found no test files" } }
  if ($tf.Count -eq 0) { return @{ Green = $false; Why = "no 'Test Files' summary line - the run never summarised" } }
  if ($tt.Count -eq 0) { return @{ Green = $false; Why = "no 'Tests' summary line - the run never summarised" } }

  # CASE-SENSITIVE on purpose. vitest writes "failed" in the summary; the
  # passing test NAMES above it write "failed", "failure", "fails" and
  # "FAILED", and none of those are in these two lines.
  $bad = @(($tf + $tt) | Where-Object { $_ -cmatch 'failed' })
  if ($bad.Count -gt 0) { return @{ Green = $false; Why = "summary names a failure: " + ($bad -join " / ") } }
  if ($er.Count -gt 0)  { return @{ Green = $false; Why = "vitest reported errors: " + ($er -join " / ") } }
  if ($Rc -ne 0)        { return @{ Green = $false; Why = "exit code $Rc with a clean summary" } }

  return @{ Green = $true; Why = ($tf[-1].Trim() + " ; " + $tt[-1].Trim()) }
}

# ---------------------------------------------------------------------------
# One judged vitest invocation: hidden, PID recorded BEFORE the wait, verdict
# from the summary lines, file list from the JSON report. The shards and the
# dry-run probe share it so the rehearsal exercises the real plumbing.
# ---------------------------------------------------------------------------
function Invoke-Judged {
  param([string]$Tag, [string[]]$ExtraArgs)

  $out  = Join-Path $LogDir "$Tag.log"
  $err  = Join-Path $LogDir "$Tag.err"
  $json = Join-Path $LogDir "$Tag.json"
  # The rhythm instrument, ABSENT unless SCRIPTC_RPC_RHYTHM names a directory.
  # It must go on the COMMAND LINE rather than in vitest.config.ts: the
  # --reporter flags below are CLI, and CLI reporters override config ones
  # entirely, so a conditional in the config would be silently ignored here.
  $rhythm = if ($env:SCRIPTC_RPC_RHYTHM) {
    @("--reporter=./tests/harness/rpc-rhythm-reporter.ts")
  } else { @() }
  $argv = @("node_modules\vitest\vitest.mjs", "run") + $ExtraArgs +
          @("--max-workers=$Workers", "--min-workers=1",
            "--reporter=default", "--reporter=json", "--outputFile.json=$json") + $rhythm

  $t0 = Get-Date
  $p  = Start-Process -FilePath "node" -ArgumentList $argv -WorkingDirectory $Repo `
        -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $null = $p.Handle   # cache the handle, or ExitCode reads back empty
  Say ("RUN-START tag={0} pid={1} args={2}" -f $Tag, $p.Id, ($ExtraArgs -join " "))
  # ---- THE DISK FLOOR, CONTINUOUS, TRACKING THE TROUGH --------------------
  #
  # It used to be checked only at the TOP of the shard loop, which means it
  # did not exist for the duration of a shard: during the knob-on pass free
  # space fell at ~0.7 GB/min with 0/6 closed, so the next boundary check was
  # twenty minutes away and the floor could not have fired before the disk
  # went through 15 and 10. A floor evaluated once per iteration is absent
  # for that iteration.
  #
  # IT TRACKS THE MINIMUM, NOT A RATE. Free space is a SAWTOOTH -- the
  # scratch pruner gives space back between shards -- so a two-point rate
  # measures whichever segment it happened to catch: 14.5 GB/h fitted across
  # a burst, against ~4 GB/h net over a longer window, on the same run. The
  # quantity that can actually breach a floor is the trough reached inside
  # the shard, so that is what is sampled and reported.
  $trough = FreeGB
  $sampled = $false
  while (-not $p.HasExited) {
    Start-Sleep -Seconds 10
    $f = FreeGB
    if ($f -lt $trough) { $trough = $f }
    if ($f -lt $DiskFloorGB) {
      Say ("GATE5-ABORT reason=disk-floor-continuous tag={0} free={1}GB floor={2}GB trough={3}GB" -f $Tag, $f, $DiskFloorGB, $trough)
      Say ("GATE5-ABORT detail: the floor is now checked DURING the shard, not only at its boundary. The run is stopped with the subject still on disk rather than after it fills.")
      try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
      $script:DiskFloorBreached = $true
      break
    }
    # The pool observation rides the same loop: one sample, once settled.
    if (-not $sampled -and ((Get-Date) - $t0).TotalSeconds -ge 45) {
      $sampled = $true
      try {
        $seen = @(); $q = New-Object System.Collections.Queue; $q.Enqueue($p.Id)
        while ($q.Count -gt 0) {
          $cur = $q.Dequeue(); $seen += $cur
          foreach ($k in (Get-CimInstance Win32_Process -Filter "ParentProcessId=$cur" -ErrorAction SilentlyContinue)) { $q.Enqueue($k.ProcessId) }
        }
        Say ("WORKERS-OBSERVED tag={0} pinned={1} descendants={2} (observation, not a refusal)" -f $Tag, $Workers, (@($seen).Count - 1))
      } catch { Say ("WORKERS-OBSERVED tag={0} sample-failed: {1}" -f $Tag, $_.Exception.Message) }
    }
  }
  $p.WaitForExit()
  Say ("DISK-TROUGH tag={0} trough={1}GB floor={2}GB" -f $Tag, $trough, $DiskFloorGB)
  $rc  = $p.ExitCode
  $min = [math]::Round(((Get-Date) - $t0).TotalMinutes, 2)

  $lines = @()
  if (Test-Path $out) { $lines += Get-Content -LiteralPath $out }
  if (Test-Path $err) { $lines += Get-Content -LiteralPath $err }
  $v = Get-ShardVerdict -Lines $lines -Rc $rc

  $ran = @()
  if (Test-Path $json) {
    try {
      $rep = Get-Content -LiteralPath $json -Raw | ConvertFrom-Json
      foreach ($tr in $rep.testResults) { $ran += ($tr.name -replace '\\', '/') }
    } catch { Say ("RUN-WARN tag={0} json-unreadable: {1}" -f $Tag, $_.Exception.Message) }
  } else {
    Say ("RUN-WARN tag={0} no json report written" -f $Tag)
  }

  if (-not $v.Green) {
    foreach ($l in @($lines | Where-Object { $_ -cmatch '^\s*(FAIL|\u00d7)\s' } | Select-Object -First 25)) {
      Say ("FAILLINE tag={0} {1}" -f $Tag, $l.Trim())
    }
  }
  return @{ Green = $v.Green; Why = $v.Why; Rc = $rc; Min = $min; Ran = $ran }
}

$Green = 0
$Red   = 0
$RanAll = @{}
$PartitionOk = $false

try {
  # -------------------------------------------------------------------------
  # (2) THE CONTROLS. Before any compiling, because a gate whose comparator is
  #     wrong is worse than no gate: it reports confidently.
  # -------------------------------------------------------------------------
  $cleanLog = @(
    " RUN  v3.2.7 G:/scriptc",
    "",
    " + tests/harness/dyncheck.test.ts (120 tests) 9s",
    "   + a failed check is CATCHABLE and execution recovers  12ms",
    "   + tuple failure-path RC stress: partial tuples release on unwind  9ms",
    " + tests/harness/oracle-trust.test.ts (6 tests) 20ms",
    "   + 0xC0000142 STATUS_DLL_INIT_FAILED - Windows would not start node  1ms",
    " + tests/harness/deadstrip.test.ts (9 tests) 30s",
    "   + a reached class-instance for-in fails the build  2s",
    "   + without --best-effort the same program fails on the construct, not an ICE  2s",
    "",
    " Test Files  3 passed (3)",
    "      Tests  135 passed (135)",
    "   Start at  09:00:00",
    "   Duration  41.00s"
  )
  $failLog = @($cleanLog | ForEach-Object {
    ($_ -replace '^ Test Files  3 passed \(3\)$', ' Test Files  1 failed | 2 passed (3)') `
       -replace '^      Tests  135 passed \(135\)$', '      Tests  1 failed | 134 passed (135)'
  })
  $truncLog = @($cleanLog | Where-Object { $_ -cnotmatch '^\s*(Test Files|Tests)\s{2,}' })
  $esc = [char]27
  $ansiLog = @($cleanLog | ForEach-Object {
    if ($_ -cmatch '^\s*(Test Files|Tests)\s{2,}') { "$esc[32m$_$esc[39m" } else { $_ }
  })

  $controls = @(
    @{ N = "specificity: a clean log whose PASSING test names say failed/FAILED/fails"; V = (Get-ShardVerdict -Lines $cleanLog -Rc 0); Want = $true },
    @{ N = "specificity: the same log with ANSI colour on the summary";                 V = (Get-ShardVerdict -Lines $ansiLog  -Rc 0); Want = $true },
    @{ N = "sensitivity: one planted failure in the summary";                           V = (Get-ShardVerdict -Lines $failLog  -Rc 1); Want = $false },
    @{ N = "sensitivity: a log truncated before the summary";                           V = (Get-ShardVerdict -Lines $truncLog -Rc 0); Want = $false },
    @{ N = "sensitivity: a clean summary with a nonzero exit code";                     V = (Get-ShardVerdict -Lines $cleanLog -Rc 1); Want = $false }
  )
  $controlFail = 0
  foreach ($c in $controls) {
    $ok = ($c.V.Green -eq $c.Want)
    if (-not $ok) { $controlFail++ }
    Say ("CONTROL {0} want={1} got={2} :: {3}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $c.Want, $c.V.Green, $c.N)
  }
  if ($controlFail -gt 0) { Say "GATE5-ABORT reason=verdict-controls-failed count=$controlFail"; $ExitRc = 2; return }

  # -------------------------------------------------------------------------
  # (5) THE LANE. Pinned, then asserted. Never inherited.
  # -------------------------------------------------------------------------
  $env:PATH = "$ZigDir;$NodeDir;$GitUsrBin;$env:PATH"

  $env:TMP    = Join-Path $GateRoot "tmp"
  $env:TEMP   = $env:TMP
  $env:TMPDIR = $env:TMP

  $env:SCRIPTC_CACHE_DIR        = Join-Path $GateRoot "cache"
  $env:ZIG_LOCAL_CACHE_DIR      = Join-Path $GateRoot "zig\local"
  $env:ZIG_GLOBAL_CACHE_DIR     = Join-Path $GateRoot "zig\global"
  $env:SCRIPTC_PROVENANCE_CACHE = Join-Path $GateRoot "prov"
  foreach ($d in @($env:TMP, $env:SCRIPTC_CACHE_DIR, $env:ZIG_LOCAL_CACHE_DIR, $env:ZIG_GLOBAL_CACHE_DIR, $env:SCRIPTC_PROVENANCE_CACHE)) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
  }

  $env:SCRIPTC_TARGET  = "x86_64-windows-gnu"
  $env:SCRIPTC_CC      = "zigcc"
  $env:SCRIPTC_TEST_CC = "zig cc"
  $env:SCRIPTC_TEST_WORKERS = "$Workers"
  # (6) The pruner's budget. NOT a purge - see the header.
  $env:SCRIPTC_TEST_SCRATCH_MAX_MB = "8192"
  # SCRIPTC_TEST_SHARD is deliberately NOT set. It partitions CASES inside a
  # file; combined with --shard, which partitions FILES, a case in file-set N
  # but case-set M would never run at all. --shard alone is a total partition.
  $env:SCRIPTC_TEST_SHARD = $null
  $env:SCR_TICK_POISON    = $null
  $env:SCRIPTC_SAN        = $null

  Set-Location $Repo

  $zigPath = (Get-Command zig -ErrorAction SilentlyContinue).Source
  $zigVer  = (& zig version)
  $nodeVer = (& node --version)
  $head    = (& git rev-parse HEAD).Trim()
  $headSub = (& git log -1 --format="%s").Trim()
  $dirty   = @(& git status --porcelain)

  Say ("ENV node={0} zig={1} zigPath={2} SCRIPTC_TARGET={3} SCRIPTC_CC={4} SCRIPTC_TEST_CC={5} workers={6}" -f $nodeVer, $zigVer, $zigPath, $env:SCRIPTC_TARGET, $env:SCRIPTC_CC, $env:SCRIPTC_TEST_CC, $env:SCRIPTC_TEST_WORKERS)
  Say ("ENV tmp={0} cache={1} ziglocal={2} prov={3} scratchMaxMB={4}" -f $env:TMP, $env:SCRIPTC_CACHE_DIR, $env:ZIG_LOCAL_CACHE_DIR, $env:SCRIPTC_PROVENANCE_CACHE, $env:SCRIPTC_TEST_SCRATCH_MAX_MB)
  Say ("TREE head={0} subject={1}" -f $head, $headSub)
  $TreeHash0 = WorkTreeHash
  Say ("TREEHASH baseline={0} repo={1}" -f $TreeHash0, (RepoRealPath))
  if ($OffContract) {
    Say ("GATE5-OFF-CONTRACT shards={0}/{1} workers={2}/{3} -- rig exercise, NOT a merge gate" -f $Shards, $ShardContract, $Workers, $WorkerContract)
  }
  # A gate that starts on a dirty tree is measuring somebody's work in
  # progress. Refused outright in a real run; a dry run may be dirty.
  if (-not $DryRun -and $dirty.Count -gt 0) {
    Say ("GATE5-ABORT reason=dirty-worktree-at-start entries={0}" -f $dirty.Count)
    Say ("GATE5-ABORT detail: commit, stash or use an exclusive worktree. A verdict over uncommitted edits names a commit it did not measure.")
    $ExitRc = 2
    return
  }
  foreach ($d in $dirty) { Say ("TREE dirty: {0}" -f $d) }
  # Untracked test files are collected by vitest and belong to whoever left
  # them there. Named so a failure from one is attributable at a glance.
  foreach ($d in $dirty) {
    if ($d -match '^\?\?\s+(.*\.test\.ts)$') { Say ("TREE untracked-test: {0} (collected by vitest, not from a commit)" -f $Matches[1]) }
  }

  # The lane assertions. A wrong zig is 13,312 bytes of phantom regression and
  # a wrong target is 8,192; neither may be discovered afterwards.
  if ($zigPath -notlike "$ZigDir*") { Say "GATE5-ABORT reason=wrong-zig-on-path got=$zigPath want=$ZigDir"; $ExitRc = 2; return }
  if ($zigVer -ne $ZigWant)         { Say "GATE5-ABORT reason=wrong-zig-version got=$zigVer want=$ZigWant";  $ExitRc = 2; return }
  if ($nodeVer -ne $NodeWant)       { Say "GATE5-ABORT reason=wrong-node got=$nodeVer want=$NodeWant";       $ExitRc = 2; return }

  # The PROVISIONING assertions, for the same reason as the lane ones: a gate
  # that spends 50 minutes to report what a Test-Path answers in a second is
  # not reporting a defect, it is reporting itself.
  #
  # Almost every test imports compiler SOURCE through vitest's aliases, so an
  # unbuilt worktree looks completely green -- except for the handful that
  # spawn the CLI as a CHILD PROCESS through the package entry, which
  # resolves @scriptc/compiler to its dist. With dist absent the child dies
  # in node's module resolver and prints ~1.3KB of stack trace, and
  # packages/cli/test/flush.test.ts reads that as "the >64KB render was
  # TRUNCATED" -- a loud, plausible, and entirely false diagnostic about the
  # thing it exists to watch. Measured on an unprovisioned worktree: 5 of 5
  # runs failed, constant byte count; 3 of 3 passed after building dist, with
  # no source change. This aborts instead of building, because a gate that
  # repairs its own subject cannot tell you the subject was broken.
  $cliLink  = Join-Path $Repo "packages\cli\node_modules\@scriptc\compiler"
  $distMain = Join-Path $Repo "packages\compiler\dist\index.js"
  if (-not (Test-Path $cliLink))  { Say ("GATE5-ABORT reason=missing-workspace-link path={0} fix=pnpm-install" -f $cliLink);           $ExitRc = 2; return }
  if (-not (Test-Path $distMain)) { Say ("GATE5-ABORT reason=missing-compiler-dist path={0} fix=build-packages/compiler" -f $distMain); $ExitRc = 2; return }
  Say "PROVISION cli-link=ok compiler-dist=ok"

  # -------------------------------------------------------------------------
  # (7) THE DISK FLOOR.
  # -------------------------------------------------------------------------
  if ((FreeGB) -lt $DiskFloorGB) { Say ("GATE5-ABORT reason=disk-floor free={0}GB floor={1}GB" -f (FreeGB), $DiskFloorGB); $ExitRc = 2; return }
  Say ("DISK free={0}GB floor={1}GB" -f (FreeGB), $DiskFloorGB)

  # -------------------------------------------------------------------------
  # (4) THE EXPECTED FILE SET, from vitest.config.ts's include globs directly:
  #     tests/harness/**, packages/*/src/**, packages/*/test/**. Not from
  #     `vitest list --shard`, which ignores the flag.
  # -------------------------------------------------------------------------
  $expected = New-Object System.Collections.Generic.HashSet[string]
  $roots = @((Join-Path $Repo "tests\harness"))
  foreach ($p in (Get-ChildItem -Path (Join-Path $Repo "packages") -Directory -ErrorAction SilentlyContinue)) {
    $roots += (Join-Path $p.FullName "src")
    $roots += (Join-Path $p.FullName "test")
  }
  foreach ($r in $roots) {
    if (-not (Test-Path $r)) { continue }
    foreach ($f in (Get-ChildItem -Path $r -Recurse -File -Filter "*.test.ts" -ErrorAction SilentlyContinue)) {
      if ($f.FullName -like "*\node_modules\*") { continue }
      [void]$expected.Add(($f.FullName -replace '\\', '/'))
    }
  }
  $expected | Sort-Object | Set-Content -LiteralPath (Join-Path $LogDir "expected-files.txt")
  Say ("PARTITION expected-files={0}" -f $expected.Count)
  if ($expected.Count -eq 0) { Say "GATE5-ABORT reason=no-test-files-globbed"; $ExitRc = 2; return }

  # -------------------------------------------------------------------------
  # THE DRESS REHEARSAL, or THE SHARDS.
  # -------------------------------------------------------------------------
  if ($DryRun) {
    $r = Invoke-Judged -Tag "dryrun" -ExtraArgs @("tests/harness/size-class-armed.test.ts", "tests/harness/shard.test.ts")
    # An aborted run may not print GREEN anywhere, not just in the shard
    # loop. Arming the continuous floor caught exactly that: the abort fired,
    # the child was killed, and this path still reported verdict=GREEN rc=0.
    if ($DiskFloorBreached) { Say ("GATE5-ABORT reason=disk-floor-continuous mode=dryrun"); $ExitRc = 2; return }
    Say ("DRYRUN-RESULT rc={0} min={1} files={2} verdict={3} :: {4}" -f $r.Rc, $r.Min, $r.Ran.Count, $(if ($r.Green) { "GREEN" } else { "RED" }), $r.Why)
    $ok = ($r.Green -and $r.Ran.Count -eq 2)
    Say ("GATE5-TOTAL mode=dryrun shards={0}/{1} verdict={2}" -f $Shards, $ShardContract, (VerdictWord $ok))
    # Off the contract the exit code must not read as success either: a
    # caller that checks rc and not the text would otherwise count this.
    $ExitRc = if ($OffContract) { 2 } elseif ($ok) { 0 } else { 1 }
    return
  }

  for ($n = 1; $n -le $Shards; $n++) {
    if ((FreeGB) -lt $DiskFloorGB) { Say ("GATE5-ABORT reason=disk-floor-midrun shard={0} free={1}GB" -f $n, (FreeGB)); $ExitRc = 2; return }
    $hNow = WorkTreeHash
    if ($hNow -ne $TreeHash0) {
      Say ("GATE5-ABORT reason=worktree-moved-midrun shard={0} baseline={1} now={2}" -f $n, $TreeHash0, $hNow)
      Say ("GATE5-ABORT detail: the working tree changed while the gate was running. vitest aliases SOURCE, so the shards before and after this point measured DIFFERENT trees and neither side's verdict stands. Re-run the WHOLE gate on a clean, exclusive worktree.")
      $ExitRc = 2
      return
    }
    Say ("TREEHASH shard={0} {1} repo={2}" -f $n, $hNow, (RepoRealPath))
    $r = Invoke-Judged -Tag "shard-$n" -ExtraArgs @("--shard=$n/$Shards")
    foreach ($f in $r.Ran) {
      if ($RanAll.ContainsKey($f)) { $RanAll[$f] += ",$n" } else { $RanAll[$f] = "$n" }
    }
    if ($DiskFloorBreached) { Say ("GATE5-ABORT reason=disk-floor-continuous-midshard shard={0}" -f $n); $ExitRc = 2; return }
    if ($r.Green) { $Green++ } else { $Red++ }
    Say ("SHARD-RESULT n={0}/{1} rc={2} min={3} files={4} verdict={5} :: {6}" -f $n, $Shards, $r.Rc, $r.Min, $r.Ran.Count, $(if ($r.Green) { "GREEN" } else { "RED" }), $r.Why)
  }

  # -------------------------------------------------------------------------
  # THE PARTITION, from what actually ran.
  # -------------------------------------------------------------------------
  $missing = @($expected | Where-Object { -not $RanAll.ContainsKey($_) })
  $extra   = @($RanAll.Keys | Where-Object { -not $expected.Contains($_) })
  $dupes   = @($RanAll.Keys | Where-Object { $RanAll[$_] -match ',' })
  foreach ($m in ($missing | Select-Object -First 20)) { Say ("PARTITION-MISSING {0}" -f $m) }
  foreach ($e in ($extra   | Select-Object -First 20)) { Say ("PARTITION-EXTRA   {0}" -f $e) }
  foreach ($d in ($dupes   | Select-Object -First 20)) { Say ("PARTITION-DUPE    {0} shards={1}" -f $d, $RanAll[$d]) }
  $PartitionOk = ($missing.Count -eq 0 -and $extra.Count -eq 0 -and $dupes.Count -eq 0)
  Say ("PARTITION-RESULT expected={0} ran={1} missing={2} extra={3} dupes={4} verdict={5}" -f $expected.Count, $RanAll.Count, $missing.Count, $extra.Count, $dupes.Count, $(if ($PartitionOk) { "OK" } else { "FAIL" }))

  $verdict = ($Green -eq $Shards -and $Red -eq 0 -and $PartitionOk)
  $ExitRc = if ($verdict) { 0 } else { 1 }
  $hEnd = WorkTreeHash
  if ($hEnd -ne $TreeHash0) {
    Say ("GATE5-ABORT reason=worktree-moved-before-verdict baseline={0} now={1}" -f $TreeHash0, $hEnd)
    $ExitRc = 2
    return
  }
  Say ("GATE5-TOTAL shards={0}/{1} workers={2}/{3} green={4} red={5} partition={6} minutes={7} free={8}GB head={9} treehash={10} verdict={11}" -f $Shards, $ShardContract, $Workers, $WorkerContract, $Green, $Red, $(if ($PartitionOk) { "OK" } else { "FAIL" }), [math]::Round(((Get-Date) - $Started).TotalMinutes, 2), (FreeGB), $head, $hEnd, (VerdictWord $verdict))
  if ($OffContract) {
    Say ("GATE5-NOT-MERGEABLE reason=off-contract shards={0}/{1} workers={2}/{3}" -f $Shards, $ShardContract, $Workers, $WorkerContract)
    Say ("GATE5-NOT-MERGEABLE detail: GATE_SHARDS was set, so this is a rig exercise and not a merge gate however green the shards were. Nothing here may be counted as a gate.")
    $ExitRc = 2
    return
  }
}
catch {
  Say ("GATE5-ABORT reason=exception message={0}" -f $_.Exception.Message)
  Say ("GATE5-ABORT at={0}" -f ($_.ScriptStackTrace -replace "`r?`n", " | "))
  $ExitRc = 3
}
finally {
  Say ("GATE-EXIT rc={0} runId={1} logs={2}" -f $ExitRc, $RunId, $LogDir)
  exit $ExitRc
}
