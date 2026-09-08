# Runs every substitution arm sequentially, spec twins OFF (the fast lane).
#
# Two controls gate the whole set:
#   P0    a probe cache with NO source edit must reproduce base-off
#         site-for-site, or every arm is void;
#   each  verify-arm.mjs asserts, from the RECORD, that the sites really came
#         from THIS arm's tree. An arm that silently reads the wrong tree
#         reports a perfect 0-cleared/0-added, which reads exactly like
#         "this line is not the cause".
. <blocks>\mongodriver\lab\env.ps1
$lab = "<blocks>\mongodriver\lab"
$arms = @('P0', 'P1', 'P2', 'P3', 'P4', 'P5a', 'P5b')
foreach ($a in $arms) {
  if (Test-Path "$lab\sites\$a.json") { Write-Host "ARM $a already recorded, skipping"; continue }
  $prov = "<blocks>\mongodriver\probe\$a\prov"
  & "$lab\run-arm.ps1" -Name $a -Prov $prov -Twins off
  node "$lab\harness\verify-arm.mjs" "$lab\sites\$a.json" ($prov -replace '\\', '/') 2>&1 |
    Out-File -Append -Encoding utf8 "$lab\logs\$a.log"
  if ($LASTEXITCODE -ne 0) {
    "ARM $a FAILED VERIFICATION rc=$LASTEXITCODE" | Out-File -Append -Encoding utf8 "$lab\logs\all-arms.log"
    Remove-Item "$lab\sites\$a.json" -ErrorAction SilentlyContinue
  } else {
    "ARM $a ok" | Out-File -Append -Encoding utf8 "$lab\logs\all-arms.log"
  }
  Write-Host "ARM $a done"
}
"=== ALL-ARMS-EXIT ===" | Out-File -Append -Encoding utf8 "$lab\logs\all-arms.log"
