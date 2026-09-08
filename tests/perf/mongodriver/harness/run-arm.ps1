# run-arm.ps1 -Name <arm> [-Prov <cacheRoot>] [-Twins off|on]
# One substitution arm: same compiler, same entry, same flags; only the
# provenance cache root (and optionally the spec-twin switch) differ.
#
# The override is PASSED to run-sites.ps1 as a parameter, never set in the
# environment first: run-sites.ps1 sources env.ps1 on its first line and that
# reset an environment-set override, so six arms silently read the unpatched
# tree and each reported 0 cleared / 0 added.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Prov = "",
  [string]$Twins = "off"
)
& <blocks>\mongodriver\lab\run-sites.ps1 `
  -Entry <blocks>\mongodriver\lab\napp\drivers\store-mongo.ts `
  -OutName $Name -Prov $Prov -Twins $Twins `
  --provenance-sources
