#!/bin/bash
# Collect EVERY module named across ALL island-fallback lines each round.
probe="$1"; pkgs="$2"
cd /g/blocks/stores/wt && . ./lab-env.sh
for i in $(seq 1 60); do
  out=$(timeout 900 node packages/cli/dist/main.js coverage \
        /g/blocks/stores/lab/drivers/probes/$probe.ts --npm-static "$pkgs" 2>&1)
  # every "the 'X' module is not supported yet", root package name only
  mods=$(echo "$out" | rg -o "the '([^']+)' module is not supported yet" -r '$1' \
        | sed -E 's#^(@[^/]+/[^/]+).*#\1#; s#^([^@/][^/]*)/.*#\1#' | sort -u)
  added=""
  for m in $mods; do
    case ",$pkgs," in *",$m,"*) ;; *) pkgs="$pkgs,$m"; added="$added $m";; esac
  done
  nfb=$(echo "$out" | rg -c "island fallback" || echo 0)
  echo "[$i] npkgs=$(echo $pkgs|tr ',' '\n'|wc -l) fallbacks=$nfb added:${added:- NONE}"
  if [ -z "$added" ]; then
    echo "=== TERMINAL round $i ==="; echo "$out"; echo "PKGS: $pkgs"; exit 0
  fi
done
echo "=== 60 rounds exhausted"; echo "$out"; echo "PKGS: $pkgs"
