# Block `llvmparity` — the pinned shell for every build in this block.
#
# Dot-source it: `. tests/perf/llvmparity/env.ps1` — PowerShell tool calls do
# NOT persist shell state between invocations, so this runs at the top of
# every single call. That is not belt-and-braces: TMP defaulting back to the
# worktree reddened fetch-dispatcher across a whole block once, and an unset
# SCRIPTC_PROVENANCE_CACHE has put gigabytes on the user's C: drive twice.
#
# NODE LANE: v22.18.0 for BUILDS. app182/README.md records its measurements
# as "built under node v22.18.0", and v25's pnpm purges v22's node_modules
# (which reads as a red gate). Gate runs take v25; this file is the build
# lane, and it prints the version it actually pinned so a report can name it.

# THE THREE HOST PATHS COME FROM THE ENVIRONMENT, and they are checked here
# rather than written in. This file used to carry them as the literal bytes
# `<home>`, `<blocks>` and `<zapo-work>` -- an anonymisation that left the
# file UNRUNNABLE rather than merely unportable: `<` and `>` are illegal in
# Windows filenames, so every path built from them failed at the first
# Test-Path and `census-app182.ps1`, which dot-sources this, could not run as
# committed. A placeholder that cannot be distinguished from a real value by
# the shell is worse than an absolute path, because the absolute path at
# least fails on a machine that does not have it.
#
# `HOME_ROOT` IS SPELLED THE WAY harness/verify.sh ALREADY SPELLS IT
# (`${HOME_ROOT:-<home>}`), so one variable serves both lanes.
#
# IT THROWS RATHER THAN GUESSING. A default here would be a path on somebody
# else's disk, and the two things these roots feed -- the provenance cache
# and TMP -- are exactly the two that have put gigabytes on the wrong drive
# before. Unset must stop the run, loudly, naming what to set.
$blocks = if ($env:SCRIPTC_BLOCKS_ROOT) { $env:SCRIPTC_BLOCKS_ROOT } else {
  throw "set SCRIPTC_BLOCKS_ROOT to the directory this block keeps its caches, tmp and logs under (e.g. G:locks)" }
$home_ = if ($env:HOME_ROOT) { $env:HOME_ROOT } elseif ($env:USERPROFILE) { $env:USERPROFILE } else {
  throw "set HOME_ROOT (or USERPROFILE) to the user profile directory -- scr_os_homedir traps without it" }
$zigdir = if ($env:ZIG_ROOT) { $env:ZIG_ROOT } else {
  throw "set ZIG_ROOT to the directory holding zig.exe -- two zigs exist on this host and the version decides the size class" }
$root = "$blocks\llvmparity"

$env:TMP    = "$root\tmp"          # OUTSIDE the worktree, deliberately
$env:TEMP   = $env:TMP
$env:TMPDIR = $env:TMP

$env:SCRIPTC_CACHE_DIR        = "$root\cache"
$env:npm_config_cache         = "$root\npmcache"
$env:SCRIPTC_PROVENANCE_CACHE = "$root\prov"
$env:ZIG_LOCAL_CACHE_DIR      = "$root\zig"
$env:ZIG_GLOBAL_CACHE_DIR     = "$root\zig-g"

# A detached shell loses USERPROFILE and scr_os_homedir then traps — 8 corpus
# failures on both lanes once turned out to be the launcher, not the code.
$env:USERPROFILE = $home_

$env:SCRIPTC_TARGET       = "x86_64-windows-gnu"
$env:SCRIPTC_CC           = "zigcc"
$env:SCRIPTC_TEST_CC      = "zig cc"
$env:SCRIPTC_TEST_WORKERS = "3"    # 6 physical cores, up to four blocks live

foreach ($d in @($env:TMP, $env:SCRIPTC_CACHE_DIR, $env:npm_config_cache,
                 $env:SCRIPTC_PROVENANCE_CACHE, $env:ZIG_LOCAL_CACHE_DIR,
                 $env:ZIG_GLOBAL_CACHE_DIR)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null }
}

$env:PATH = "$home_\AppData\Local\nvm\v22.18.0;" +
            "$zigdir;" +
            "C:\Program Files\Git\usr\bin;" +
            "C:\msys64\ucrt64\bin;" + $env:PATH

# Read the lane back off the SPAWNED binaries, never off a variable.
Write-Output ("node       " + (& node --version))
Write-Output ("zig        " + (& zig version))
Write-Output ("TMP        " + $env:TMP)
Write-Output ("prov cache " + $env:SCRIPTC_PROVENANCE_CACHE)

# The guard that matters: provenance.ts falls back to homedir()/.cache/scriptc
# with NO warning when SCRIPTC_PROVENANCE_CACHE is unset.
$leak = "$home_\.cache\scriptc"
Write-Output ("C: leak    " + (Test-Path $leak) + "   (must stay False)")
