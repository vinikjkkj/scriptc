#!/bin/bash
# build.sh <store> <backend c|llvm> <outdir> [variant plain|census] [tag]    env: SCC_CLI, EXTRA_ARGS (extra scriptc flags, e.g. --layout-profile), SCRIPTC_PROF_CFLAGS (kept)
# Builds the messaging bench of <store> with the scriptc CLI at $SCC_CLI. SCRIPTC_CACHE_DIR (set by the caller) makes the second variant of the same
# (sha, program, codegen flags) re-run only the C compiler: SCRIPTC_PROF_CFLAGS is not part of the lowering key. The binary is written to
# <outdir>/messaging-<store>-<backend>[-census].bin through ONE fixed build path (the cache key includes -o), then copied.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
S=${1:?store}; BE=${2:?backend}; O=${3:?outdir}; VAR=${4:-plain}; TAG=${5:-}
: "${SCC_CLI:?path of packages/cli/dist/main.js}"
mkdir -p "$O"
extra=(); [ "$S" = mysql ] && extra=(--npm-static mysql2)
if [ "$VAR" = census ]; then
  D=$BENCH_ROOT/tests/perf/dyncensus
  export SCRIPTC_PROF_CFLAGS="${SCRIPTC_PROF_CFLAGS:-} -include $D/scr_dyn_census.h -include $D/scr_str_census.h -I$D -DSCR_DYNCEN_ARM=64 -DSCR_STRCEN_ARM=64 -DSCR_DYNCEN_PSLOTS=4194304"
fi
suffix="$TAG"; [ "$VAR" = census ] && suffix="-census$TAG"
BUILD=$O/build/messaging-$S-$BE$suffix.bin; mkdir -p "$O/build"
cd "$ZB_APP"
s=$(date +%s)
set +e
$BENCH_NODE --max-old-space-size=${NODE_HEAP_MB:-7000} "$SCC_CLI" build "tree/packages/fake-server/bench-messaging-$S/messaging.bench.ts" --backend "$BE" --provenance-sources ${EXTRA_ARGS:-} "${extra[@]}" -o "$BUILD" > "$O/messaging-$S-$BE$suffix.build.log" 2>&1
rc=$?
set -e
secs=$(( $(date +%s) - s ))
echo "rc=$rc secs=$secs variant=$VAR" | tee -a "$O/messaging-$S-$BE$suffix.build.log"
[ $rc -eq 0 ] && cp "$BUILD" "$O/messaging-$S-$BE$suffix.bin"
# LAB (structdump): every emitted class struct, as text (uploaded with the *.log files)
ls -la "$O/build" > "$O/structs-$S-$BE$suffix.log" 2>&1 || true
for f in "$O"/build/*.c; do [ -f "$f" ] && awk '/^struct sc_o_[A-Za-z0-9_]+ \{/,/^\};/' "$f" >> "$O/structs-$S-$BE$suffix.log"; done
for f in "$O"/build/*.ll; do [ -f "$f" ] && grep -E '^%sc_o_[A-Za-z0-9_]+ = type' "$f" >> "$O/structs-$S-$BE$suffix.log"; done
echo "$S $BE $VAR$TAG rc=$rc build_secs=$secs" >> "$O/build-summary.txt"
exit $rc
