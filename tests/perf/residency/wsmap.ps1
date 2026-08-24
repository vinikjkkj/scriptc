# wsmap.ps1 -Name <exe.exe> -Out <file> [-Timeout N] [-IntervalMs N]
#
# Enumerates the RESIDENT pages of a running process with QueryWorkingSet and
# writes the UNION of every page seen, as absolute virtual addresses plus the
# image base. tests/perf/residency/wsattrib.mjs turns that into "peak RSS by
# PE section and by function".
#
# WHY THIS EXISTS. On zapo's fake-server run the working set peaks at 30.7 MB
# for a 26.9 MB binary, and the private/file-backed split says roughly half of
# it is file-backed - the program's own image, faulted in a page at a time.
# No allocator-interposing profiler can see one byte of that: there is no
# malloc involved. scr_prof.h's lanes attribute the HEAP half; this attributes
# the other one, and without both the map has a hole the size of the answer.
#
# WHAT IT IS AND IS NOT:
#  * The union over samples is a FLOOR for the true peak resident set (a page
#    resident only between two samples is missed) and simultaneously an
#    OVER-estimate of any single instant (Windows trims working sets, so a page
#    seen at t1 and trimmed by t2 is still counted). Both directions are stated
#    rather than the convenient one picked. Cross-check it against the kernel's
#    own PeakWorkingSetSize: on zapo, 7,568 pages = 30,998,528 B against a
#    kernel peak of 30,662,656 B, i.e. 1.1% high, which is the trim effect.
#  * Shared/private is taken from bit 8 of each entry's flag word, so DLL pages
#    can be told from the program's own. Cross-checked on a zapo solo run:
#    3,795 shared pages x 4096 = 15,544,320 B, EXACTLY the WorkingSetPrivate
#    complement reported by Win32_PerfRawData_PerfProc_Process. Two independent
#    instruments, same number to the byte.
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [Parameter(Mandatory=$true)][string]$Out,
  [int]$Timeout = 300,
  [int]$IntervalMs = 250
)
Add-Type -Namespace WS -Name Native -MemberDefinition @"
[DllImport("psapi.dll", SetLastError=true)]
public static extern bool QueryWorkingSet(IntPtr hProcess, IntPtr pv, uint cb);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
[DllImport("kernel32.dll", SetLastError=true)]
public static extern bool CloseHandle(IntPtr h);
"@
$PROCESS_QUERY_INFORMATION = 0x0400
$PROCESS_VM_READ = 0x0010

$deadline = (Get-Date).AddSeconds($Timeout)
$pages = New-Object 'System.Collections.Generic.HashSet[int64]'
$shared = New-Object 'System.Collections.Generic.HashSet[int64]'
$base = 0
$sawIt = $false
$samples = 0
$cap = 4194304   # entries; 32 MB of buffer, far more than a 27 MB image needs
$bufBytes = ($cap + 1) * 8
$buf = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bufBytes)
try {
  while ((Get-Date) -lt $deadline) {
    $procs = @(Get-Process -Name ([System.IO.Path]::GetFileNameWithoutExtension($Name)) -ErrorAction SilentlyContinue)
    if ($procs.Count -eq 0) { if ($sawIt) { break }; Start-Sleep -Milliseconds 50; continue }
    $sawIt = $true
    foreach ($proc in $procs) {
      if ($base -eq 0) { try { $base = [int64]$proc.MainModule.BaseAddress } catch { } }
      $h = [WS.Native]::OpenProcess(($PROCESS_QUERY_INFORMATION -bor $PROCESS_VM_READ), $false, $proc.Id)
      if ($h -eq [IntPtr]::Zero) { continue }
      try {
        if ([WS.Native]::QueryWorkingSet($h, $buf, [uint32]$bufBytes)) {
          $samples++
          $n = [System.Runtime.InteropServices.Marshal]::ReadInt64($buf)
          if ($n -gt $cap) { $n = $cap }
          for ($i = 1; $i -le $n; $i++) {
            $e = [System.Runtime.InteropServices.Marshal]::ReadInt64($buf, $i * 8)
            $va = $e -band (-4096)
            [void]$pages.Add($va)
            if (($e -band 0x100) -ne 0) { [void]$shared.Add($va) }
          }
        }
      } finally { [void][WS.Native]::CloseHandle($h) }
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
} finally { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($buf) }

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("WSMAP base=$base pages=$($pages.Count) shared=$($shared.Count) samples=$samples sawIt=$sawIt")
foreach ($va in ($pages | Sort-Object)) {
  $sh = if ($shared.Contains($va)) { 1 } else { 0 }
  [void]$sb.AppendLine("P $va $sh")
}
[System.IO.File]::WriteAllText($Out, $sb.ToString())
Write-Output "WSMAP base=$base pages=$($pages.Count) shared=$($shared.Count) samples=$samples"
