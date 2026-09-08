# Everything still owed after the first arm batch, in one detached run.
#  1. rerun P2/P3/P4 with the CORRECTED handleOk substitute
#  2. the --npm-static escape: can the two packages that publish no provenance
#     attestation (whatwg-url, sparse-bitfield) be compiled from their published
#     JS instead? Both sit on store-mongo's critical path, and neither is ours.
#  3. the same, plus every other islanded package, to see the ceiling.
. <blocks>\mongodriver\lab\env.ps1
$lab = "<blocks>\mongodriver\lab"

& "$lab\rerun-fixed.ps1"

# --npm-static rides ALONGSIDE --provenance-sources; run-sites passes both.
& "$lab\run-sites.ps1" -Entry "$lab\napp\drivers\store-mongo.ts" -OutName "npmstatic-two" -Twins off `
  --provenance-sources --npm-static whatwg-url,sparse-bitfield
"NPMSTATIC-TWO done" | Out-File -Append -Encoding utf8 "$lab\logs\finish.log"

& "$lab\run-sites.ps1" -Entry "$lab\napp\drivers\store-mongo.ts" -OutName "npmstatic-auto" -Twins off `
  --provenance-sources --npm-static auto
"NPMSTATIC-AUTO done" | Out-File -Append -Encoding utf8 "$lab\logs\finish.log"

"=== FINISH-EXIT ===" | Out-File -Append -Encoding utf8 "$lab\logs\finish.log"
