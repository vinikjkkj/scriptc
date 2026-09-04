# zapo-rest — a compiled WhatsApp REST service over the SQLite store

`app/zapo-rest.ts` is one entry program that compiles to a single native
executable which runs a real zapo WhatsApp client, persists to a SQLite file,
and serves zapo's public API as plain JSON over HTTP.

It exists here so the artifact is reproducible: the shipped folder is just the
built `.exe` plus generated docs.

## Build

```sh
# the app dir supplies the deps and the tsconfig; the entry path is absolute
cd tests/perf/zapo-rest/app && npm install
cd <worktree>
node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/app/zapo-rest.ts \
  -o <out>/zapo-rest.exe \
  --best-effort --provenance-sources
```

`--provenance-sources` is required: `@zapo-js/store-sqlite` is only compilable
from its attested source, and the vendored SQLite the compiler intercepts is
what the binary links (no native addon ships).

`--best-effort` is required today. A handful of zapo constructs have no static
lowering; without it the build stops on the first. With it each becomes a
per-statement runtime refusal, which `zapo-rest.ts` catches and reports as an
HTTP 501 naming the `[SCxxxx]` code — so the surface documents its own gaps
instead of hiding them. **A zero refusal-site count under `--best-effort` is
not zero refusals**; `harness/traps.sh` counts the deferred sites in the
emitted C.

### Import order is load-bearing

```ts
import { WaClient, createStore } from "zapo-js";
import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite";
```

The two provenance checkouts collide on ~39 tsconfig `paths` alias keys, the
paths table is one per program, and **the first package seen wins**. With
`@zapo-js/store-sqlite` imported first, `zapo-js`'s own `@client` / `@store`
aliases are lost and its barrel fails with 21 × `SC1014 re-exports from
packages or builtin modules`. The build log names the winner:

```
provenance: 40 alias key(s) are spelled by more than one mapped package ...
  so zapo-js's answer is used for all of them            <- what you want
  so @zapo-js/store-sqlite's answer is used for all of them  <- barrel will fail
```

## Harness

| script | what it does |
|---|---|
| `harness/surface.mjs` | enumerates zapo's public surface through the TypeScript checker (`WaClient` plus every coordinator it exposes) and writes `surface.txt` |
| `harness/coverage.mjs` | cross-references that surface against the routes the entry actually serves; writes `coverage.json` and prints the implemented/unimplemented split |
| `harness/gen-api-md.mjs` | generates `API.md`, taking each route's parameters from the handler body so the doc cannot drift from the code |
| `harness/verify.sh` | starts the binary on a fresh store, exercises the API with `curl`, kills it, restarts on the same file and diffs the row counts |
| `harness/scan.sh` | the 100%-C proof, armed: engine markers beside a `--dynamic` control and beside positive controls that must be non-zero |
| `harness/traps.sh` | counts `[SCxxxx]` deferred-refusal sites and trap sites across every emitted TU |

Run `surface.mjs` and `coverage.mjs` from inside `app/` (they need its
`node_modules` for `typescript` and the zapo types).

## repro/ambient-enum-twin — a standing divergence from Node

A minimal, self-contained reproduction of a compiled-vs-Node divergence found
while building this. `pb.d.ts` declares an ambient enum; `pb.js` is its runtime
twin, the protobufjs shape. Node prints the members; the compiled binary throws
`ReferenceError: Kind is not defined`.

```sh
node tests/perf/zapo-rest/repro/ambient-enum-twin/main.ts   # prints the values
node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/repro/ambient-enum-twin/main.ts -o /tmp/t.exe
/tmp/t.exe                                                  # ReferenceError
```

The mechanism: `lowerEnumMemberRead` (`lower-enums.ts:138`) folds an ambient
enum member to its constant **only** when `declTwinCompiled(sf)` is true, and
that asks whether the `.js` twin is in module order. `declTwinOf`
(`program.ts:409`) can only find it via `program.getSourceFile(stem + ".js")` —
but resolution handed the program the `.d.ts`, so the `.js` was never added and
`getSourceFile` returns undefined. The only thing that adds such a `.js` as a
root is `provenanceDeclSiblings()` (`provenance-registry.ts:192`), which walks
`<packageDir>/spec` — so the fold works for a provenance package and for
nothing else. Otherwise the read falls through to
`global.undefRead(<enumName>)` → `scr_undef_global_read` → `ReferenceError`.

This is deliberately **not** a corpus program: it would go red. It is the
evidence for the finding. The neighbouring stance — a twin-*less* `declare enum`
throwing, matching Node — is already pinned by `tests/corpus/1832-enum-modules`.
The twin-backed fold at `lower-enums.ts:138` has no test at all.
