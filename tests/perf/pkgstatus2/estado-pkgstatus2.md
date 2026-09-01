# Remeasure: store-*, media-utils — status on main `7417b09f`

Block `pkgstatus2`, branch `block/pkgstatus2`, worktree `G:\blocks\pkgstatus2`,
lab `G:\blocks\pkgstatus2-lab`. Base main **`7417b09f`** (the previous survey,
`G:\blocks\pkgstatus-lab\estado-pkgstatus.md`, was measured on `16705f5c` plus
one fetch-path commit — the compiler has moved a long way since).

Host: win32 x86_64, `zig 0.16.0`, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_GENERIC_SLOT=1`.
Compiler built and every build run under **node v25.9.0** (`node -v` verified
in the same shell); the oracle is **node v25.9.0 + tsx** on the same source.
`--dynamic` never used; engine scan (`quickjs` / `ScrDyn` / `JS_NewRuntime`)
reads **0** in every binary below.

Lab app is a copy of the previous block's `app/` (the eight zapo packages at
provenance checkout `250f9af5229a…`, every peer dependency installed).
`G:\blocks\pkgstatus-lab` was **not** modified or deleted.

**Positive control run first**: `drivers/hello.ts` builds on both backends,
runs, and MATCHes the oracle byte-exact (657,408 bytes both backends,
`quickjs=0 ScrDyn=0`), and its emitted C carries **0** fences. The harness can
therefore report a clean program as clean; every non-zero below is a difference
it detected, not a default.

---

## 1. Phase 1 — the four-outcome table, default lane, measured on `7417b09f`

Every row is a real `scriptc build` on **both** backends. "flagless" is no
flags; "`--best-effort`" adds only that flag. Diagnostics are counted from the
build log as `- error SC\d{4}:` sites; **fences** are counted from the emitted
**C TU** with `rg -a -o '\[SC[0-9]{4} at [^]]*\]'`.

| driver | package | state | flagless errors | `--best-effort` errors | binary? | LLVM / C bytes | fences in C | oracle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `drivers/drv-media.ts` | `media-utils` | **ANALYSABLE** (60 stmts, 52 static, 86%) | **11** sites / 10 distinct | — | **no** | — | absent (no C emitted) | — |
| `drivers/drv-mongo.ts` | `store-mongo` | **ANALYSABLE** (56 stmts, 52 static, 92%) | **15** | **12** | **no** | — | absent | — |
| `drivers/drv-mysql.ts` | `store-mysql` | **ANALYSABLE** (52 stmts, 47 static, 90%) | **16** | **13** | **no** | — | absent | — |
| `drivers/drv-postgres.ts` | `store-postgres` | **ANALYSABLE** (38 stmts, 35 static, 92%) | **15** | **12** | **no** | — | absent | — |
| `drivers/drv-redis.ts` | `store-redis` | **ANALYSABLE** (94 stmts, 91 static, 96%) | **13** | **10** | **no** | — | absent | — |
| `drivers/store-sqlite-names.ts` | `store-sqlite` | **ANALYSABLE** | **4** | **4** fences | **YES** | 819,712 / 820,736 | **4** | **TRAP** (§3) |

**None of the five is islanded.** Every one crosses preflight and has real
statements analysed, so the numbers in the table are measurements and not the
artefact the objective warns about. The `fences in C` column reads **absent**,
not zero, for the five that do not build: a build that stops emits no C TU, so
there is no fence population to count.

### 1a. `--best-effort` does NOT unblock any of the four stores

This is the headline of Phase 1 and it is new. `--best-effort` *lowers* each
store driver's error count (15→12, 16→13, 15→12, 13→10) by deferring the
`SC2004` use-site cascade and one of the two `SC2011` type fences into runtime
throws — **and the build still fails**, because what is left is `SC2013`
*import* fences, which are not deferrable:

| driver | flagless | `--best-effort` | what `--best-effort` removed | what remains, and it is a wall |
| --- | --- | --- | --- | --- |
| mongo | 15 | 12 | 2 × `SC2004`, 1 × `SC2011 WaMongoStoreConfig` | 8 × `SC2013 'zapo-js'`, 2 × `SC2013 'mongodb'`, 1 × values-from-`mongodb`, 1 × `SC2011 WaMongoStoreResult` |
| mysql | 16 | 13 | same shape | 10 × `zapo-js`, 1 + 1 × `mysql2`, 1 × `SC2011` |
| postgres | 15 | 12 | same shape | 9 × `zapo-js`, 1 + 1 × **`@types/pg`**, 1 × `SC2011` |
| redis | 13 | 10 | same shape | 7 × `zapo-js`, 1 + 1 × `ioredis`, 1 × `SC2011` |

So for these four packages the flagless number is **larger** than the flagged
one, the opposite direction from the bundle the brief cites (3 flagless vs 38
under `--best-effort`). Both directions are real and both are explained by the
same rule: `--best-effort` converts *statement* refusals and only those. A
program whose walls are all statement-level shows more under the flag (it gets
to lower further); a program whose walls are *import* and *type* fences shows
fewer, and still does not build.

### 1b. The `@types/pg` misattribution is still there on `7417b09f`

`store-postgres` imports `pg`. The compiler reports, at
`pkgs/store-postgres/connection.ts:1` and `BasePgStore.ts:13`, a package the
program never mentions:

```
error SC2013: importing '@types/pg' requires the embedded dynamic engine
error SC2013: values from the '@types/pg' package run in the embedded dynamic engine
```

Recorded by the stores survey, recorded again by the previous survey,
**reproduced here on the current compiler**.

---

## 2. `media-utils` — the `sharp` island is a `semver` require chain, not the native addon

Measured, not assumed. `--npm-static sharp` was run and **named its own
reason**:

```
npm packages compiled statically (--npm-static):
  sharp  island fallback (SC1010: the 'semver/functions/coerce' module is not supported yet)
