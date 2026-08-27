# store-*, media-utils, wam, voip — where the eight packages actually are

Block `pkgstatus`, branch `block/pkgstatus`, base main `16705f5c`.
Measured 2026-08-26 on win32 x86_64, `zig 0.16.0`, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TARGET=x86_64-windows-gnu`. Build under node v22.18.0, oracle under
v25.9.0. Sources: the provenance checkout
`250f9af5229a545eec28ddbd3e8774a397cdb0bb`, 147 non-test modules across eight
packages, copied into a lab app with every peer dependency installed.

**Every number below was produced on the `16705f5c` compiler.** Main has since
moved to `3277515a` (thirty-four merges, including the cycle-admission work);
section 9 says exactly which rows that can move and which it cannot.

Both sweeps carry two armed controls that ran in the same lane as the corpus,
and the self-test was shown to fail three separate ways before any number here
was quoted (§8).

---

## 1. The table

Read the state column before the numbers. Four states, and **a zero and an
islanded must never look alike**:

| state | meaning |
| --- | --- |
| `ANALYSED` | preflight crossed and there were statements to analyse; the numbers mean what they say |
| `ISLANDED` | preflight crossed and **nothing was analysable** — every import the module needs is fenced, so `statementsTotal` is 0 because there was no code to look at, not because the code is clean |
| `EMPTY` | a type-only module: no runtime statements exist |
| `PREFLIGHT-FAIL` | the analysis never ran; every number is **absent**, not zero |

### 1a. Default static lane (no flags), per package — 147 modules, self-test PASS

| package | modules | preflight-fail | **islanded** | analysed | reached stmts | failed | unreached stmts | unreached failed | distinct blocker MESSAGES |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `media-utils` | 4 | 0 | **0** | 4 | 23 | 2 | 88 | 4 | **4** |
| `store-mongo` | 20 | 0 | **0** | 20 | 67 | 0 | 334 | 38 | **3** |
| `store-mysql` | 22 | 0 | **0** | 22 | 150 | 0 | 267 | 35 | **3** |
| `store-postgres` | 22 | 0 | **0** | 22 | 111 | 0 | 264 | 29 | **3** |
| `store-redis` | 20 | 0 | **0** | 20 | 80 | 0 | 516 | 19 | **3** |
| `store-sqlite` | 23 | 0 | **0** | 23 | 679 | 0 | 3,679 | 198 | **2** |
| `voip` | 21 | **7** | **5** | 9 | 101 | 1 | 984 | 89 | **4** |
| `wam` | 15 | 0 | **3** | 12 | 473 | 234 | 1,232 | 143 | **7** |

**None of the five `store-*` packages has a single islanded module and none
fails preflight anywhere.** All eight islanded modules in the corpus are
`voip`'s five (`bytes`, `crypto/encryption`, `crypto/primitives`,
`crypto/ssrc`, `relay/relay-ack`) and `wam`'s three (`globals`, `registry`,
`wire/binary-writer`). Each of those scores `0 statements / 0 failed` and would
be indistinguishable from "clean" in a table without this column.

**`unreached failed` is the column that makes `failed = 0` honest.**
`store-sqlite`'s modules report 679 reached statements with **zero** failed —
and 198 failed statements in code nothing on those entry paths reaches. §4
shows what a driver that actually calls the package hits.

### 1b. The entry of each package, both lanes

`--prov` is `--provenance-sources`. Distinct refusals are counted **by
message**, never by code.

| package | entry | lane | crosses preflight? | stmts analysed | failed | blocker sites | **distinct refusals (by message)** | binary? bytes | runs? oracle |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `media-utils` | `index.ts` | default | **yes** | 11 | 1 | 4 | **4** | no | — |
| | | `--prov` | **yes** | 40 | **0** | 1 | **1** | no | — |
| `store-mongo` | `index.ts` | default | **yes** | 12 | 0 | 11 | **3** | no | — |
| | | `--prov` | **NO** | – | – | 147 | **63** | no | — |
| `store-mysql` | `index.ts` | default | **yes** | 29 | 0 | 12 | **3** | no | — |
| | | `--prov` | **yes** | 45,656 | 1 | 2 | **2** | no | — |
| `store-postgres` | `index.ts` | default | **yes** | 16 | 0 | 11 | **3** | no | — |
| | | `--prov` | **yes** | 45,643 | 1 | 2 | **2** | no | — |
| `store-redis` | `index.ts` | default | **yes** | 16 | 0 | 9 | **3** | no | — |
| | | `--prov` | **yes** | 45,643 | 1 | 2 | **2** | no | — |
| `store-sqlite` | `index.ts` | default | **yes** | 43 | 0 | 26 | **2** | no | — |
| | | `--prov` | **yes** | 45,670 | 1 | **0** | **0** | **YES** (via a driver, §3) | **MATCH** |
| `voip` | `index.ts` | default | **NO** | – | – | 2 | **2** | no | — |
| | | `--prov` | **NO** | – | – | 2 | **2** | no | — |
| | | default **+ `lib.dom.d.ts`** | **yes** | 55 | 1 | 31 | **3** | no | — |
| | | `--prov` **+ `lib.dom.d.ts`** | **yes** | 45,599 | 23 | 23 | **15** | no | — |
| `wam` | `index.ts` | default | **yes** | 130 | 73 | 95 | **6** | no | — |
| | | `--prov` | **yes** | 46,013 | 14 | 18 | **8** | via `probe-wire2` (§3) | **14/14 MATCH** |

The lane must be named for every number. **The default lane compiles each file
as its own entry and sees inside a package that would island as a package**;
`--provenance-sources` replaces the `zapo-js` island with 45,000-odd statements
of zapo-js's own attested TypeScript. A row without its lane is meaningless:
`store-postgres`'s entry is "16 statements, 0 failed" and "45,643 statements,
1 failed" at the same instant.

### 1c. Distinct blocker messages, default lane, with **distinct** sites

Raw site counts are counted once per entry that reaches them; the number that
matters is the distinct `(file, line)` count.

| package | raw | **distinct sites** | code | message |
| --- | --- | --- | --- | --- |
| `wam` | 207 | **69** | `SC1090` | calls of the generic method `'commit'` through this receiver |
| `wam` | 74 | 16 | `SC2013` | importing `'zapo-js'` requires the embedded dynamic engine |
| `wam` | 21 | **5** | `SC2013` | importing `'@vinikjkkj/wa-wam'` requires the embedded dynamic engine |
| `wam` | 10 | 2 | `SC2013` | values from the `'zapo-js'` package run in the embedded dynamic engine |
| `wam` | 10 | 2 | `SC2013` | values from the `'@vinikjkkj/wa-wam'` package run in the embedded dynamic engine |
| `wam` | 7 | 1 | `SC2020` | `'Uint8Array.from'` has no scriptc lowering yet |
| `wam` | 6 | 1 | `SC2009` | values of type `'AmbientFab[]'` — element type does not compile |
| `store-sqlite` | 92 | 26 | `SC2013` | importing `'zapo-js'` … |
| `store-sqlite` | 17 | **1** | `SC2011` | values of type `'WaSqliteStorageOptions'` have no static representation |
| `store-mysql` | 63 | 11 | `SC2013` | importing `'zapo-js'` … |
| `store-mysql` | 19 | 1 | `SC2013` | importing `'mysql2'` … |
| `store-mysql` | 17 | 1 | `SC2013` | values from the `'mysql2'` package … |
| `store-postgres` | 60 | 10 | `SC2013` | importing `'zapo-js'` … |
| `store-postgres` | 19 | 1 | `SC2013` | importing **`'@types/pg'`** … |
| `store-postgres` | 17 | 1 | `SC2013` | values from the **`'@types/pg'`** package … |
| `store-mongo` | 41 | 9 | `SC2013` | importing `'zapo-js'` … |
| `store-mongo` | 21 | 2 | `SC2013` | importing `'mongodb'` … |
| `store-mongo` | 17 | 1 | `SC2013` | values from the `'mongodb'` package … |
| `store-redis` | 37 | 7 | `SC2013` | importing `'zapo-js'` … |
| `store-redis` | 17 | 1 | `SC2013` | values from the `'ioredis'` package … |
| `store-redis` | 2 | 1 | `SC2013` | importing `'ioredis'` … |
| `voip` | 27 | 15 | `SC2013` | importing `'zapo-js'` … |
| `voip` | 7 | 1 | `SC0001` | Cannot find name `'RTCPeerConnection'` |
| `voip` | 7 | 1 | `SC0001` | Cannot find name `'RTCDataChannel'` |
| `voip` | 1 | 1 | `SC2009` | values of type `'Promise<MlowModule> \| null'` — arm does not compile |
| `media-utils` | 3 | 1 | `SC2013` | importing `'sharp'` … |
| `media-utils` | 2 | 1 | `SC2020` | `'WeakMap<Logger, Set<string>>'` has no scriptc lowering yet |
| `media-utils` | 2 | 1 | `SC2020` | `'new WeakMap'` has no scriptc lowering yet |
| `media-utils` | 1 | 1 | `SC2013` | importing `'zapo-js'` … |

**`better-sqlite3` does not appear anywhere in this table, in any lane.**
`store-sqlite` loads it through `await import(BETTER_SQLITE3_MODULE)` with a
`const` binding rather than a literal (`connection.ts:303`), and the compiler
never fences it. Of the five stores, only `store-sqlite` has no npm driver
island at all — every one of its blockers is a language construct or the
`zapo-js` island.

---

## 2. An import-site count is not a surface measurement

Every row above that says "one import" hides a behavioural surface. Measured:

| package ← npm | import sites | distinct imported names | **behavioural surface actually used** |
| --- | --- | --- | --- |
| `wam` ← `@vinikjkkj/wa-wam` | 6 | **13** | 7 value tables (`WA_WAM_WIRE_FORMAT`, `WA_WAM_EVENTS`, `WA_WAM_GLOBALS`, `WA_WAM_ENUMS`, `WA_WAM_CHANNEL_WIRE_CODES`, `WA_WAM_PROTOCOL_VERSION`, `WA_WAM_BUFFER_CONSTANTS`) + 6 types |
| `voip` ← `@roamhq/wrtc` | **1** | **1** (`default as wrtc`) | **18 distinct members** over `RTCPeerConnection`/`RTCDataChannel`, plus `MessageEvent`: `createDataChannel createOffer setLocalDescription setRemoteDescription signalingState iceConnectionState iceGatheringState onconnectionstatechange oniceconnectionstatechange onicegatheringstatechange onsignalingstatechange` and on the channel `send binaryType readyState onopen onclose onerror onmessage` |
| `media-utils` ← `sharp` | **1** | **1** (`default as sharp`) | callable as `sharp(input)` and `sharp()`, the `sharp.Sharp` type, and 5 pipeline methods: `rotate resize jpeg png toBuffer` |
| `store-mongo` ← `mongodb` | 15 | 8 | `MongoClient`, `Db`, `Collection`, `ClientSession`, `Binary`, `Document`, `AnyBulkWriteOperation`, `MongoClientOptions` |
| `store-mysql` ← `mysql2/promise` | 14 | 6 | `default as mysql`, `Pool`, `PoolConnection`, `PoolOptions`, `FieldPacket`, `ResultSetHeader` |
| `store-postgres` ← `pg` | 14 | 5 | `default as pg`, `Pool`, `PoolClient`, `PoolConfig`, `QueryResult` |
| `store-redis` ← `ioredis` | 3 | 4 | `default as Redis`, `RedisOptions`, `ChainableCommander` |

`voip ← @roamhq/wrtc` is the case the orchestrator warned about: **one import
site, one name, eighteen members.** (The orchestrator relayed 25 from a
sibling; my method — distinct members reached through `pc`/`dc`/`channel` in
`WaSctpRelay.ts` — reads 18, plus the 3 type names, 21. I report my method and
my number; the two counts differ by what is counted, not by what is there.)

---

## 3. Six binaries, five of them new, and the first native binary of a zapo store

All built with `SCRIPTC_GENERIC_SLOT=1`. **Every one was built on BOTH backends
and run against the same source under node v25.9.0.** `--dynamic` was never
used. The engine scan uses only the two markers that discriminate (`quickjs`,
`ScrDyn`); all read **0** in every binary here.

| binary | lane | bytes (LLVM) | bytes (C) | oracle | result |
| --- | --- | --- | --- | --- | --- |
| **`store-sqlite-bundle.exe`** | `--prov` | **24,138,752** | 23,943,168 | node v25.9.0 | **MATCH byte-exact, exit 0** |
| **`store-sqlite-sqlutils.exe`** | default | 657,920 | 657,920 | node v25.9.0 | **7/7 MATCH, exit 0** |
| **`store-sqlite-names2-be.exe`** | `--best-effort` | 814,592 | 816,128 | node v25.9.0 | **8/8 MATCH, exit 0** |
| `store-sqlite-names-be.exe` | `--best-effort` | 818,688 | 819,712 | node v25.9.0 | **refuses at run time**, §3b |
| `store-sqlite-open-be.exe` | `--prov --best-effort` | 922,112 | 926,720 | node v25.9.0 | **DID-NOT-RUN on both sides**, §3c |
| `wam-wire-probe2.exe` | `--prov --npm-static '@vinikjkkj/wa-wam'` | **2,812,416** | 2,871,808 | `wire/__tests__/wire.test.ts` | **14/14 MATCH, exit 0** |
| `voip-stun.exe` | `--prov` | **812,032** | 812,544 | node v25.9.0 | **7/7 MATCH, exit 0** |
| `voip-ssrc.exe` | `--prov` | **926,720** | 928,768 | node v25.9.0 | **6/6 MATCH, exit 0** |

`N WRONG→MATCH = 0, M MATCH→WRONG = 0.` The one compiler change in this block
(§7) is on the provenance **fetch** path and changes no lowering; nothing that
matched before matches differently now.

### 3a. `store-sqlite-bundle.exe` — the headline

`createSqliteStore({ path: ':memory:' })` followed by `store.stores.auth('s1')`,
compiled with `--provenance-sources`. **45,723 statements analysed, 1 failed,
and ZERO blocker-section diagnostics.** It builds on both backends without
`--best-effort`, runs, and prints exactly what node prints.

The single failed statement is not a refusal: it is the pair of **runtime
fences** in zapo-js's own `spec/proto/index.js:1` (`require()` with a run-time
specifier; constructing values other than classes declared in the program) —
statements that build and would throw only if executed. They are not.

This is the first native binary of a zapo store package's real API. Nothing in
either earlier survey reached one, because both surveyed the npm drivers rather
than zapo's own `store-*` packages.

### 3b. `store-sqlite-names-be.exe` — the awkward case, compiled on purpose

`--best-effort` turns a statement with no static lowering into a runtime throw.
The driver deliberately **executes** two of the three unlowerable statements in
`table-names.ts`. It builds, runs, and stops with

```
Uncaught Error: 'Object.freeze of a possibly-aliased value' is part of the
standard library types but has no scriptc lowering yet
[SC2020 at .../store-sqlite/table-names.ts:116]
```

That is a **refusal that names its own construct and line at run time**, not a
silent wrong answer. Its sibling `store-sqlite-names2-be.exe`, which uses the
default table names and therefore never executes those statements, prints all
eight lines byte-exactly. **The fence survives to run time and does not lie.**

### 3c. `store-sqlite-open-be.exe` — both sides fail, for different reasons

The static binary throws at zapo-js `src/util/runtime.ts:20` (`globalThis`, the
`isBunRuntime` probe). Node v25.9.0 fails one layer further out:
`better_sqlite3.node` **was compiled against a different Node.js version** —
the ABI lock the stores survey found, re-confirmed. Scored **DID-NOT-RUN**, not
WRONG: there is no oracle to match against on this path under v25.

---

## 4. The next stop, named to the file and line

### `store-sqlite` — the only store within reach, six constructs away

Driver: `openSqliteConnection({ sessionId, path: ':memory:' })` then
`exec`/`run`/`get`/`close`, under `--provenance-sources`. Preflight crosses,
**271 statements, 6 failed, and exactly six distinct messages** — not one of
them `better-sqlite3` and not one of them the `zapo-js` island:

| # | file:line | code | construct |
| --- | --- | --- | --- |
| 1 | zapo-js `src/util/runtime.ts:20` | `SC2020` | `globalThis`, read by `isBunRuntime`, called at module scope by `store-sqlite/connection.ts` |
| 2 | `store-sqlite/table-names.ts:68` | `SC2020` | `SQLITE_TABLE_NAME_PATTERN.toString()` inside `normalizeTableName`'s error template |
| 3 | `store-sqlite/table-names.ts:116` | `SC2020` | `return Object.freeze(resolved)` — freeze of a possibly-aliased value, the last statement of `resolveSqliteTableNames` |
| 4 | `store-sqlite/table-names.ts:142` | `SC1120` | `sql.replace(pattern, (token) => …)` — a function replacement over a `new RegExp(...)` built at call time in `createSqliteTableNameSqlResolver` |
| 5 | `store-sqlite/connection.ts:239` | `SC2020` | `RegExp` |
| 6 | `store-sqlite/connection.ts:452` | `SC2020` | `Promise.resolve` with an argument at a void-promise type |

Rows 2–4 are `table-names.ts` alone, and they are what stands between the
SQLite table-name resolver and a binary that needs no `--best-effort`.
**`RegExp.toString` is the cheapest of the three**: `source` and `flags` both
already lower to `regexIntrinsic` (`lower-exprs.ts:6800`), and
`RegExp.prototype.toString()` is exactly `"/" + source + "/" + flags`. It needs
either a `toString` method on `REGEX_INTRINSIC_SIGS`
(`packages/compiler/src/ir/validate.ts:59`) with a `scr_regex_to_string`
runtime companion, or a frontend composition — but there is **no sequencing IR
node**, so a frontend composition evaluates the receiver twice and would have
to be restricted to repeatable receivers. I did not take it; nobody owns it.

### `store-sqlite` in the DEFAULT lane — one root, one cascade

The whole default-lane picture of a real caller is one root cause:

```
store-sqlite/BaseSqliteStore.ts:10
  SC2011  values of type 'WaSqliteStorageOptions' have no static representation
