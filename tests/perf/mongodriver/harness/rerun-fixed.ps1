# Rebuild and rerun P2/P3/P4 after the handleOk substitute was corrected.
#
# The first version returned `{ ok: 1, response } as unknown as TResult`, which
# does not satisfy TResult: it swapped 8 SC1090 for 7 SC2002 at the SAME line.
# That is the "a thin stub does not isolate a variable, it changes the program"
# trap, and the differ caught it because it reports identities, not counts.
# The corrected substitute throws, so the body returns `never` and TResult is
# unconstrained.
. <blocks>\mongodriver\lab\env.ps1
$lab = "<blocks>\mongodriver\lab"
foreach ($a in @('P2', 'P3', 'P4')) {
  Remove-Item "$lab\sites\$a.json" -ErrorAction SilentlyContinue
  & "$lab\harness\mkprobe.ps1" -Name $a | Out-Null
  node "$lab\harness\patch-arm.mjs" "<blocks>/mongodriver/probe/$a/prov" $a
  if ($LASTEXITCODE -ne 0) { throw "patch $a failed rc=$LASTEXITCODE" }
  $prov = "<blocks>\mongodriver\probe\$a\prov"
  & "$lab\run-arm.ps1" -Name $a -Prov $prov -Twins off
  node "$lab\harness\verify-arm.mjs" "$lab\sites\$a.json" ($prov -replace '\\', '/') 2>&1 |
    Out-File -Append -Encoding utf8 "$lab\logs\$a.log"
  if ($LASTEXITCODE -ne 0) { "ARM $a FAILED VERIFICATION" | Out-File -Append -Encoding utf8 "$lab\logs\rerun.log"; Remove-Item "$lab\sites\$a.json" -ErrorAction SilentlyContinue }
  else { "ARM $a ok (corrected substitute)" | Out-File -Append -Encoding utf8 "$lab\logs\rerun.log" }
}
"=== RERUN-EXIT ===" | Out-File -Append -Encoding utf8 "$lab\logs\rerun.log"
