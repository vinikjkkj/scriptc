#!/bin/bash
# mkbench.sh <store: memory|sqlite|postgres|mysql|redis> [bench=messaging]
# Builds $TREE/packages/fake-server/bench-<bench>-<store>/ from the PRISTINE bench dir of the fetched zapo tree (never edits the tree's own files), then applies the
# measurement ladder in order: transport (clientbench diffs + rpc-frame + inspector stub), client-only, no-profile, phase marks, qr parse, glue, one store.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
S=${1:?store}; BN=${2:-messaging}
H=$BENCH_DIR/harness; CT=$BENCH_ROOT/tests/perf/clientbench
D=$TREE/packages/fake-server/bench-$BN-$S
rm -rf "$D"; cp -r "$TREE/packages/fake-server/bench" "$D"
$BENCH_NODE $H/ladder-prekeytimeout.mjs
$BENCH_NODE $H/ladder-dealonce.mjs
( cd "$D" && patch -s -p0 server-process.ts < $CT/transport/server-process.diff && patch -s -p0 server-rpc.ts < $CT/transport/server-rpc.diff && patch -s -p0 server-rpc.ts < $BENCH_DIR/src/patches/transport-clear-timer.diff )
cp $CT/transport/rpc-frame.ts $BENCH_DIR/src/__inspector-stub.ts "$D/"
if [ "$BN" = messaging ]; then
  for l in clientonly noprofile phasemarks qrparse glue; do $BENCH_NODE $H/ladder-$l.mjs "$D"; done
fi
KEEP=$([ "$S" = memory ] && echo none || echo "$S") $BENCH_NODE $H/ladder-onestore.mjs "$D"
if [ "$S" = mysql ] || [ "$S" = postgres ]; then KEEP=$S $BENCH_NODE $H/ladder-notrace.mjs "$D"; fi
if [ "$S" = postgres ]; then $BENCH_NODE $H/ladder-pgstatic.mjs "$D"; fi
if [ "$S" = mysql ]; then $BENCH_NODE $H/ladder-poolorder.mjs "$D"; $BENCH_NODE $H/ladder-mysqlstatic.mjs "$D"; $BENCH_NODE $H/ladder-disableeval.mjs "$D"; fi
echo "built $D"