```

`WaSqliteStorageOptions` carries `readonly logger?: Logger` (`types.ts:57`) and
`Logger` comes from the islanded `zapo-js`. The base class therefore fails to
lower, and **all fifteen `SC1090 extending classes not declared in the program
('BaseSqliteStore')` sites in the fifteen subclass stores are a cascade of that
one line** — exactly the cascade shape the stores survey described for mysql2,
here proved on a different package: under `--provenance-sources`, where
`Logger` is a compiled type, all sixteen disappear together.

### `store-mysql`, `store-postgres`, `store-redis` — two sites each, both the driver

Under `--provenance-sources` each entry crosses preflight with ~45,650
statements and **exactly two blocker sites**, both the npm driver:

| package | site 1 | site 2 |
| --- | --- | --- |
| `store-mysql` | `connection.ts:1` — `importing 'mysql2'` | `BaseMysqlStore.ts:13` — `values from the 'mysql2' package` |
| `store-postgres` | `connection.ts:1` — `importing '@types/pg'` | `BasePgStore.ts:13` — `values from the '@types/pg' package` |
| `store-redis` | `createRedisStore.ts:1` — `importing 'ioredis'` | `BaseRedisStore.ts:8` — `values from the 'ioredis' package` |

The `@types/pg` spelling is the diagnostic-quality defect the stores survey
recorded and it is **still there**: the program imports `pg` and is told about
a package it never mentions.

### `store-mongo` — the entry gets WORSE under provenance, and the reason is a tsconfig

`store-mongo`'s entry crosses preflight in the default lane and **fails
preflight under `--provenance-sources`** with 147 sites over 63 distinct
messages — all of them inside **mongodb's own TypeScript source**, which
`--provenance-sources` fetches (mongodb@6.21.0 is attested; §5).

The cause is structural, not a language fence:
**`--provenance-sources` compiles a dependency's source under the CONSUMER's
tsconfig.** mongodb's own `tsconfig.json` sets
`"useUnknownInCatchVariables": false` (with a `TODO(NODE-3659)` beside it) and
`"lib": ["es2021","ES2022.Error","ES2022.Object","esnext.disposable"]`; zapo's
packages config sets plain `strict`. Adopting mongodb's two documented option
differences in a probe tsconfig cuts the sites from **147 to 78**.

The 78 that remain are: ~60 `SC0001` inside `src/mongo_logger.ts` on
`Record<string, any> | LoggableEvent` narrowing, five missing **optional**
dependencies (`mongodb-client-encryption`, `kerberos`, `gcp-metadata`,
`whatwg-url`, `@mongodb-js/saslprep`), nine `SC1016` cycles inside mongodb's
own `src/`, and one `SC1010 the 'process' module is not supported yet` at
`src/cmap/handshake/client_metadata.ts:2`. Note also that **`lib` cannot be
adopted at all** — see §6.

### `media-utils` — one blocker under provenance

Default lane, entry: 11 statements, **1 failed**, four distinct messages —
`importing 'sharp'` (`sharp.ts:1`), `importing 'zapo-js'` (`index.ts:6`), and
`'WeakMap<Logger, Set<string>>'` + `'new WeakMap'`, both at `ffmpeg.ts:40`.

Under `--provenance-sources`, the entry is **40 statements, 0 failed, and
exactly one blocker: `importing 'sharp'` at `media-utils/sharp.ts:1`.**
`ffmpeg.ts` alone is **11/1 in the default lane and 11/0 under provenance**.
The `WeakMap<Logger, …>` blocker **does not exist in the provenance lane** —
zero mentions in the whole provenance-lane site record — because `Logger` is a
compiled type there rather than a dyn box.

`sharp` publishes **no provenance attestation** (§5), so `--provenance-sources`
can never remove that last site. The route is `--npm-static sharp` (the
remeasure survey measured it falling back on three deep `semver` requires) or
a shim.

### `voip` — two independent stops, and neither is where the brief put it

`voip`'s entry fails preflight in **both** lanes on exactly two sites:

```
voip/relay/WaSctpRelay.ts:30   SC0001  Cannot find name 'RTCPeerConnection'.
voip/relay/WaSctpRelay.ts:31   SC0001  Cannot find name 'RTCDataChannel'.
```

Adding `"lib": ["ES2020","DOM"]` to a tsconfig **does nothing** — `lib` is a
FORCED option (§6). Referencing TypeScript's own shipped `lib.dom.d.ts` into
the program with a `/// <reference path="…" />` **does**, in one step, and the
entry crosses preflight at 55 statements / 1 failed with **three** distinct
messages:

