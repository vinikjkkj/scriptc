# spawn.ps1 -- detach one harness command so it survives the agent turn.
#
# WHY: a task backgrounded by the agent harness is killed when the turn ends,
# and the half-written log then reads exactly like an OOM or a crash. A
# Start-Process -WindowStyle Hidden child is owned by the OS, not the turn.
#
# The command is written to a generated .sh rather than passed as a -c string:
# quoting a bash -c payload through PowerShell eats backslashes and quotes on
# this host, and the failure mode is a child that exits instantly leaving an
# EMPTY log -- which reads exactly like "still starting up".
#
#   pwsh -File spawn.ps1 <log-name> <argv...>
param(
  [Parameter(Mandatory = $true)][string]$LogName,
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Rest
)
$root = "<blocks>\storestatus"
$log = "$root\logs\$LogName.log"
$err = "$root\logs\$LogName.err"
$sh  = "$root\logs\$LogName.run.sh"
$bash = "C:\Program Files\Git\bin\bash.exe"

$inner = ($Rest | ForEach-Object { "'" + ($_ -replace "'", "'\''") + "'" }) -join " "
$lines = @(
  "cd <blocks>/storestatus/wt || exit 90",
  $inner,
  'rc=$?',
  # The sentinel is the point: a log with no GATE-EXIT was truncated, not
  # finished, and may not be read as a result.
  'echo "GATE-EXIT rc=$rc"'
)
Set-Content -Path $sh -Value $lines -Encoding ascii
Remove-Item $log, $err -ErrorAction SilentlyContinue
$shPosix = "/" + ($sh -replace '\\', '/' -replace '^([A-Za-z]):', '$1').ToLower()
Start-Process -FilePath $bash -ArgumentList @($shPosix) `
  -RedirectStandardOutput $log -RedirectStandardError $err -WindowStyle Hidden
Write-Output "spawned $LogName  script=$shPosix  log=$log"
