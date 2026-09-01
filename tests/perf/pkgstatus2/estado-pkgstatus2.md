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

## 5. `store-postgres` reaches a binary too, and by the same route

`store-postgres/cleanup.ts` is `store-mysql/cleanup.ts` with `Mysql` renamed to
`Pg` (`diff` is four lines, all identifiers). The twin driver
`drivers/drv-pg-cleanup2.ts` was produced by exactly that substitution and
built the same way:

| | |
| --- | --- |
| binary | `store-postgres-cleanup2.exe` |
| flags | `--provenance-sources` only, **no `--best-effort`** |
| bytes | **670,208** (LLVM) / **672,256** (C) |
| engine scan | `quickjs=0 ScrDyn=0 JS_NewRuntime=0` |
| fences in emitted C | **0** |
| oracle | node v25.9.0 — **9/9 MATCH byte-exact, exit 0, both backends** |

---

## 6. `store-redis` reaches a binary — a third one, on a different module

`store-redis/helpers.ts` is the mirror image of `cleanup.ts`: its `ioredis`
import is `import type Redis from 'ioredis'` (erased), and its `zapo-js/util`
import is a **value** import, so it needs `--provenance-sources` and nothing
else. `scanKeys` and `deleteKeysChunked` take a live `Redis` and are
deliberately not driven; everything else in the module is.

| | |
| --- | --- |
| binary | `store-redis-helpers.exe` |
| driver | `drivers/drv-redis-helpers.ts` → `pkgs/store-redis/helpers.ts` |
| flags | `--provenance-sources` only, **no `--best-effort`** |
| bytes | **813,568** (LLVM) / **815,104** (C) |
| engine scan | `quickjs=0 ScrDyn=0 JS_NewRuntime=0` |
| fences in emitted C | **0** |
| oracle | node v25.9.0 — **21/21 MATCH byte-exact, exit 0, both backends** |