| file:line | code | what |
| --- | --- | --- |
| 29 distinct sites | `SC2013` | `importing 'zapo-js'` — removed by `--provenance-sources` |
| `voip/media/mlow-codec.ts:26` | `SC2009` | `Promise<MlowModule> \| null` — arm does not compile |
| `voip/relay/WaSctpRelay.ts:5` | `SC2013` | `importing '@roamhq/wrtc'` |

With `lib.dom.d.ts` **and** `--provenance-sources`: preflight crosses at
**45,599 statements / 23 failed**, and **voip's own residue is exactly those
two sites** — everything else is inside zapo-js's source (`URL.hostname`,
`URL.protocol`, `AbortSignal.aborted`, `TextEncoder`/`TextDecoder`, four
`emit()` arity fences in `WaClient.ts`).

So the orchestrator's warning is confirmed — **`voip` has two independent
terminal stops, not one** — but **the attribution of the second one is wrong,
and I proved it by construction**: see §9.

### `wam` — the biggest blocker is neither of the two the brief names

Default lane, entry: 130 statements, 73 failed, six distinct messages. The
largest by a factor of four is

```
69 distinct sites   SC1090  calls of the generic method 'commit' through this
                            receiver (no compiled declaration with a body
                            resolves statically here)
                            wam/synthetic/fabrications.ts, 69 lines
```

