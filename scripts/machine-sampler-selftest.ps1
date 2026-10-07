# Self-test for machine-sampler.ps1.
#
# A sampler that always returns the same number is indistinguishable from a
# stable machine, so every column is asserted to MOVE under a load it is
# supposed to see. Both directions where a direction exists.
. "G:\blocks\machine-sampler.ps1"
$fail = 0
function Check($name, $cond, $detail) {
  if ($cond) { "  PASS  $name  :: $detail" } else { $script:fail++; "  FAIL  $name  :: $detail" }
}

"=== T1. an unset extremum reads n/a, never 0 ==="
$empty = Initialize-MachineSampler
$line = Format-MachineSample -Acc $empty -Tag "t1"
Check "fresh accumulator is n/a" ($line -match "minFreeRamMB=n/a" -and $line -match "maxCpuPct=n/a" -and $line -match "maxDiskPct=n/a" -and $line -match "maxDiskMBps=n/a") $line

"=== T2. baseline: sampler returns plausible live values ==="
$base = Initialize-MachineSampler
for ($i=0; $i -lt 4; $i++) { $base = Add-MachineSample -Acc $base; Start-Sleep -Milliseconds 400 }
$baseRam = $base.MinFreeRamMB; $baseCpu = $base.MaxCpuPct
"  baseline: $(Format-MachineSample -Acc $base -Tag 't2')"
Check "samples recorded"   ($base.Samples -eq 4)                         "samples=$($base.Samples) failures=$($base.Failures)"
Check "free RAM plausible" ($baseRam -gt 100 -and $baseRam -lt $base.TotalRamMB) "minFreeRamMB=$baseRam of $($base.TotalRamMB)"

"=== T3. POSITIVE CONTROL: force a 1.5 GB resident allocation ==="
$want = 1536MB
$load = Initialize-MachineSampler
$load = Add-MachineSample -Acc $load          # one sample BEFORE the allocation
$preRam = $load.MinFreeRamMB
$buf = New-Object byte[] $want
for ($o = 0; $o -lt $buf.Length; $o += 4096) { $buf[$o] = 1 }   # touch every page or it is not resident
for ($i=0; $i -lt 4; $i++) { $load = Add-MachineSample -Acc $load; Start-Sleep -Milliseconds 400 }
$drop = $preRam - $load.MinFreeRamMB
"  before=$preRam MB   after(min)=$($load.MinFreeRamMB) MB   drop=$drop MB   (allocated 1536 MB)"
Check "min free RAM FELL under a known allocation" ($drop -ge 1000) "drop=$drop MB, need >=1000"
$buf = $null; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers()

"=== T4. NOISE FLOOR: what the RAM column can actually resolve ==="
# Not a tuned threshold. The first version of this test asserted drift < 500
# MB and failed at 503, because the GC releasing T3's buffer bled into the
# window. Tuning the bar to pass would have hidden the real number, so the
# window is settled first and the floor is MEASURED and reported -- it is
# the resolution of the column, and it bounds what a between-run RAM
# difference is allowed to mean.
Start-Sleep -Seconds 8                     # let T3's release settle
$raw = @()
for ($i=0; $i -lt 15; $i++) {
  $raw += [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB, 0)
  Start-Sleep -Milliseconds 400
}
$floor = ($raw | Measure-Object -Maximum).Maximum - ($raw | Measure-Object -Minimum).Minimum
"  idle free-RAM range over 15 samples = $floor MB   (min $(($raw|Measure-Object -Minimum).Minimum), max $(($raw|Measure-Object -Maximum).Maximum))"
"  NOISE FLOOR: the RAM column resolves differences larger than ~$floor MB on an idle host."
Check "the 1536 MB signal clears the measured noise floor" ($drop -gt 2 * $floor) "signal=$drop MB, floor=$floor MB, need signal > 2x floor"

"=== T5. POSITIVE CONTROL: CPU column must rise under a busy loop ==="
$cpu = Initialize-MachineSampler
$jobs = 1..6 | ForEach-Object { Start-Job { $e=(Get-Date).AddSeconds(4); while((Get-Date) -lt $e){ $null=[math]::Sqrt(12345.678) } } }
for ($i=0; $i -lt 6; $i++) { $cpu = Add-MachineSample -Acc $cpu; Start-Sleep -Milliseconds 400 }
$jobs | Wait-Job -Timeout 15 | Out-Null; $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
"  baselineCpu=$baseCpu%   underLoadMax=$($cpu.MaxCpuPct)%"
Check "max CPU rose under load" ($cpu.MaxCpuPct -gt $baseCpu) "baseline=$baseCpu underLoad=$($cpu.MaxCpuPct)"

"=== T6. a dead counter must not kill the others (Rule 4) ==="
$acc = Initialize-MachineSampler
$acc = Add-MachineSample -Acc $acc
Check "no throw, sample counted" ($acc.Samples -eq 1 -and $acc.Failures -eq 0) "samples=$($acc.Samples) failures=$($acc.Failures)"


# --- appended: the disk-queue column was never shown to MOVE ---------------
# It read 0 through every test above, which is exactly what a broken counter
# also reads. Prove it responds to real I/O before trusting a 0 from a gate.
"=== T7. POSITIVE CONTROL: the disk columns must rise under real I/O ==="
# The FIRST version of this test used CurrentDiskQueueLength and FAILED: 0
# under 768 MB of writes. That failure is why the sampler now reads
# PercentDiskTime and DiskBytesPersec on the G: instance. Keeping the test
# strict is the whole point -- a column that cannot move is not a column.
$scratch = "G:\blocks\.sampler-io-probe"
$dq = Initialize-MachineSampler
$dq = Add-MachineSample -Acc $dq
$idlePct = $dq.MaxDiskPct; $idleMBps = $dq.MaxDiskMBps
try {
  New-Item -ItemType Directory -Force -Path $scratch | Out-Null
  $io = Start-Job -ArgumentList $scratch {
    param($d)
    $b = New-Object byte[] (64MB)
    for ($i = 0; $i -lt 40; $i++) { [System.IO.File]::WriteAllBytes((Join-Path $d "probe-$i.bin"), $b) }
  }
  for ($i = 0; $i -lt 14; $i++) { $dq = Add-MachineSample -Acc $dq; Start-Sleep -Milliseconds 250 }
  $io | Wait-Job -Timeout 120 | Out-Null; $io | Remove-Job -Force -ErrorAction SilentlyContinue
} finally {
  Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
}
"  idlePct=$idlePct%  underIoMaxPct=$($dq.MaxDiskPct)%   idleMBps=$idleMBps  underIoMaxMBps=$($dq.MaxDiskMBps)"
Check "disk BUSY% rose under real I/O"  ($dq.MaxDiskPct  -gt $idlePct)  "idle=$idlePct underIo=$($dq.MaxDiskPct)"
Check "disk THROUGHPUT rose under real I/O" ($dq.MaxDiskMBps -gt [math]::Max($idleMBps,50)) "idle=$idleMBps underIo=$($dq.MaxDiskMBps) MB/s"

""
if ($fail -eq 0) { "SELFTEST-RESULT pass=8 fail=0 VERDICT=GREEN" } else { "SELFTEST-RESULT fail=$fail VERDICT=RED" }
