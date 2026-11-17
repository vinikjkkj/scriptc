#!/bin/bash
# rest-build.sh <backend> <outdir>   (SCC_CLI = the compiler's packages/cli/dist/main.js)
# Builds the REST app (tests/bench/rest/zapo-rest-mysql.ts, the user's app, never edited here) with the rig's dependencies installed beside it
# (tests/driver-rigs/package.json + lockfile, the same pins the box's rmy dir uses). Output: <outdir>/zapo-rest-mysql-<backend>.bin and .build.log
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
BE=${1:?backend}; O=${2:?outdir}; TAG=${3:-}; : "${SCC_CLI:?}"
APP=$BENCH_DIR/rest/zapo-rest-mysql.ts
[ -f "$APP" ] || { echo "tests/bench/rest/zapo-rest-mysql.ts is not in the repo: add the REST app copy first (see tests/bench/README.md)"; exit 2; }
R=$BENCH_WORK/rest; mkdir -p "$R" "$O"
if [ ! -d "$R/node_modules" ]; then
  cp $BENCH_ROOT/tests/driver-rigs/package.json $BENCH_ROOT/tests/driver-rigs/pnpm-lock.yaml $BENCH_ROOT/tests/driver-rigs/tsconfig.json "$R/"
  ( cd "$R" && pnpm install --frozen-lockfile --ignore-workspace --ignore-scripts --config.strict-dep-builds=false --config.minimumReleaseAge=0 )
fi
cp "$APP" "$R/zapo-rest-mysql.ts"
cd "$R"
s=$(date +%s); set +e
$BENCH_NODE --max-old-space-size=${NODE_HEAP_MB:-12288} "$SCC_CLI" build zapo-rest-mysql.ts --provenance-sources --npm-static mysql2 ${EXTRA_ARGS:-} --backend "$BE" -o "$O/build-$BE$TAG.bin" > "$O/zapo-rest-mysql-$BE$TAG.build.log" 2>&1
rc=$?; set -e
secs=$(( $(date +%s) - s ))
echo "rc=$rc secs=$secs" | tee -a "$O/zapo-rest-mysql-$BE$TAG.build.log"
[ $rc -eq 0 ] && cp "$O/build-$BE$TAG.bin" "$O/zapo-rest-mysql-$BE$TAG.bin"
echo "rest $BE$TAG rc=$rc build_secs=$secs" >> "$O/build-summary.txt"
exit $rc