Under `--provenance-sources` that cascade is **zero**, and the entry is 46,013
statements / 14 failed over 18 sites and 8 messages, of which **12 sites are
`@vinikjkkj/wa-wam`** (5 × `importing`, 7 × `values from`) plus
`WaWamCoordinator.ts:110`. The six others: `wam/registry.ts:77` (`Number` of
unknown values), `wam/WaWamUploader.ts:88` (`Number.parseInt` runs in the
engine), `wam/synthetic/random.ts:20` (`Uint8Array.from`), and two `emit()`
arity fences in zapo-js's `WaClient.ts`.

---

## 5. Which npm packages `--provenance-sources` can ever help — a census

`--provenance-sources` is a no-op for a package with no SLSA provenance
attestation. Nobody had measured which of this corpus's dependencies have one.
Queried directly against `registry.npmjs.org/-/npm/v1/attestations`:

| package@version | attested? | source repo @ commit |
| --- | --- | --- |
| `zapo-js@1.6.2` | **yes** | `github.com/vinikjkkj/zapo` @ `250f9af5229a` |
| `mongodb@6.21.0` | **yes** | `mongodb/node-mongodb-native` @ `387b6dd29e0a` |
| `bson@6.10.4` | **yes** | `mongodb/js-bson` @ `302f96e9591c` |
| `mysql2@3.24.2` | **yes** | `sidorares/node-mysql2` @ `649e129d833d` |
| `better-sqlite3@12.11.1` | **yes** | `WiseLibs/better-sqlite3` @ `4cbc39ca582f` |
| `@vinikjkkj/wa-wam@2.3000…` | **yes** | `vinikjkkj/wa-spec` @ `1ec0d3b91d0e` |
| `pg@8.23.0` | **NO** | — |
| `@types/pg@8.23.1`, `pg-protocol@1.10.3`, `pg-types@2.2.0` | **NO** | — |
| `ioredis@5.11.1` | **NO** | — |
| `sharp@0.33.5` | **NO** | — |
| `file-type@19.6.0` | **NO** | — |
| `@roamhq/wrtc@0.10.0` | **NO** | — |
| `libmlow-wasm@0.1.1` | **NO** | — |