```

`sharp` publishes no provenance attestation (previous survey §5, a registry
fact that cannot have moved), so `--provenance-sources` can never reach it;
`--npm-static` reaches it and refuses **three requires deep inside `semver`**,
before anything in `sharp` itself and before `sharp.node` is ever mentioned.
The build's site count is **identical with and without `--npm-static sharp`**
(11 sites / 10 distinct either way) — the flag changes the *note*, not yet the
outcome.

`media-utils`'s remaining default-lane blockers are 2 × `SC2020` on
`WeakMap<Logger, Set<string>>` / `new WeakMap` (`ffmpeg.ts:40`) and the
`SC2004` cascade — the previous survey measured both as **absent under
`--provenance-sources`**, where `Logger` is a compiled type.

**Every module of `media-utils` except `types.ts` transitively imports
`sharp`** (`index.ts` → `./sharp`, and `ffmpeg.ts:17` → `./sharp` for the
video-thumbnail path), so there is no submodule driver that reaches a binary
while avoiding it.

---

## 3. Phase 1 — the two open `store-sqlite` binaries, both re-run on `7417b09f`

### 3a. `store-sqlite-names-be.exe` — still a TRAP, reproduced exactly

Built `--best-effort`, both backends, **819,712** (LLVM) / **820,736** (C)
bytes — a few hundred bytes larger than the previous survey's 818,688 /
819,712, so this is a fresh build on the current compiler, not a cached one.
`quickjs=0 ScrDyn=0 JS_NewRuntime=0`. It runs, prints its first two lines
byte-exactly, and then stops with

```
Uncaught Error: 'Object.freeze of a possibly-aliased value' is part of the
standard library types but has no scriptc lowering yet
[SC2020 at .../store-sqlite/table-names.ts:116]
```

Scored **TRAP**, on both backends: a refusal that names its own construct and
line, not a wrong answer. Node prints 12 lines; the binary prints 2 and refuses.

**Two fence numbers, each with its flag.** Flagless: **4** build errors
(`SC2020 RegExp.toString` at `table-names.ts:68`, `SC2020 Object.freeze` at
`:116`, `SC1120` function-replacement-over-a-runtime-regex at `:142`, and
`SC2001 'never'` at the driver's own line 33). `--best-effort`: **4** fences in
the emitted C, the same four `(code, file, line)` — this program's walls are
all statement-level, so the flag defers every one of them and the two counts
agree. That is the opposite of the bundle the brief cites and the same rule
(§1a).

### 3b. `store-sqlite-open` — the oracle half is now exact, and it is an install artefact

The previous survey scored this **DID-NOT-RUN on both sides**. Re-run under
node v25.9.0, the oracle side fails with a number, not a guess:

```
Error: The module '…\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 141.
  at openBetterSqlite (…/store-sqlite/connection.ts:311:16)