It drives `bytesToHex` / `hexToBytes` round-tripping, `toBytesOrNull` over
null / undefined / empty-string / `Uint8Array`, `toStringOrNull`,
`assertSafeKeyPrefix` (accept, reject, empty), `uint8Equal` and
`uint8TimingSafeEqual` (equal, unequal, length-mismatch), `toRedisBuffer`
(`Buffer.from` over a `Uint8Array`'s backing store, then `.toString('hex')`),
and `safeLimit` including the throwing arm.

**Running total: `N …→MATCH = 6`** (three binaries × two backends),
**`M MATCH→WRONG = 0`**.

**One method note, paid for by a first attempt.** The first `store-redis-helpers`
build ran 20 of 21 lines identically and scored DIFF on line 21, because the
driver let `safeLimit(0, 50)` throw: node prints a source-quoted stack trace,
the binary prints one `Uncaught Error: invalid query limit: 0` line. That is an
uncaught-exception **format** difference, not a wrong answer — but a driver that
ends in an uncaught throw can never score MATCH. Every throwing arm in these
drivers is caught and its `.message` printed.

---

## 7. The npm drivers: `--npm-static` peels the whole dependency tree, and all three SQL/KV drivers stop at ONE mechanism

None of this was measured before. The previous survey measured
`--provenance-sources` for the stores and recorded `--npm-static` only for
`sharp`.

`--npm-static <pkg>` compiles only the packages **named**, and refuses at the
first dependency that is not named — which is why a single-package opt-in reads
like a hard refusal:

| package, named alone | island fallback reason |
| --- | --- |
| `pg` | `SC1010: the 'pg-types' module is not supported yet` |
| `mysql2` | `SC1010: the 'lru.min' module is not supported yet` |
| `ioredis` | `SC1010: the 'debug' module is not supported yet` |
| `mongodb` | `SC1010: the 'bson' module is not supported yet` |
| `sharp` | `SC1010: the 'semver/functions/coerce' module is not supported yet` |

**Name the transitive closure and the trees compile.** One `--npm-static` list
per driver, measured:

| driver package | packages named | **compiled statically** | still island |
| --- | --- | --- | --- |
| `pg` | 14 | **13** — `pg-types pg-protocol pg-pool pg-connection-string pgpass pg-int8 pg-cloudflare postgres-array postgres-bytea postgres-date postgres-interval xtend split2` | `pg` itself |
| `mysql2` | 13 | **12** — `lru.min denque generate-function iconv-lite long named-placeholders seq-queue sqlstring aws-ssl-profiles safer-buffer sql-escaper is-property` | `mysql2` itself |
| `ioredis` | 12 | **11** — `debug denque cluster-key-slot redis-errors redis-parser standard-as-callback lodash.defaults lodash.isarguments ms supports-color @ioredis/commands` | `ioredis` itself |

**All three then stop at the same wall, and it is a compiler mechanism, not a
package fact:**

```
pg       island fallback (its inferred export surface breaks 18 import sites in program files …)
mysql2   island fallback (its inferred export surface breaks  9 import sites in program files …)
ioredis  island fallback (its inferred export surface breaks  3 import sites in program files …)
```

`packages/compiler/src/index.ts:464` is the consumer-anchored attribution:
`--npm-static` types the program against a surface **inferred from the
package's JS**, and the names these three stores import are exactly the ones
inference cannot reach — `Pool`, `PoolClient`, `PoolConfig`, `QueryResult`;
`Pool`, `PoolConnection`, `PoolOptions`, `FieldPacket`, `ResultSetHeader`;
`RedisOptions`, `ChainableCommander` — **type-only exports, which have no JS
value to chase** (the compiler's own comment at `index.ts:417` says exactly
this). Each of the three packages ships a `.d.ts` that declares every one of
those names; the static lane does not read it.

**`ioredis` is 3 import sites from a static `store-redis`**, `mysql2` is 9 and
`pg` is 18. That is the smallest gap in this corpus and it is one mechanism
shared by three packages — worth more than any per-package work below it.

### 7a. The `@types/pg` misattribution is not cosmetic — it closes the `auto` route

With `--npm-static auto` the compiler does not try `pg` at all. It tries the
package the misattribution names:

```
@types/pg  island fallback (auto: no runtime JS entry resolves)
zapo-js    island fallback (its inferred export surface breaks 49 import sites …)
```

`@types/pg` is a types-only package, so of course no runtime JS entry resolves.
The program imports `pg`, which has a good JS entry and which **does** compile
when named explicitly. The wrong package name in the diagnostic is the same
wrong name the opt-in machinery acts on.

---

## 8. `media-utils` — CANNOT reach a binary, and the chain is three packages deep

1. Every module of `media-utils` except `types.ts` statically imports
   `./sharp`, which is `import sharp from 'sharp'` at `sharp.ts:1`
   (`index.ts` for the two thumbnail methods, `ffmpeg.ts:17` for the video
   path). There is no driver that reaches a runtime surface of this package
   while avoiding it, and an **import** fence is not deferrable by
   `--best-effort`.
2. `sharp` publishes **no provenance attestation**, so `--provenance-sources`
   can never reach it — a registry fact from the previous survey that cannot
   have moved.
3. `--npm-static sharp` declines with
   `SC1010: the 'semver/functions/coerce' module is not supported yet`. Naming
   sharp's closure compiles `color color-convert color-string color-name
   simple-swizzle is-arrayish detect-libc` — **7 of 9 static** — and the wall
   becomes `semver` itself:

   ```
   semver  island fallback (SC1013: require() below code that can reach its
           binding 'parseOptions' — Node initializes the binding AT the require
           and throws ReferenceError on any earlier access, which is not
           modeled — move the require above the code that can run first)
   ```

4. **Behind `semver` there is a native addon.** `node_modules/@img/sharp-win32-x64`
   is installed and `sharp`'s runtime loads `sharp.node` from it. No static lane
   compiles that, so even with SC1013 fixed the image path would need an FFI
   binding or a substitute module — which would no longer be "media-utils
   compiled", and this report does not claim it as one.

**Verdict: `media-utils` is ANALYSABLE (60 statements, 52 static, 86%) and
reaches no binary.** Its first measured wall is `SC1013` inside `semver`; its
last is libvips through `sharp.node`.

---

## 9. `store-mongo` — CANNOT reach a binary either, and a different blocker at every layer

1. `store-mongo` is the only store with **no** module that avoids its npm
   driver at run time. All fifteen store classes extend `BaseMongoStore`, which
   imports `assertSafeCollectionPrefix` from `./helpers`, and `helpers.ts:1` is
   `import { Binary } from 'mongodb'` — a **value** import used as a value:
   `new Binary(bytes)` (`helpers.ts:11`) and `value instanceof Binary` (`:15`).
   Only two of `store-mongo`'s twenty modules value-import `mongodb`
   (`helpers.ts`, `createMongoStore.ts`); every other one is `import type`. But
   those two sit under everything.
2. The `--npm-static` closure for `mongodb` gets four layers in and names a
   different blocker at each:

   ```
   mongodb                        SC1010: the 'mongodb-connection-string-url' module …
   mongodb-connection-string-url  SC1010: the 'whatwg-url' module …
   whatwg-url                     SC1013: require() below code that can reach its binding 'Impl'
   tr46                           SC1012: require() of JSON modules are not supported yet
   bson                           the program does not typecheck against its inferred surface
                                  (type-only declarations and .d.ts type guards have no JS value
                                  inference can chase)
   ```

   `webidl-conversions punycode @mongodb-js/saslprep sparse-bitfield
   memory-pager` all compile statically.
3. `--provenance-sources` makes `store-mongo` **worse** — the only package in
   the corpus that regresses when the lane improves — and the previous survey's
   reason (mongodb's own tsconfig, `useUnknownInCatchVariables` adopted but its
   `lib` list FORCED) is a structural fact this block did not need to
   re-measure.

**Verdict: `store-mongo` is ANALYSABLE (56 statements, 52 static, 92%) and
reaches no binary.** Its blockers are `SC1013`, `SC1012` and an inferred-surface
failure, in three third-party packages, none of them zapo's code.

---

## 10. `import type` erases the import fence but NOT the type

This is the rule that decides which module of each store is reachable, and it
cost two builds to learn precisely.

`store-mysql/helpers.ts` and `store-postgres/helpers.ts` have exactly the shape
that made `cleanup.ts` work: every npm import is `import type`
(`FieldPacket`, `ResultSetHeader` from `mysql2/promise`; `QueryResult` from
`pg`), and the only value import is `zapo-js/util`. Both drivers over their
full export list **fail to build under `--provenance-sources`**, 9 errors each:

| | `store-mysql/helpers.ts` | `store-postgres/helpers.ts` |
| --- | --- | --- |
| errors | **9** | **9** |
| the root | 3 × `SC2011 values of type 'QueryOutput'` at `helpers.ts:13,17,21` | 3 × `SC2013 values from the '@types/pg' package` at `helpers.ts:12,16,20` |
| cascade | 5 × `SC2004` on `queryRows` / `queryFirst` / `affectedRows` | the same 5 |
| driver's own | 1 × `SC1090` `.buffer` outside `new DataView(x.buffer, …)` / `Buffer.from(x.buffer, …)` | the same |

`QueryOutput` is `[unknown, FieldPacket[]]` — a **local** type alias whose
element type comes from `mysql2`. The import was erased; the type was not, and
a value at that type fences exactly as if the package had been imported for its
values. The same fence appears on the `pg` side wearing the `@types/pg` name
again.

So the reachable surface of `store-mysql` and `store-postgres` is not "modules
whose npm imports are `import type`" — it is **modules none of whose reached
declarations has an npm type in its signature**. `cleanup.ts` qualifies because
its four `import type` names come from `zapo-js/store`, which
`--provenance-sources` compiles; `helpers.ts` qualifies only for the seven of
its ten exports that never name a driver type.

---

## 11. The status table, stated as the objective asks it to be stated

Four outcomes, and **`ISLANDED`/`UNMEASURED` is a fifth state, never a zero.**

| package | state | reaches a binary? | oracle, both backends | flagless errors | `--best-effort` | fences in emitted C |
| --- | --- | --- | --- | --- | --- | --- |
| **`store-mysql`** | ANALYSABLE (52 stmts, 90% static) | **YES**, TWO — `store-mysql-cleanup2.exe`, `store-mysql-helpers2.exe` | **9/9 and 16/16 MATCH byte-exact** | 16 (entry driver) / **0** (both module drivers) | not needed | **0** |
| **`store-postgres`** | ANALYSABLE (38 stmts, 92% static) | **YES**, TWO — `store-postgres-cleanup2.exe`, `store-postgres-helpers2.exe` | **9/9 and 16/16 MATCH byte-exact** | 15 / **0** | not needed | **0** |
| **`store-redis`** | ANALYSABLE (94 stmts, 96% static) | **YES** — `store-redis-helpers.exe`, `--provenance-sources` | **21/21 MATCH byte-exact** | 13 / **0** | not needed | **0** |
| **`store-mongo`** | ANALYSABLE (56 stmts, 92% static) | **no** | — | 15 | 12, still fails | **absent** (no C emitted) |
| **`media-utils`** | ANALYSABLE (60 stmts, 86% static) | **no** | — | 11 | — | **absent** |
| `store-sqlite` (`names`) | ANALYSABLE | yes, `--best-effort` | **TRAP** at `table-names.ts:116` | 4 | 4 fences | **4** |
| `store-sqlite` (`open`) | ANALYSABLE | yes, `--prov --best-effort` | **DID-NOT-RUN** — no oracle under v25 | — | — | — |

**Not one package in this corpus is islanded, and not one fails preflight.**
Every state above is `ANALYSABLE`: each entry crosses preflight with real
statements to look at (38 to 94 in the default lane), so every count is a
measurement of code the compiler read. The number that would have exposed an
island is the `statements analyzed` column of `scriptc coverage`, run for every
one of the five, and it is non-zero everywhere.

Where a number would have been a lie, this report writes **absent**: a build
that stops emits no C translation unit, so `store-mongo` and `media-utils` have
**no fence population at all** — not a fence count of zero.

**Score: `N …→MATCH = 10`** — five new binaries, each on both backends —
**`M MATCH→WRONG = 0`.** No binary in this block was built with `--dynamic`;
`quickjs`, `ScrDyn` and `JS_NewRuntime` all read **0** in every one.

### What each of the five needs next, in the order the measurements justify

1. **The `--npm-static` inferred-surface rule** (`index.ts:464`) —
   `ioredis` is **3** import sites from static, `mysql2` **9**, `pg` **18**, and
   all three packages' entire dependency trees already compile. One mechanism,
   three packages, and it is the difference between a helper-module binary and
   a real `createRedisStore(...)` binary. The names it cannot reach are
   type-only exports; every one of the three packages ships a `.d.ts` that
   declares them.
2. **The `@types/pg` misattribution** — it is not cosmetic. `--npm-static auto`
   acts on the wrong package name and reports `no runtime JS entry resolves`
   for a types-only package, so the automatic route is closed for
   `store-postgres` specifically.
3. **`'in' on 'number' receivers`** (`SC1090`) — the single refusal in
   `store-mysql/cleanup.ts` and `store-postgres/cleanup.ts`, at
   `'unref' in this.timer`. It is the whole difference between a cleanup binary
   that can `start()` and one that cannot.
4. **`globalThis` with an `as`-cast receiver** (§12) — a defect, not a missing
   feature, and it stands in front of every `store-sqlite` driver that opens a
   connection.
5. **`SC1013` (require below its binding) and `SC1012` (require of JSON)** —
   these two account for `semver` (⇒ `sharp` ⇒ `media-utils`), `whatwg-url` and
   `tr46` (⇒ `mongodb` ⇒ `store-mongo`). Two constructs, two packages that
   currently have no route at all.
6. `store-mongo`'s `new Binary(...)` need and `sharp.node` are the two places
   where a static lane needs a real runtime, not a compiler change.

---

## 12. The one compiler defect this block isolated, with a minimal reproduction

`packages/compiler/src/frontend/lowering/surfaces.ts`,
`absentGlobalMemberValue`. Its own fence text tells the programmer:

> spell the member optional — `(globalThis as { X?: T }).X` — and the read
> compiles

zapo-js's `src/util/runtime.ts:20` is written **exactly** that way:

```ts
export function isBunRuntime(): boolean {
    return typeof (globalThis as { readonly Bun?: unknown }).Bun !== 'undefined'
}
```

and it does not compile:

```
$ scriptc coverage drivers/globalthis-probe.ts
  blockers:  ×1  'globalThis' is part of the standard library types but has no
                 scriptc lowering yet  SC2020
$ SCRIPTC_ABSENTGLOBAL_WHY=1 scriptc coverage drivers/globalthis-probe.ts
  [absentglobal] decline=undeclared globalThis.Bun
```

**Why**, read off the source: the function unwraps parentheses, `as`,
`satisfies` and `!` from the receiver to prove it is `globalThis`
(`surfaces.ts:2336-2344`) and then looks the property up on the **unwrapped**
receiver's type — `L.checker.getPropertyOfType(L.typeOf(recv), name)`. The
`as` cast that declares the member optional is discarded before the lookup that
needs it, so `gp === undefined` and the function declines at `"undeclared"`.
The chain then fences on the receiver and blames `globalThis`, which is
precisely the mis-blame the comment at `surfaces.ts:2448` says it raised the
member fence to avoid.

**Positive control that the surrounding machinery works**: the same read
against a receiver whose declared type carries the optional member compiles at
100% —

```ts
declare const gt: { readonly Bun?: unknown }
console.log('bun:', typeof gt.Bun)     // statements analyzed 2, compile statically 2 (100%)
```

so what fails is specifically "the cast on the `globalThis` receiver is not
honoured by the lookup", not the optional-member fold.

**This block did not take the fix.** It is a lowering change, it needs the full
gate, and two other blocks are live with a gate in flight. What it does is name
the defect, the file, the function, the decline step, the minimal reproduction,
the positive control, and the consumer that pays for it: `isBunRuntime()` is
called at module scope by `store-sqlite/connection.ts`, so it is the **first**
of the six constructs between `store-sqlite` and a flagless connection binary,
and it is the one that makes `store-sqlite-open-be.exe` throw at run time.

A fix must not simply honour any user cast: `(globalThis as { fetch?: T }).fetch`
must **not** fold to `undefined`, because node v25.9.0 has `fetch`. The safe
shape is the one the file already argues for — a name **measured** absent from
node's own `globalThis` (the `NODE_ABSENT_GLOBALS` table, which today is
consulted only for JavaScript sources). `Bun` and `Deno` belong in that table
on the same evidence the five names already there were admitted on.

---

## 13. The other two binaries, and every binary's numbers in one place

Trimming `queryRows` / `queryFirst` / `affectedRows` out of the driver — the
three declarations whose signatures name a driver type (§10) — leaves them
unreached, and the remaining seven exports of each `helpers.ts` build flagless:

| binary | package | module | flags | bytes LLVM / C | lines | oracle |
| --- | --- | --- | --- | --- | --- | --- |
| `store-mysql-cleanup2.exe` | `store-mysql` | `cleanup.ts` | `--provenance-sources` | 670,208 / 672,256 | 9 | **9/9 MATCH** |
| `store-postgres-cleanup2.exe` | `store-postgres` | `cleanup.ts` | `--provenance-sources` | 670,208 / 672,256 | 9 | **9/9 MATCH** |
| `store-redis-helpers.exe` | `store-redis` | `helpers.ts` | `--provenance-sources` | 813,568 / 815,104 | 21 | **21/21 MATCH** |
| `store-mysql-helpers2.exe` | `store-mysql` | `helpers.ts` | `--provenance-sources` | 810,496 / 811,520 | 16 | **16/16 MATCH** |
| `store-postgres-helpers2.exe` | `store-postgres` | `helpers.ts` | `--provenance-sources` | 810,496 / 811,520 | 16 | **16/16 MATCH** |

Every row: **both backends**, byte-exact against node v25.9.0, exit 0,
`quickjs=0 ScrDyn=0 JS_NewRuntime=0`, **0 fences** in the emitted C, and
**no `--best-effort`**.

`store-mysql-helpers2` and `store-postgres-helpers2` are the same 16 lines
because the two `helpers.ts` files differ only in the driver type they name and
in one error string (`tablePrefix must contain only letters, numbers, and
underscores` is identical in both); the two binaries are byte-identical in size
and were built from separately generated drivers.

### These binaries cross the attested/published boundary, which makes the MATCH stronger

The brief warns about a binary that passes because the attested tree and the
published artifact agree by construction. Here the two are **not** the same
file and the driver exercises the difference: the binary compiles zapo-js's
attested TypeScript (`src/util/collections.ts`, `src/util/bytes.ts` at
`250f9af5229a`) while node runs the published
`node_modules/zapo-js/dist/util/collections.js`. `bytesToHex`, `hexToBytes`,
`normalizeQueryLimit` (including its throwing arm), `uint8Equal`,
`uint8TimingSafeEqual` and `toBytesView` are executed on both sides and agree
byte-for-byte — so the MATCH is evidence that source and dist agree on those
six functions, not an artefact of reading the same bytes twice.

**Identifiers these drivers stay clear of**: no `@vinikjkkj/wa-wam` name
appears anywhere on any of these five build paths (`store-mysql`,
`store-postgres` and `store-redis` do not depend on it), so the additive-lines
hazard the brief describes cannot apply. Nothing in any driver reads a key of
an attested data table; every printed line is computed by zapo's or the store
package's own code.

---

## 14. Method, controls, and what this block did not do

**What was run**, in order: the positive control (`hello.ts`, MATCH, 0 fences);
`scriptc coverage` on all five package drivers to establish ANALYSABLE and rule
out an island; flagless `scriptc build` on all five; `--best-effort`
`scriptc build` on the four stores; `--npm-static` single-package and
transitive-closure `coverage` runs for `pg`, `mysql2`, `ioredis`, `mongodb` and
`sharp`; `--provenance-sources` builds on **both backends** for seven drivers;
`store-sqlite-names` rebuilt `--best-effort`; the `store-sqlite-open` oracle
re-run under v25.9.0; and two `globalThis` probes with `SCRIPTC_ABSENTGLOBAL_WHY`.

**Controls.**
- *Positive*: `hello.ts` — the harness reports a clean program as MATCH with
  **0** fences, so the zeros in §13 are findings and not the harness's default.
- *Negative, unplanned but real*: three drivers of mine failed and the harness
  said so precisely — `safeLimit` arity (`SC0001`), an uncaught throw scoring
  DIFF on exactly the line that threw, and `.buffer` outside `Buffer.from`
  (`SC1090`). A harness that cannot fail cannot be trusted when it passes.
- *Provenance-fetch audit*: every `--provenance-sources` build log was scanned
  for `fetch failed` / `ECONN` / `ENOTFOUND` at the **top** of the full log, not
  a tail. **Zero hits.** All five builds carry
  `provenance: zapo-js@1.6.2 ← …@250f9af5229a (source compiles statically)`;
  the only island notes are the two expected ones (`mysql2`: no source mapping
  for `mysql2/promise`; `ioredis`/`pg`: no attestation published). The scan
  proved it can detect something by finding those notes.
- *Engine scan*: `quickjs` / `ScrDyn` / `JS_NewRuntime` counted with `strings`
  on every binary produced, both backends. All zero. `--dynamic` was never
  passed to any command in this block.

**What this block did NOT do, stated so nobody assumes it.**
- **No compiler source was changed and no gate was run.** Two other blocks are
  live and one has a gate in flight; the brief asks to be told first. Every
  result above is from `scriptc` as built from `7417b09f`, and the worktree's
  only changes are under `tests/perf/pkgstatus2/`, which nothing in the gate
  runs.
- **`store-sqlite`'s six-construct list was not shortened.** `RegExp.toString`,
  `Object.freeze` of a possibly-aliased value and the `SC1120` function
  replacement are still what stands between `table-names.ts` and a flagless
  binary, and `globalThis` is still what stands in front of `connection.ts`.
- **`--npm-static` was measured, not fixed.** The three inferred-surface
  numbers (3 / 9 / 18) are a diagnosis; the fix is a frontend change with a
  wide blast radius and belongs to whoever owns `npm.ts`.
- **The `better-sqlite3` install was not rebuilt.** A `npm rebuild` under
  v25.9.0 would need a Windows toolchain this host does not have, and swapping
  the lab's binding would change what the previous survey measured. The verdict
  stands as **DID-NOT-RUN (oracle unavailable on this install)**, with the ABI
  numbers quoted so the next person can decide.

**Paths**, all under `G:\blocks\pkgstatus2-lab\` and `G:\blocks\pkgstatus2\`,
nothing at `G:\` top level: `app/` (a copy of the previous block's lab app —
`G:\blocks\pkgstatus-lab` was neither modified nor deleted), `bin/` (every
binary, its stdout, its oracle's stdout, both build logs and the emitted C TU),
`diag/` (every diagnostic log), `estado-pkgstatus2.md` (this file).
Everything is mirrored into the worktree at `tests/perf/pkgstatus2/` and
committed.