**`--provenance-sources` can never help `store-postgres`, `store-redis`,
`media-utils` or `voip`'s addon.** Four of the eight packages' terminal npm
blockers are unreachable by that lane, permanently, and the fleet should stop
proposing it for them.

For the three attested ones that still island, the reasons are now exact:

1. **`mysql2` — a tar accident, fixed here (§7).** Before: the fetch failed
   because mysql2's GitHub tarball contains three symlinks
   (`.cursorrules`, `.windsurfrules`, `AGENTS.md`, all → `CLAUDE.md`) and GNU
   tar on Windows cannot create a symlink without the privilege, exiting 2
   **having extracted all 662 other files**. The note read
   `Command failed: tar --force-local -xzf …; island path used`, which looks
   like a provenance verdict and is a toolchain accident.
2. **`mysql2` and `@vinikjkkj/wa-wam` — the same source-mapping rule.** With
   the tar fix, mysql2's tree is fetched and the note becomes the real one:
   `no source mapping for 'mysql2/promise' (published target: ./promise.js)`.
   wa-wam says `no source mapping for '@vinikjkkj/wa-wam' (published target:
   index.js)`. `mapEntryToSource`
   (`packages/compiler/src/frontend/provenance.ts:458`) builds its candidate
   list at lines 477–486 and **every candidate has a TypeScript extension**.
   Both packages are plain JavaScript with no build step: the published target
   IS the attested source file, and there is no `.ts` twin to find. Accepting
   the `.js` file itself would turn both static (`allowJs`/`checkJs` are FORCED
   on), and would remove 12 of `wam`'s 18 remaining provenance-lane sites.
   **I did not make that change** — its blast radius is every attested
   plain-JS package in the corpus, and it belongs with whoever owns provenance.
