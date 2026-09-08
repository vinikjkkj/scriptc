# The --npm-static escape, chased one level at a time.
#
# Both packages that publish no provenance attestation and sit on store-mongo's
# critical path fell back with a NAMED reason:
#   sparse-bitfield -> SC1010: the 'memory-pager' module is not supported yet
#   whatwg-url      -> SC1010: the 'tr46' module is not supported yet
# so this adds those transitive deps, and separately tests routing
# @mongodb-js/saslprep through its published CommonJS dist (module.exports = f,
# a form the compiler already supports) instead of its `export =` TypeScript
# source, which is the build's only error.
. <blocks>\mongodriver\lab\env.ps1
$env:SCRIPTC_PROVENANCE_SPEC_TWINS = "off"
$lab = "<blocks>\mongodriver\lab"
node "$lab\harness\guard.mjs"; if ($LASTEXITCODE -ne 0) { throw "guard refused" }

$runs = @(
  @{ n = 'npmstatic-four'; f = @('--npm-static', 'whatwg-url,tr46,sparse-bitfield,memory-pager') },
  @{ n = 'npmstatic-saslprep'; f = @('--npm-static', '@mongodb-js/saslprep') },
  @{ n = 'npmstatic-auto'; f = @('--npm-static', 'auto') }
)
foreach ($r in $runs) {
  $log = "$lab\logs\$($r.n).log"
  "RUN $($r.n)  flags: $($r.f -join ' ')" | Out-File -Encoding utf8 $log
  "NODE $(node --version)  PROV $env:SCRIPTC_PROVENANCE_CACHE  TWINS $env:SCRIPTC_PROVENANCE_SPEC_TWINS" | Out-File -Append -Encoding utf8 $log
  "HEAD $(git -C <blocks>\mongodriver\wt rev-parse HEAD)" | Out-File -Append -Encoding utf8 $log
  node "$lab\harness\sites.mjs" "$lab\napp\drivers\store-mongo.ts" "$lab\sites\$($r.n).json" --provenance-sources @($r.f) *>&1 |
    Out-File -Append -Encoding utf8 $log
  "C-FALLBACK $(Test-Path '<home>\.cache\scriptc')" | Out-File -Append -Encoding utf8 $log
  "=== GATE-EXIT rc=$LASTEXITCODE ===" | Out-File -Append -Encoding utf8 $log
}
"=== NPMSTATIC-EXIT ===" | Out-File -Append -Encoding utf8 "$lab\logs\npmstatic.log"
