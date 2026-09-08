#!/bin/bash
# ladder.sh -- the islanded-type substitution ladder, for the three drivers
# whose packages island (ioredis, mysql2/promise, pg).
#
# Four arms per driver, and the third one is what makes the others readable:
#   A  baseline   the 26-line shape: a type-only import of an islanded
#                 package's type, used as a FIELD type, base and subclass in
#                 DIFFERENT modules
#   B  probe      ONE line substituted, line-neutral: the same shape with a
#                 locally-declared structural type in place of the import
#   C  A/A control  a byte-identical copy of A in a different directory
#   D  position   the same islanded type in a METHOD PARAMETER, never a field
#
# A harness that cannot report "no difference" may not be trusted when it
# reports one. Arm C must read exactly what arm A reads. If C differs from A,
# every B-vs-A delta in this run is noise and the run is void.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh" || exit 1
cd "$LAB/napp" || exit 1
SITES="$WT/tests/perf/storestatus/sites"
mkdir -p "$SITES" "$OUT"
echo "### ladder  head=$(git -C "$WT" rev-parse --short HEAD)  node=$(node --version)"
echo "### typecheck first: a plain-tsc error would make every refusal below meaningless"
node "$WT/node_modules/typescript/bin/tsc" --noEmit --strict --target ES2020 --module NodeNext \
  --moduleResolution NodeNext --esModuleInterop --skipLibCheck --types node \
  redismod.ts redismodB.ts redismodC.ts redismodD.ts \
  mysqlbase.ts mysqlbaseB.ts mysqlbaseC.ts mysqlbaseD.ts \
  pgbase.ts pgbaseB.ts pgbaseC.ts pgbaseD.ts > "$OUT/ladder-tsc.log" 2>&1
tscrc=$?
echo "### tsc rc=$tscrc (0 = the fixtures are valid TypeScript)"
head -20 "$OUT/ladder-tsc.log"
for pair in "redismod:R-A" "redismodB:R-B" "redismodC:R-C" "redismodD:R-D" \
            "mysqlbase:M-A" "mysqlbaseB:M-B" "mysqlbaseC:M-C" "mysqlbaseD:M-D" \
            "pgbase:P-A" "pgbaseB:P-B" "pgbaseC:P-C" "pgbaseD:P-D"; do
  src="${pair%%:*}"; name="ladder-${pair##*:}"
  printf '%-14s ' "$name"
  node "$HERE/sites.mjs" "$src.ts" "$SITES/$name.json" --provenance-sources
done
