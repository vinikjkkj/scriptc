# Machine-state sampler for the gate's existing 10 s watchdog loop.
#
# WHY IT MAY COST 6.9% OF A TICK: it runs in the gate DRIVER (pwsh), which is
# already asleep for 10 s between disk checks. It never executes inside a
# vitest worker and never touches the main-thread RPC path, which is where
# the onTaskUpdate failure lives. An instrument that ran there would change
# the thing it measures.
#
# FOUR RULES, each paid for by a past mistake:
#  1. Warm the CIM session before the loop. The first call costs 4.0 s on this
#     host against 0.68 s steady state, so an unwarmed first tick reports a
#     stall that is the instrument's own startup.
#  2. No Get-Counter. Its 1 s sample interval would add ~30 s per shard and it
#     is locale-sensitive.
#  3. EXTREMA, never the last sample. A downsampled series cannot measure a
#     peak: 10 s ticks over a 5 min shard are ~30 draws out of a continuum.
#     Min free RAM, max CPU, max queue -- the same shape as the disk trough
#     the loop already tracks.
#  4. Never throw. A sampler must not be able to fail a gate.
#
# Measured per tick on this host: OS 137 ms, CPU 281 ms, disk 275 ms.
#
# WHY NOT CurrentDiskQueueLength. It was the first choice and its positive
# control FAILED: through 768 MB of writes it never left 0, and under a
# second probe at 1.3 GB/s it read non-zero on 2 samples out of 12. It is an
# instantaneous gauge, so at a 10 s cadence it is a lottery, not a
# measurement. AvgDiskQueueLength is integer-rounded to 0 here, and the
# _Total instance barely moves even when a member disk is saturated. What
# does respond is PercentDiskTime and DiskBytesPersec on the G: INSTANCE,
# and that is what is sampled. A column that reads 0 forever is
# indistinguishable from a quiet disk.

function Initialize-MachineSampler {
  # Rule 1. Returns an accumulator with every extremum unset.
  try { $null = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop } catch { }
  try { $null = Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction Stop } catch { }
  try { $null = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name LIKE '%G:%'" -ErrorAction Stop } catch { }
  [pscustomobject]@{
    MinFreeRamMB  = [double]::PositiveInfinity
    MaxCpuPct     = -1
    MaxDiskPct    = -1
    MaxDiskMBps   = -1
    TotalRamMB    = 0
    Samples       = 0
    Failures      = 0
  }
}

function Add-MachineSample {
  param([Parameter(Mandatory)] $Acc)
  # Rule 4: every probe is independent and swallowed, so one dead counter
  # does not cost the other two.
  $got = $false
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    $free = [math]::Round($os.FreePhysicalMemory / 1KB, 0)
    if ($free -lt $Acc.MinFreeRamMB) { $Acc.MinFreeRamMB = $free }   # Rule 3
    if ($Acc.TotalRamMB -eq 0) { $Acc.TotalRamMB = [math]::Round($os.TotalVisibleMemorySize / 1KB, 0) }
    $got = $true
  } catch { }
  try {
    $c = (Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction Stop).PercentProcessorTime
    if ($null -ne $c -and $c -gt $Acc.MaxCpuPct) { $Acc.MaxCpuPct = [int]$c }  # Rule 3
    $got = $true
  } catch { }
  try {
    $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name LIKE '%G:%'" -ErrorAction Stop | Select-Object -First 1
    if ($null -ne $d) {
      if ($d.PercentDiskTime -gt $Acc.MaxDiskPct) { $Acc.MaxDiskPct = [int]$d.PercentDiskTime }        # Rule 3
      $mb = [math]::Round($d.DiskBytesPersec / 1MB, 0)
      if ($mb -gt $Acc.MaxDiskMBps) { $Acc.MaxDiskMBps = [int]$mb }                                     # Rule 3
      $got = $true
    }
  } catch { }
  if ($got) { $Acc.Samples++ } else { $Acc.Failures++ }
  $Acc
}

function Format-MachineSample {
  param([Parameter(Mandatory)] $Acc, [string] $Tag = "?")
  # "n/a" is NOT 0: an unset extremum must not read as a measured zero.
  $ram = if ([double]::IsInfinity($Acc.MinFreeRamMB)) { "n/a" } else { "$($Acc.MinFreeRamMB)" }
  $pct = if ($Acc.TotalRamMB -gt 0 -and $ram -ne "n/a") { [math]::Round(100 * $Acc.MinFreeRamMB / $Acc.TotalRamMB, 1) } else { "n/a" }
  $cpu = if ($Acc.MaxCpuPct -lt 0) { "n/a" } else { "$($Acc.MaxCpuPct)" }
  $dp  = if ($Acc.MaxDiskPct -lt 0) { "n/a" } else { "$($Acc.MaxDiskPct)" }
  $dm  = if ($Acc.MaxDiskMBps -lt 0) { "n/a" } else { "$($Acc.MaxDiskMBps)" }
  "MACHINE tag={0} minFreeRamMB={1} minFreeRamPct={2} maxCpuPct={3} maxDiskPct={4} maxDiskMBps={5} totalRamMB={6} samples={7} failures={8}" -f `
    $Tag, $ram, $pct, $cpu, $dp, $dm, $Acc.TotalRamMB, $Acc.Samples, $Acc.Failures
}
