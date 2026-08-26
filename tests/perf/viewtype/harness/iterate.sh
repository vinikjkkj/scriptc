#!/usr/bin/env bash
# Drive one shape's probe to a program that BUILDS, recording which cell each
# refusal belonged to.  Stops when a build succeeds, when the disabled set
# stops growing (a fixpoint that still fails is reported as such, never as
# success), or when a diagnostic cannot be attributed to a cell.
set -u
source /g/blocks/viewtype/lab/env.sh
S="$1"          # shape key: D | U | K
DIR="$2"        # directory holding probe-$S.ts
BACKEND="${3:-llvm}"
L=/g/blocks/viewtype/lab
cd "$DIR" || exit 2
[ -f "disabled-$S.json" ] || echo '[]' > "disabled-$S.json"
for i in 1 2 3 4 5 6 7 8 9 10; do
  DIS=$(cat "disabled-$S.json")
  node "$L/gen.mjs" "$S" "probe-$S.ts" "cells-$S.json" "$DIS" >/dev/null
  node "${CLI:-$WTU/packages/cli/dist/main.js}" build "probe-$S.ts" --backend "$BACKEND" -o "out-$S-$BACKEND.exe" > "build-$S.log" 2>&1
  RC=$?
  NERR=$(grep -c " - error SC" "build-$S.log")
  NDIS=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).length)" "disabled-$S.json")
  echo "iter=$i backend=$BACKEND rc=$RC errors=$NERR disabled-before=$NDIS"
  if [ "$RC" -eq 0 ]; then echo "BUILD-OK"; exit 0; fi
  node "$L/attribute.mjs" "cells-$S.json" "build-$S.log" "disabled-$S.json" > "attr-$S.json"
  ORPH=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).orphan.length)" "attr-$S.json")
  if [ "$ORPH" != "0" ]; then
    echo "ORPHAN-DIAGNOSTICS=$ORPH -- attribution incomplete, stopping"
    node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).orphan.join('\n'))" "attr-$S.json"
    exit 3
  fi
  node "$L/merge-reasons.mjs" "reasons-$S.json" "attr-$S.json"
  node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).disabled))" "attr-$S.json" > "disabled-next-$S.json"
  if cmp -s "disabled-$S.json" "disabled-next-$S.json"; then echo "FIXPOINT-STILL-FAILING"; exit 4; fi
  mv "disabled-next-$S.json" "disabled-$S.json"
done
echo "ITER-BUDGET-EXHAUSTED"
exit 5
