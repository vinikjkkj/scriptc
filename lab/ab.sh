#!/usr/bin/env bash
# BASE-vs-BRANCH over the whole program set, in the SAME lane.
#   bash lab/ab.sh base     # stashes the tree, rebuilds dist, scores, restores
#   bash lab/ab.sh branch
# The score file is runs/ab-<side>.txt; compare-ab.sh diffs the two and
# reports "N WRONG->MATCH, M MATCH->WRONG". M must be zero.
set -u
side=$1
. /g/blocks/twobyte/lab/env.sh
cd /g/blocks/twobyte || exit 1
if [ "$side" = base ]; then
  git stash push -u -m "twobyte-ab" -- packages/compiler/src packages/runtime/src >/dev/null || exit 1
fi
(cd packages/compiler && node node_modules/typescript5/bin/tsc -p tsconfig.json) >/dev/null 2>&1
(cd packages/cli && node ../../node_modules/typescript/bin/tsc -p tsconfig.json) >/dev/null 2>&1
OUT=/g/blocks/twobyte-lab/runs/progs-$side bash lab/run.sh lab/progs/*.ts tests/corpus/7324-*.ts tests/corpus/7325-*.ts tests/corpus/7326-*.ts \
  > /g/blocks/twobyte-lab/runs/ab-$side.txt 2>&1
if [ "$side" = base ]; then
  git stash pop >/dev/null || echo "STASH POP FAILED -- restore by hand"
  (cd packages/compiler && node node_modules/typescript5/bin/tsc -p tsconfig.json) >/dev/null 2>&1
  (cd packages/cli && node ../../node_modules/typescript/bin/tsc -p tsconfig.json) >/dev/null 2>&1
fi
wc -l < /g/blocks/twobyte-lab/runs/ab-$side.txt