3. **`better-sqlite3` is attested** and there is still nothing to compile: the
   stores survey's finding stands (653 JS LOC over
   `require('bindings')('better_sqlite3.node')`).

---

## 6. `lib`, `target`, `module` and `moduleResolution` are FORCED, and that decides two rows

`packages/compiler/src/frontend/program.ts:84` sets `FORCED_OPTIONS`, applied
**after** the project's config:

```
target: ESNext   module: ESNext   moduleResolution: Bundler
customConditions: ["node"]   lib: ["lib.es2025.d.ts"]   types: []
```

and `ADOPTED_OPTIONS` (`frontend/shared.ts:282`) takes only the strictness
knobs — `strict`, `useUnknownInCatchVariables`, `noImplicitOverride`,
`skipLibCheck` and their siblings. Consequences that decide rows in §4:

- **`voip` can never be unblocked by a tsconfig `lib` change.** `DOM` is not
  adoptable; the DOM names must enter as a `.d.ts` in the program.
- **`store-mongo`'s provenance failure is half a `lib` problem** and therefore
  only half fixable by config: `useUnknownInCatchVariables` is adopted (147 →
  78 sites), mongodb's `lib` list is not.
- The remeasure survey's "with `moduleResolution` forced to `Bundler`" is
  correct and this is where it comes from.

---

## 7. The one compiler change: a tar accident is not a provenance verdict

`packages/compiler/src/frontend/provenance.ts`, `fetchSourceTree`. GNU tar on
Windows cannot create a symlink without the developer privilege and exits 2
after extracting every other member. `execFileAsync` threw, the fetch failed,
and the package islanded with a tar error in place of a reason.

The change accepts the tree **exactly when every reported failure is a symlink
creation and something was extracted**; any other tar error — truncated
archive, disk full, bad path — still throws, so a package still falls back to
the island with its real reason.

Verified: with the fix, `649e129d833dd1209ac18cae3be3426f4c86c69b` (mysql2's
attested commit, 662 files) appears in the provenance cache where it never
appeared before, and the note changes from the tar failure to
`no source mapping for 'mysql2/promise'`. `store-mysql`'s entry measures
**identically** either way (45,656 statements, 1 failed, 2 blocker sites) —
the fix changes the reported reason, not yet the outcome. It is still the right
change: the current behaviour attributes a Windows toolchain limitation to
provenance.

No lowering changed. `N WRONG→MATCH = 0, M MATCH→WRONG = 0`.

---

## 8. Method, and the controls

- **Default lane: complete.** All 147 non-test modules, one process per module,
  `analyze()` called exactly as `packages/cli/src/main.ts`'s `coverage` path
  calls it.
- **Provenance lane: all 9 entries plus 7 further modules.** The full 147 was
  not affordable: `store-postgres/index.ts` alone takes **951 seconds**,
  `store-sqlite/index.ts` 811 s, `wam/index.ts` 759 s. Slow is not hung. The
  per-module provenance sweep is marked partial everywhere it appears, and no
  per-package provenance total is quoted from it.
- **`selftest.py`, five checks, two armed controls** that ran in the same lane
  as the corpus: `typesprobe.ts` (a 4-argument `execFile`, which only real
  `@types/node` accepts) must report zero `SC0001` **and** name `@types/node`;
  `typesprobe-neg.ts` (a genuine type error) must report `SC0001`. Both sweeps
  PASS, and the self-test was **shown to fail three ways** — a dropped module,
  a blanked negative control, and a positive control carrying the fallback
  `.d.ts` signature (`Expected 1-3 arguments, but got 4.`).
