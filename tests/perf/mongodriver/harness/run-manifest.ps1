# Does routing @mongodb-js/saslprep at its PUBLISHED dist clear the build's
# only error?
#
# --npm-static cannot do it: with `--npm-static @mongodb-js/saslprep` the
# coverage report says status "static", but every saslprep site still resolves
# to the provenance checkout's TypeScript -- the provenance lane wins for a
# package it has already mapped, and the npmStatic status line does not say so.
#
# SCRIPTC_PROVENANCE_MANIFEST pre-seeds a package's source DIRECTORY and skips
# the network for it. Pointing it at node_modules/@mongodb-js/saslprep gives the
# lane the published dist, whose entry ends `module.exports = saslprep` -- the
# CommonJS form the compiler already supports -- instead of `export = saslprep`,
# which is the build's only error.
. <blocks>\mongodriver\lab\env.ps1
$env:SCRIPTC_PROVENANCE_SPEC_TWINS = "off"
$env:SCRIPTC_PROVENANCE_MANIFEST = "<blocks>\mongodriver\lab\prov-manifest.json"
$lab = "<blocks>\mongodriver\lab"
node "$lab\harness\guard.mjs"; if ($LASTEXITCODE -ne 0) { throw "guard refused" }

$log = "$lab\logs\manifest-saslprep.log"
"RUN manifest-saslprep" | Out-File -Encoding utf8 $log
"MANIFEST $env:SCRIPTC_PROVENANCE_MANIFEST" | Out-File -Append -Encoding utf8 $log
Get-Content $env:SCRIPTC_PROVENANCE_MANIFEST | Out-File -Append -Encoding utf8 $log
"NODE $(node --version)  PROV $env:SCRIPTC_PROVENANCE_CACHE  TWINS off" | Out-File -Append -Encoding utf8 $log
node "$lab\harness\sites.mjs" "$lab\napp\drivers\store-mongo.ts" "$lab\sites\manifest-saslprep.json" --provenance-sources *>&1 |
  Out-File -Append -Encoding utf8 $log
"=== GATE-EXIT rc=$LASTEXITCODE ===" | Out-File -Append -Encoding utf8 $log

# And the real build, which is the only thing that can say "reaches a binary".
$blog = "$lab\logs\build-manifest.log"
"BUILD manifest-saslprep" | Out-File -Encoding utf8 $blog
"MANIFEST $env:SCRIPTC_PROVENANCE_MANIFEST" | Out-File -Append -Encoding utf8 $blog
node "<blocks>\mongodriver\wt\packages\cli\dist\main.js" build "$lab\napp\drivers\store-mongo.ts" `
  -o "$lab\out\manifest.exe" --provenance-sources *>&1 | Out-File -Append -Encoding utf8 $blog
"BUILD-RC $LASTEXITCODE" | Out-File -Append -Encoding utf8 $blog
"C-FALLBACK $(Test-Path '<home>\.cache\scriptc')" | Out-File -Append -Encoding utf8 $blog
"=== GATE-EXIT ===" | Out-File -Append -Encoding utf8 $blog
"=== MANIFEST-EXIT ===" | Out-File -Append -Encoding utf8 "$lab\logs\manifest.log"
