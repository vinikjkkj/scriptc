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

ROOT="${1:?usage: run.sh <root> <worktree> [tools-dir] [out-suffix]}"
WT="${2:?usage: run.sh <root> <worktree> [tools-dir] [out-suffix]}"
# The tools live on THIS branch; <worktree> is the compiler under test. For
# an A/B they are different checkouts, so the tool directory is separate
# from the compiler directory.
TOOLS="${3:-$WT/tests/perf/fakebench}"
SUF="${4:-}"
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

mkdir -p "$ROOT/out$SUF" "$ROOT/survey$SUF"

# FB_LANES selects which lanes run (default all). The A/B side only needs
# the flag lane and the build survey; re-running the control lanes against
# a compiler that cannot move them measures nothing twice.
LANES="${FB_LANES:-closure,asgiven,unmasked,noprov,survey}"
has() { case ",$LANES," in *",$1,"*) return 0;; *) return 1;; esac; }

if has unmasked; then
echo "== unmask"
node "$TOOLS/unmask.mjs" || exit 1
fi

if has closure; then
echo "== closure census"
FB_OUT="$ROOT/out$SUF" node "$TOOLS/closure.mjs" | tee "$ROOT/out$SUF/closure.md"
fi

if has asgiven; then
echo "== blocker census (as given)"
FB_OUT="$ROOT/out$SUF" FB_TAG=asgiven node "$TOOLS/census.mjs"
fi

if has unmasked; then
echo "== blocker census (unmasked)"
FB_OUT="$ROOT/out$SUF" FB_TAG=unmasked FB_BENCH=tree/packages/fake-server/bench-unmasked \
  node "$TOOLS/census.mjs"
fi

if has noprov; then
echo "== blocker census (no --provenance-sources)"
FB_OUT="$ROOT/out$SUF" FB_TAG=noprov FB_NO_PROVENANCE=1 node "$TOOLS/census.mjs"
fi

if has survey; then
echo "== build survey"
FB_OUT="$ROOT/survey$SUF" FB_TIMEOUT_S=2400 node "$TOOLS/survey.mjs"
fi

echo "== done; artifacts under $ROOT/out$SUF and $ROOT/survey$SUF"