- **Cross-check against the recorded survey.** My default lane reproduces
  `tests/perf/mediavoip-remeasure/sites-default-7080` exactly for the two
  packages that have not moved: `voip` 7 of 21 preflight-failed and 101/1;
  `wam` 0 of 15 and 473/234. `media-utils` moved from 12/1 to 23/2 — the `node`
  export-condition merge, and the only movement.
- **A bug in my own harness, caught by that cross-check.** `SrcLoc` carries a
  character **offset**, not a line. My first `sites.mjs` read `d.loc.line`,
  got `0` for every site, and would have collapsed every site in a file into
  one — a survey keyed on `(file, line, code, message)` with a constant line.
  Found because a 16-site dump printed `:0` sixteen times.

Paths, all under `G:\blocks\pkgstatus-lab\`, nothing at `G:\` top level:
`app/` (lab app, 147 modules + drivers + probes), `bin/` (**every binary, kept,
with a README**), `sites-default/`, `sites-prov/`, `prov/`, `prov-fix/`.
`G:\zapo-work` was read only, apart from this report.

---

## 9. What I refuted

### In this brief

1. **"a `Map` and a `Set` construct appear in one interface in one package and
   the four siblings declare neither, so do not assume family-wide idioms."**
   Refuted as stated. `Map`/`Set` constructs are **pervasive and symmetric**
   across all five `store-*` packages — 30+ sites in `store-sqlite`, 20+ in
   `store-postgres`, `store-mysql`, `store-mongo`, 8 in `store-redis`. What is
   true is the narrower fact that **no `store-*/types.ts` mentions `Map` or
   `Set` at all** — zero in all five. The advice ("do not assume family-wide
   idioms") is good; the measurement behind it does not survive.
2. **"`voip` — Entry stops at `relay/WaSctpRelay.ts:5`, `@roamhq/wrtc`."**
   The entry stops at `WaSctpRelay.ts:30` and `:31`, on `SC0001 Cannot find
   name 'RTCPeerConnection'`/`'RTCDataChannel'`. Line 5 produces **no
   diagnostic at all** in either lane, because preflight refuses before
   lowering ever looks at an import. The addon is real and one layer down —
   with `lib.dom.d.ts` in the program it becomes a blocker at exactly
   `WaSctpRelay.ts:5` — but a table that names line 5 as the entry's stop is
   naming a line the compiler never reports.
3. **"`wam` — Entry blocked by two independent blockers: `SC2008` … and
   `SC2013 importing '@vinikjkkj/wa-wam'` at five exact sites."**
   The five wa-wam sites are exactly right (`registry.ts:1`, `globals.ts:1`,
   `wire/encoder.ts:1`, `wire/WamBatch.ts:1`, `WaWamCoordinator.ts:1`).
   The `SC2008` is **not a blocker at the entry** — it is in the *unreached*
   group at `wam/plugin.ts:27` and cannot fail a build from `index.ts`. And
   neither is `wam`'s largest blocker: the **69-site `SC1090 commit` cascade**,
   four times both of them combined, which the brief does not mention.
   **Independence proved the way the orchestrator asked, by building two
   drivers**: `wam-with-plugin.ts` (imports `wamPlugin`) reports the `SC2008`
   at `plugin.ts:27`; `wam-without-plugin.ts` (imports `WaWamCoordinator` from
   the same entry) does not — and **every other row is identical**: 69 × the
   `commit` cascade, 16 + 5 + 2 + 2 `SC2013`, 1 `SC2020`, 131 statements, 74
   failed on both.
4. **"`media-utils` — Remaining: `importing 'sharp'`, and
   `new WeakMap<Logger, Set<string>>()` at `ffmpeg.ts:40`, twice."**
   True in the **default lane only**. Under `--provenance-sources` the WeakMap
   blocker does not exist — zero mentions — and `importing 'sharp'` is the
   single remaining blocker. A remaining-blocker list without its lane is half
   a claim.
5. **"the npm drivers each store leans on … `better-sqlite3`."**
   `store-sqlite` does not statically lean on `better-sqlite3` at all.
   `await import(BETTER_SQLITE3_MODULE)` with a `const` specifier
   (`connection.ts:303`) produces **no diagnostic in any lane**, and
   `better-sqlite3` appears nowhere in the 147-module default sweep.

### In the orchestrator's mid-task correction

6. **"`media/mlow-codec.ts:30`, a dynamic `import('libmlow-wasm')`, feeding the
   `SC2009` sites at `:26` and `:51/:52`."**
   The **two independent stops are confirmed**. The **cause of the second one
   is not the dynamic import**, and I proved it two ways rather than arguing:
   - `drivers/mlow-import.ts` — `import('libmlow-wasm')` kept at
     `Promise<unknown>`, nothing else — is **fully static, 100%, no blockers**.
   - `probe-mlow/mlow-codec.ts` is byte-identical to
     `pkgs/voip/media/mlow-codec.ts` **with exactly one edit**: the dynamic
     import replaced by a locally declared function of the same type. It
     produces the **identical** diagnostics — `SC2009` at `:26` (blocker),
     `:28` and `:51` (unreached).

   The stop is the three hand-written **signature-only interfaces**
   `MlowModule`, `MlowEncoder`, `MlowDecoder` at `mlow-codec.ts:9–24`, whose
   members are methods with no compiled declaration. `:52` (`decoder`) did not
   appear at any reach I could produce; driving `MLowCodec.create()` turns
   `:51` into a blocker and leaves `:52` unreached.
7. **"`ffmpeg.ts` … the count was right and the 'none failed' was wrong — it is
   11/1."** Right for the **default** lane, wrong for the provenance lane,
   where it is **11/0**. Both numbers are current; only one is true per lane.

### In `estado-stores.md`

8. **"`SC1090` fields assigned outside the constructor's top level is the
   common terminal blocker of both SQL drivers."** Confirmed refuted for a
   second reason nobody has given: **zapo's own `store-*` packages never reach
   any driver's JS at all.** The default lane refuses at the package boundary
   and the provenance lane reaches mysql2/pg not at all (no mapping / no
   attestation). Whatever is true inside `pg/lib/client.js` cannot be the
   terminal blocker of `store-postgres`, whose terminal blockers are exactly
   two sites, both `@types/pg`.
9. **"`G:\blocks\stores\lab\pg-client.patch`"** — still does not exist; the
   whole `G:\blocks\stores` tree is gone.
10. **The survey's five-driver ranking is scoped to `--npm-static`.** It never
    measured `--provenance-sources`, under which `mongodb`, `bson` and
    `mongodb-connection-string-url` **are all fetched as source** and mongodb's
    26k-LOC TypeScript enters the program. That is a completely different
    picture from "four packages stay on the island", and it makes
    `store-mongo` the only store whose entry **regresses** from crossing
    preflight to failing it when the lane is "better".

### In `estado-remeasure.md`

11. **"The DOM-shim probe for voip did not converge and I have no number from
    it. Declaring two interfaces turned two errors into eleven; declaring
    twenty members and both constructors left eight."**
    It converges in one step if you stop hand-declaring and reference
    TypeScript's own shipped `lib.dom.d.ts`
    (`node_modules/typescript/lib/lib.dom.d.ts`, 39,429 lines) into the program
    with a `/// <reference path="…" />`. `voip`'s entry then crosses preflight
    at **55 statements / 1 failed / 3 distinct messages**. The related claim
    that "`WaSctpRelay` needs at least twelve distinct members plus
    `MessageEvent`" is right about the *behavioural* surface (I measure 18
    members) and wrong as a *work estimate*: the declarations are free.
