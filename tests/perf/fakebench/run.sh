#!/usr/bin/env bash
# The whole survey, start to finish, re-runnable.
#
#   bash tests/perf/fakebench/run.sh <root> <worktree>
#
# <root> holds the driver project and all output; <worktree> is the scriptc
# checkout whose packages/{compiler,cli}/dist are already built.
#
# The driver project is materialized here rather than assumed, because the
# environment IS a measurement: the first pass of this survey ran against a
# project with no pg/mysql2/ioredis/mongodb installed and reported 51
# "Cannot find module" sites as if they were compiler blockers. They were
# not. A store backend that zapo's own `run-all-stores.cjs` drives has to
# be installed before the compiler can be asked anything about it.
set -uo pipefail

ROOT="${1:?usage: run.sh <root> <worktree>}"
WT="${2:?usage: run.sh <root> <worktree>}"
APP="$ROOT/app"
PROV_COMMIT="${FB_PROV_COMMIT:-250f9af5229a545eec28ddbd3e8774a397cdb0bb}"
ZAPO_SRC="${FB_ZAPO_SRC:-/g/zapo-work/caches/provenance/$PROV_COMMIT}"

export SCC="$WT/packages/cli/dist/main.js"
export FB_APP="$APP"
export FB_WT="$WT"
export FB_SCC="$SCC"

if [ ! -d "$APP/node_modules/zapo-js" ]; then
  echo "== materializing driver project at $APP"
  mkdir -p "$APP"
  # G:\zapo-work is READ-ONLY test input: the tree is COPIED, never used
  # in place. The compiled `run-all-stores` binary writes a
  # bench-profiles/ directory into it on the first run.
  [ -d "$APP/tree" ] || cp -r "$ZAPO_SRC" "$APP/tree"
  cat > "$APP/package.json" <<'JSON'
{
  "name": "zapo-fakebench-driver",
  "private": true,
  "type": "module",
  "dependencies": {
    "zapo-js": "1.6.2",
    "argo-codec": "^0.2.1",
    "ws": "^8.18.0",
    "pg": "*", "mysql2": "*", "ioredis": "*", "mongodb": "*", "better-sqlite3": "*",
    "@zapo-js/store-sqlite": "1.0.2",
    "@zapo-js/store-postgres": "1.0.2",
    "@zapo-js/store-mysql": "1.0.2",
    "@zapo-js/store-redis": "1.1.0",
    "@zapo-js/store-mongo": "1.0.2"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/ws": "^8.18.1",
    "@types/pg": "*",
    "typescript": "^5.9.0"
  }
}
JSON
  cat > "$APP/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "strict": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "esModuleInterop": true,
    "types": ["node"]
  }
}
JSON
  # The store packages' peer range names a zapo-js newer than the one the
  # attested tree was published from; the tree is the subject, so the tree
  # wins and the peer check is waived rather than the version moved.
  (cd "$APP" && npm install --prefer-offline --legacy-peer-deps) || exit 1
fi

echo "== unmask"
node "$WT/tests/perf/fakebench/unmask.mjs" || exit 1

echo "== closure census"
FB_OUT="$ROOT/out" node "$WT/tests/perf/fakebench/closure.mjs" | tee "$ROOT/out/closure.md"

echo "== blocker census (as given)"
FB_OUT="$ROOT/out" FB_TAG=asgiven node "$WT/tests/perf/fakebench/census.mjs"

echo "== blocker census (unmasked)"
FB_OUT="$ROOT/out" FB_TAG=unmasked FB_BENCH=tree/packages/fake-server/bench-unmasked \
  node "$WT/tests/perf/fakebench/census.mjs"

echo "== blocker census (no --provenance-sources)"
FB_OUT="$ROOT/out" FB_TAG=noprov FB_NO_PROVENANCE=1 node "$WT/tests/perf/fakebench/census.mjs"

echo "== build survey"
FB_OUT="$ROOT/survey" FB_TIMEOUT_S=2400 node "$WT/tests/perf/fakebench/survey.mjs"

echo "== done; artifacts under $ROOT/out and $ROOT/survey"