```

`build/Release/` is a **locally built** V8-ABI binding, ABI 127 = node v22 —
the lab's own install, not a Node-API prebuild. So the oracle cannot run this
driver under v25.9.0 **on this lab install**; the verdict is
**DID-NOT-RUN (oracle unavailable)**, and it is a property of the lab's
`node_modules`, not of `better-sqlite3` (which does publish prebuilds) and not
of the compiler.

The static side's cause is separately reconfirmed, with a four-line probe
rather than a whole build: **`globalThis` still has no lowering** on
`7417b09f`.

```
$ scriptc coverage drivers/globalthis-probe.ts        # the exact zapo-js shape
  blockers:  ×1  'globalThis' is part of the standard library types but has
                 no scriptc lowering yet  SC2020
```

and with `SCRIPTC_ABSENTGLOBAL_WHY=1` the compiler names its own decline step:
`decline=undeclared globalThis.Bun`. §5 says exactly why that is a defect and
not a missing feature.

---

## 4. Phase 2, first result — **`store-mysql` reaches a binary**

`store-mysql-cleanup2.exe`, `--provenance-sources`, **no `--best-effort`**,
both backends:

| | |
| --- | --- |
| driver | `drivers/drv-mysql-cleanup2.ts` → `pkgs/store-mysql/cleanup.ts` |
| flags | `--provenance-sources` only |
| bytes | **670,208** (LLVM) / **672,256** (C) |
| engine scan | `quickjs=0 ScrDyn=0 JS_NewRuntime=0`, both binaries |
| fences in emitted C | **0** |
| oracle | node v25.9.0 — **9/9 MATCH byte-exact, exit 0, both backends** |

This is the **first native binary of `store-mysql`**. `N …→MATCH = 2` (LLVM and
C), `M MATCH→WRONG = 0`.

### How it was found, and it is a two-step measurement, not a guess

1. **`cleanup.ts` is the only module of `store-mysql` whose every import is
   `import type`** — `WaDeviceListStore`, `WaGroupMetadataStore`,
   `WaMessageSecretStore`, `WaRetryStore` from `zapo-js/store`, all erased. It
   touches `mysql2` nowhere. `store-postgres/cleanup.ts` is the same file with
   `Mysql`→`Pg` renamed (diff: 4 lines).
2. **In the default lane it still does not build**, and the shape is the
   cascade the previous survey described for `BaseSqliteStore`: **10 errors,
   9 of them `SC1090` in the driver** (`new MysqlCleanupPoller` ×3,
   `p.cleanup`, `q.start` ×2, `q.stop` ×2, `q.cleanup`) — all downstream of
   **one** line:

   ```
   pkgs/store-mysql/cleanup.ts:21:22 - error SC2013: values from the 'zapo-js'
   package run in the embedded dynamic engine
     21 |     private readonly retry: WaRetryStore | undefined
   ```

   The class declaration is rejected because one field's type is a value from
   the island, and every use of the class inherits it. Under
   `--provenance-sources`, where `WaRetryStore` is compiled, **all ten go**.
3. What was left after that was **exactly one** refusal, and it is worth
   naming because it is small and general:

   ```
   pkgs/store-mysql/cleanup.ts:59:47 - error SC1090: 'in' on 'number' receivers
     59 |  if (typeof this.timer === 'object' && 'unref' in this.timer) {
   ```

   `ReturnType<typeof setInterval>` includes `number`, and `'unref' in x`
   over a `number` arm has no lowering. That statement lives in `start()`.
   **The driver that calls `start()` fails to build; the driver that does not
   call it builds flagless** — `start()` is then unreached, and unreached
   statements cannot fail a build. Both drivers are kept
   (`drv-mysql-cleanup.ts`, `drv-mysql-cleanup2.ts`) so the difference is one
   file apart, and the second one is the binary above.

**What the driver stays clear of** (the brief's provenance warning): it names
`MysqlCleanupPoller` and nothing else. It reads no key of any attested data
table, and `store-mysql` has no `@vinikjkkj/wa-wam` on its path at all — the
only attested package on this build's path is `zapo-js@1.6.2`, whose compiled
source supplies **types only** here (`WaRetryStore` and its three siblings are
`import type`). The nine printed lines are all produced by
`cleanup.ts`'s own code: an aggregate of zero tasks, four constructor
validation messages, one `typeof`, and a stop-before-start no-op.
