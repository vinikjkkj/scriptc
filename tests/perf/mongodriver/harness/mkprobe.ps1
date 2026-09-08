# mkprobe.ps1 -Name <arm>
# Builds a PROBE provenance cache at <blocks>\mongodriver\probe\<arm>\prov.
#
# The real cache (<blocks>\mongodriver\prov) is READ-ONLY: the brief forbids
# modifying mongodb or bson, and every provenance checkout is test input. So a
# substitution arm gets its OWN cache root, built by copying the checkouts and
# editing only the copy. Nothing under <blocks>\mongodriver\prov is ever
# written by this script -- it opens those paths for reading only.
#
# docs/ (1,247 MB) and test/ (865 MB) of the mongodb checkout are NOT copied:
# they are 99.8% of the tree and nothing imports them. Whether that omission is
# neutral is not assumed -- arm P0 is a copy with NO source edit at all, and it
# must reproduce the baseline record site-for-site or every other arm is void.
param([Parameter(Mandatory = $true)][string]$Name)
. <blocks>\mongodriver\lab\env.ps1

$src = "<blocks>\mongodriver\prov"
$dst = "<blocks>\mongodriver\probe\$Name\prov"
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Force $dst | Out-Null

foreach ($tree in Get-ChildItem $src -Directory) {
  $to = Join-Path $dst $tree.Name
  robocopy $tree.FullName $to /E /XD docs test /NFL /NDL /NJH /NJS /R:1 /W:1 | Out-Null
}
# robocopy exit codes below 8 are success
if ($LASTEXITCODE -ge 8) { throw "robocopy failed rc=$LASTEXITCODE" }
$mb = [math]::Round((Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
"probe cache $Name built: $dst  ($mb MB)"
