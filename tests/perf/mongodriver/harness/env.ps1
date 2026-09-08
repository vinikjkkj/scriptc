# mongodriver block environment (PowerShell). Source before anything.
# NOTE: written with the Write tool, never a heredoc -- heredocs eat one
# backslash on this host and the guard regex below silently became invalid
# (which "passed" the self-test by throwing a regex error, a false green).
$env:TMP="<blocks>\mongodriver\tmp"; $env:TEMP=$env:TMP; $env:TMPDIR=$env:TMP
$env:SCRIPTC_CACHE_DIR="<blocks>\mongodriver\cache"
$env:npm_config_cache="<blocks>\mongodriver\npmcache"
$env:SCRIPTC_PROVENANCE_CACHE="<blocks>\mongodriver\prov"
$env:ZIG_LOCAL_CACHE_DIR="<blocks>\mongodriver\zig"
$env:ZIG_GLOBAL_CACHE_DIR="<blocks>\mongodriver\zig-g"
$env:USERPROFILE="<home>"
$env:SCRIPTC_TARGET="x86_64-windows-gnu"
$env:SCRIPTC_CC="zigcc"; $env:SCRIPTC_TEST_CC="zig cc"
$env:SCRIPTC_TEST_WORKERS="3"
$env:WT="<blocks>/mongodriver/wt"
$env:PATH="<home>\AppData\Local\nvm\v25.9.0;<zapo-work>\tools\zig;C:\Program Files\Git\usr\bin;C:\msys64\ucrt64\bin;"+$env:PATH

# GUARD. provenance.ts falls back to homedir()/.cache/scriptc with NO warning
# when SCRIPTC_PROVENANCE_CACHE is unset; that has filled the user's C: drive.
# No regex, no escapes: a plain prefix test that cannot be mangled in transit.
function Test-ScriptcPinOnG([string]$v) {
  if ([string]::IsNullOrEmpty($v)) { return $false }
  $p = $v.Substring(0, [Math]::Min(3, $v.Length))
  return ($p -eq 'G:\' -or $p -eq 'g:\' -or $p -eq 'G:/' -or $p -eq 'g:/')
}
$pinBad = @()
foreach ($v in @('TMP','TEMP','TMPDIR','SCRIPTC_CACHE_DIR','SCRIPTC_PROVENANCE_CACHE','ZIG_LOCAL_CACHE_DIR','ZIG_GLOBAL_CACHE_DIR','npm_config_cache')) {
  $val = [Environment]::GetEnvironmentVariable($v)
  if (-not (Test-ScriptcPinOnG $val)) { $pinBad += "$v = '$val'" }
}
if ($pinBad.Count -gt 0) {
  throw ("PIN BAD (an unpinned cache writes to the user's C: drive): " + ($pinBad -join '; '))
}
if (Test-Path '<home>\.cache\scriptc') {
  throw "<home>\.cache\scriptc EXISTS -- something ran unpinned. Not deleting it. Report it."
}