12. **"`media-utils` … `index.ts` fails preflight in both lanes on
    `fileTypeFromFile` … the member is unreachable from source."**
    Fixed by the `node` export-condition merge, which is in my base. The real
    entry now crosses preflight in **both** lanes; the survey's `probe-mu`
    workaround (the string arm dropped) is no longer needed, and where the
    probe reached 40 statements / 0 failed, the real entry now does.
13. **Both surveys quote `statementsFailed` without the unreached remainder.**
    §1a gives it per package. `store-sqlite` is the extreme: 679 reached
    statements with **0** failed, against 3,679 unreached with **198** failed.
    "0 failed" and "198 failed" describe the same package on the same day.

### Where a sibling's number and mine differ

14. **`@roamhq/wrtc`'s behavioural surface: 25 (sibling, relayed) vs 18
    (mine).** My method is distinct members reached through `pc`, `dc` and
    `channel` in `WaSctpRelay.ts`; adding the three type names
    (`RTCPeerConnection`, `RTCDataChannel`, `MessageEvent`) gives 21. I have
    not seen the sibling's method and do not dispute its number — I am naming
    mine so the next person can tell which is which. **Both refute "one
    member at one site" by an order of magnitude, which is the point.**

---

## 10. Ranking, by what it unblocks rather than by site count

1. **`store-sqlite` is one package away from a real native SQLite-backed store,
   and the package is `zapo-js`.** Under `--provenance-sources` its entry has
   **zero** blockers and a driver over its real API already builds and runs
   byte-exactly (§3a). The remaining six constructs (§4) are worth more than
   their 1-site-each ranking suggests: they are the whole open/migrate/query
   path.
2. **The provenance source-mapping rule** (§5.2) — one predicate, and it turns
   `@vinikjkkj/wa-wam` and `mysql2` from island to program. It removes 12 of
   `wam`'s 18 remaining provenance-lane sites. **Belongs to whoever owns
   provenance; I did not take it.**
3. **`voip` needs `lib.dom.d.ts` shipped, not hand-declared** — one
   `/// <reference>` is the difference between an entry that cannot be analysed
   and one that reports 3 messages. Then the vendoring sibling's work and the
   `MlowModule` interfaces are the two real stops, in that order.
4. **`media-utils` is one `sharp` away**, and `sharp` is unattested, so
   `--npm-static` or a shim is the only route.
5. **`store-postgres` / `store-redis`** are each two sites from a compiled
   store bundle, and both sites are an unattested npm driver. There is no
   provenance route; the question is vendor-or-nothing, exactly as the stores
   survey concluded — but for zapo's packages, not the drivers'.
6. **`store-mongo` last**, and for a new reason: it is the only package that
   goes backwards when the lane improves.
