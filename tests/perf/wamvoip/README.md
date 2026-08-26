# wamvoip — the three zapo packages at their PACKAGE ENTRIES

`tests/perf/mediavoip-remeasure/` measured the same three packages module by
module. This directory is about one narrower question: does each package's
**entry** compile, and if not, what exactly stops it?

Nothing here runs in the gate. `tests/perf/` is excluded from the directory
gate and no vitest file imports any of it. The one thing that DOES run in the
gate is `packages/compiler/test/node-export-condition.test.ts`, which is where
the finding this directory produced is pinned.

## Reproducing

1. **Lab tree.** `harness/lab-package.json` and `harness/lab-tsconfig.json` are
   the lab app's two files. `npm install` in a fresh directory with that
   package.json, drop the tsconfig beside it, then copy each package's `src`
   into `pkgs/<name>` from the provenance checkout:

       caches/provenance/250f9af5229a545eec28ddbd3e8774a397cdb0bb/packages/<name>/src

   **The tsconfig is not optional and is not cosmetic.** `resolveNodeTypes7`
   is guarded on `config.configFile`: with no tsconfig.json beside the entry,
   the whole tree compiles against the fallback `scriptc-node-fallback.d.ts`
   and reports refusals that do not exist — `NodeJS.Timeout` missing,
   `node:crypto` without `randomInt`, `node:net` without `isIPv6`. A first
   sweep here did exactly that and had to be thrown away.

2. **Controls, every run.** `mediavoip-remeasure/harness/typesprobe.ts` (a
   4-argument `execFile`, which only real `@types/node` accepts) must report
   ZERO `SC0001`; `typesprobe-neg.ts` must report one. A run where both are
   silent is a broken query, not a clean lane.

3. **Sites.** `harness/sites.mjs <entry> <out.json> [--provenance-sources]
   [--npm-static=a,b]` writes one module's stats and refusal sites.
   `harness/locate.mjs <out.json>` renders them as `file:line:col` — the
   diagnostics carry byte offsets, not lines.

4. **Long runs detach.** `harness/run-prov.sh` and `harness/build.sh` exist
   because the provenance analysis of either entry takes 15-18 MINUTES
   (voip 901s, wam 1078s) and a foreground shell that times out at ten
   leaves orphaned tsgo children behind. Launch them detached and poll the
   log.

5. **Gate.** `harness/gate.sh <tag>` — node v25.9.0, `SCRIPTC_TEST_WORKERS=2`,
   vitest's own exit code captured into its own variable immediately.

## The blast-radius scanner

`harness/condscan.mjs <node_modules dir>...` answers how many installed
packages resolve to a DIFFERENT file when the "node" export condition is
enabled, using the compiler's own `resolveExportsTypes` semantics (exact
subpath keys, then `*` patterns, condition objects in OBJECT KEY order,
arrays first-resolvable).

It carries two armed controls and exits non-zero if either fails:

| control | assertion |
| --- | --- |
| positive | `file-type` `"."` must move `./core.d.ts` -> `./index.d.ts` |
| negative | `zapo-js` must be SEEN in the scanned trees and must NOT move |

An absent control is a failure, not a pass: a scan that reports "nothing
changed" is only believable if it can be shown to detect a change when one is
present. Removing "node" from the scanner's proposed set makes the positive
control print FAIL, which is how that was checked rather than assumed.

## The engine-free scan

`harness/enginescan.sh <control.exe> <binary>...` counts five markers.
**Only markers non-zero in the `--dynamic` control discriminate.** Built here
against `drivers/engine-control.ts` (a two-line program that certainly embeds
the engine), `quickjs` and `ScrDyn` are non-zero and `JS_NewRuntime`,
`JS_Eval` and `__island_eval` all read ZERO — a marker that reads zero in a
binary that certainly embeds the engine would have called anything
engine-free, and is not evidence. The script prints that split every run.

## Drivers

| driver | what |
| --- | --- |
| `drivers/wam-entry-1.ts` | imports only what `wam/src/index.ts` exports as VALUES, so the whole entry graph must lower; every line it prints is deterministic (no `Math.random`, no clock), and the oracle is the same file under node v25.9.0 via `tsx` |
| `drivers/engine-control.ts` | the armed `--dynamic` control for the scan above |

## Two environment traps this block walked into

**1. No tsconfig beside the entry = the fallback `.d.ts`, silently.**
See "Reproducing" step 1. The armed controls catch it; nothing else does.

**2. `TMP` inside the worktree reddens `tests/harness/fetch-dispatcher.test.ts`,
on a clean tree.** Two cells (`c:` and `llvm:`), both with

    SC0001: Conversion of type '{ method: string; headers: {...}; dispatcher:
    Dispatcher; }' to type 'RequestInit' may be a mistake ... Type 'Dispatcher'
    is missing the following properties from type '.../undici-types/dispatcher'

The suite stages its fixture in `mkdtempSync(join(tmpdir(), ...))`. The fixture
declares its OWN structural `Dispatcher` (`client.tmpl.ts:24`) and casts an
object literal `as RequestInit` (`client.tmpl.ts:371-374`). If `tmpdir()` sits
inside the repo, the fixture's `@types/node` lookup walks up into the repo's
`node_modules` and `RequestInit.dispatcher` is undici's real class, which the
structural one does not overlap. Outside the repo the same fixture is
**210 statements, 0 failed, 0 sites**.

Measured both ways with the compiler change fully reverted in `dist`, so it is
not a regression of anything: it is where `TMP` points. `harness/env.sh` puts
tmp at `G:\blocks\wamvoip-tmp` for that reason — this block's worktree is
`G:\blocks\wamvoip` itself, where other blocks keep theirs at
`G:\blocks\<name>\wt` with `tmp` as a sibling.
