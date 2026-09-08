# storestatus — the true status of every `store-*` package, `main` `f91fcd55`

The clause this answers, in the user's words:

> *"the `store-*` packages, media-utils, wam and voip must reach binaries, and
> their status must be measured and true (islanded is never zero)."*

This is the `store-*` half. It is a **survey, not a fix**: nothing under
`packages/` was changed and nothing in `<zapo-work>` or any provenance
checkout was written to.

Companion documents, each one thing:

| file | what it holds |
| --- | --- |
| [`CORRECTIONS-pkgstatus-0907.md`](CORRECTIONS-pkgstatus-0907.md) | which rows of the previous survey are now wrong, and why |
| [`THREE-PACKAGES.md`](THREE-PACKAGES.md) | `store-mysql` and `store-postgres` measured directly against `store-redis` |
| [`LADDER.md`](LADDER.md) | the mechanism, reproduced in 26 lines, four arms, three drivers |
| [`INSTRUMENTS.md`](INSTRUMENTS.md) | every control, each shown failing |
| [`HOST-NOTES.md`](HOST-NOTES.md) | the machine while these numbers were taken |
| [`harness/README-harness.md`](harness/README-harness.md) | the rig, and how to re-run it |

---

## 0. What a reader should take away

**1. Two of the six reach a binary today, strict, `--backend c`, no
`--best-effort`, and both run and match node byte-for-byte.**

* `@zapo-js/store-sqlite@1.2.0` — **28,903,936 B**, `rc=0`, `RUN exit=0`,
  **oracle MATCH**, engine-free on the armed scan, **1** non-`SC900x` runtime
  fence over 16 emitted TUs / 141,386,592 B. This is the **published npm
  package** through `--provenance-sources`, imported the way a real consumer
  imports it.
* `store-memory` — **18,467,328 B**, same verdicts, **1** fence over 12 TUs /
  95,836,403 B. It is **not a package**: the in-memory store ships inside
  `zapo-js` core.

Both fences are the same site — `SC2020` at `spec/proto/index.js:1` in the
zapo-js 1.8.2 checkout, *"part of the standard library types but has no scriptc
lowering yet"*.

**2. Three of the six fail identically, and it is one cause, not sixty.**
`store-redis`, `store-mysql` and `store-postgres` each report **39** blocker
sites — the same 39, site for site, code for code, file for file. Not "the same
histogram": the full per-site dumps were diffed with the package name folded
out and the blocker sections are identical apart from the line saying *why* the
database driver islands. All three build to `rc=1`, **`39 errors.`**, zero
uncoded refusals; build level and analyse level agree exactly.

**3. That one cause is upstream of zapo, and a zapo release will not move it.**
The package source is **byte-identical** between the v1.8.0 tag these packages
attest and the v1.8.2 tag — all five store packages, `diff -rq`, no
differences. What blocks them is that `pg` and `ioredis` publish **no
provenance attestation**, and `mysql2` publishes one whose `mysql2/promise`
subpath **has no source mapping**. A 26-line ladder reproduces the entire chain
from an islanded type alone and closes it with a one-line, line-neutral
substitution: 4 sites → 0, in all three drivers, with a byte-identical A/A arm
reading exactly what the baseline reads.

**4. `store-mongo` is not a broken store package.** Its consumer-lane analyse reports **284** blocker sites, and
**278 of them are inside `mongodb` (197) and `bson` (81)**. The store package
itself contributes **one**: `SC2011` on `WaMongoStoreConfig` at
`createMongoStore.ts:117`. The honest sentence is *"we do not fully compile
the mongodb driver"*, not *"the store package is broken"*.

**5. Every number here names its lane, and the lane is the biggest lever in the
document.** 41 alias keys are spelled by more than one mapped package with
different targets; `tsconfig` `paths` is one table per program, so **which
`zapo-js` a store package compiles against is decided by what the driver
imports**. The spec-twin fix `d2c952ca` then opened reach by about **32x** —
`store-redis` went from ~1,450 statements analysed to **46,994**. Both together
are why three rows of the previous survey now read **39** where they read 46,
and `store-sqlite`'s reads **0** where it read 7 — over a program the compiler
can actually see into.

---

## 1. Lane, flags, host state — every row names both

A site count is two facts multiplied: the driver's alias table and the flags.
Neither is optional.

| | |
| --- | --- |
| repo | `<blocks>\storestatus\wt`, worktree of `<repo>`, branch `block/storestatus` |
| `main` | **`f91fcd55`** |
| compiler build | `packages/compiler` then `packages/cli`, `tsc -p tsconfig.json` under node **v22.18.0**, rc=0/0 |
| measuring node | **v25.9.0**, read back from the **spawned** process on every run |
| zig | **0.16.0** — the tree's (`<zapo-work>\tools\zig`), not Chocolatey's 0.15.2, which builds this size class ~20 KB apart |
| tar | **GNU tar 1.35** (Git `usr/bin`), ahead of System32's bsdtar, which rejects `--force-local` and silently islands the provenance lane |
| `SCRIPTC_CC` / `SCRIPTC_TEST_CC` | `zigcc` / `zig cc` |
| `SCRIPTC_TARGET` | `x86_64-windows-gnu` |
| backend | **`--backend c`** on every build in this document |
| flags | `--provenance-sources`, strict, **no `--best-effort`** |
| caches | everything under `<blocks>\storestatus\`; `<home>\.cache\scriptc` verified **absent** before the first build and again at the end |

`--best-effort` is absent on purpose: it defers a statement with no static
lowering into a runtime throw, so a diagnostic count taken under it is not a
count of what the compiler refuses, and a site count of zero under it is not a
binary that works.

### The two lanes, and why the difference is the largest lever here

| lane | entry | what it resolves |
| --- | --- | --- |
| **CONSUMER** | `drivers/_x-<pkg>-plus-zapo.ts` — the store package **and** `zapo-js` | what a real consumer gets: the plugin exists to be handed to a `WaClient`, so a program that names the store package alone is not a program anyone writes |
| **BARE** | `drivers/<pkg>.ts` — the store package alone | what the published artifact reaches on its own attestation |

The compiler prints the reason itself, on every store run:

> `41 alias key(s) are spelled by more than one mapped package with different
> targets ('zapo-js/store', 'zapo-js/signal', 'zapo-js/auth', …); tsconfig
> "paths" is one table per program, so zapo-js's answer is used for all of them
> and @zapo-js/store-<x> compile against zapo-js's checkout for those
> specifiers`

Provenance walks bare imports in **driver-import order**, so a driver that
names `zapo-js` registers 1.8.2 before the store package is reached. In earlier
surveys that one line moved four packages by 5→32, 86→15, 6→58 and 46→39.

### The driver tree these numbers were taken against

`harness/napp-package.json`, installed at the versions below. A re-run that
resolves different versions gets different numbers and must say so.

```
zapo-js 1.8.2                 @zapo-js/store-sqlite 1.2.0    @zapo-js/store-mongo 1.2.0
@zapo-js/store-mysql 1.2.0    @zapo-js/store-postgres 1.2.0  @zapo-js/store-redis 1.3.0
better-sqlite3 12.11.1  mongodb 6.21.0  bson 6.10.4  mysql2 3.24.3  pg 8.23.0
ioredis 5.11.1  @types/node 24.13.3
```

Every store driver has the same shape — call the package's own factory, then
take one store out of each of the sixteen domains it hands back — so a
difference between two store packages is the package and not the driver. The
consumer arm is the bare arm plus **one import line and one `console.log`**.

### States, and what each means for a count

| state | meaning | what a count means |
| --- | --- | --- |
| `ANALYSED` | preflight crossed, statements analysed | the numbers mean what they say |
| `ISLANDED` | the package fell back to the island path | **UNMEASURED**, with the reason. The sites reported are the island boundary's. **Never a zero** |
| `PREFLIGHT-FAIL` | analysis never ran | every count is **absent**, not zero |
| `CRASHED` | the run died | every count is **void**. See `sites/_void-killed-b-store-sqlite.json` |
| build rc ≠ 0 | no binary, no complete C TU | the fence count is **n/a**, never 0; the engine scan is **n/a**, not clean |

---

## 2. THE ANSWER — every `store-*` package, consumer lane, `main` `f91fcd55`

Two levels, never mixed. **`analyze()` is not a build**: it stops before
`ir/validate.ts` and before both emitters, so a zero from it is not a binary.
Both levels are given for every package, and they are cross-checks on each
other.

### 2a. Build level — `--backend c`, strict, no `--best-effort`

Entry `drivers/_x-<pkg>-plus-zapo.ts` (consumer lane) except `store-memory`,
which has no package and uses `drivers/store-memory.ts`.

| package | binary? | bytes | run | oracle (node v25.9.0) | engine scan | build error SITES | uncoded refusals | compiler's own line | runtime fences (non-`SC900x`) |
|---|---|---|---|---|---|---|---|---|---|
| `@zapo-js/store-sqlite@1.2.0` | **YES** | **28,903,936** | `exit=0`, 282 B | **MATCH, byte-exact** | `quickjs=0 ScrDyn=0` (armed 1/1) | 0 | 0 | *(none — 0 errors)* | **1** over 16 TUs / 141,386,592 B |
| `store-memory` (zapo-js core) | **YES** | **18,467,328** | `exit=0`, 467 B | **MATCH, byte-exact** | `quickjs=0 ScrDyn=0` (armed 1/1) | 0 | 0 | *(none — 0 errors)* | **1** over 12 TUs / 95,836,403 B |
| `@zapo-js/store-redis@1.3.0` | **no** | n/a | n/a | n/a | **n/a — no binary**, not clean | **39** | 0 | `39 errors.` | **n/a, not 0** |
| `@zapo-js/store-mysql@1.2.0` | **no** | n/a | n/a | n/a | **n/a — no binary**, not clean | **39** | 0 | `39 errors.` | **n/a, not 0** |
| `@zapo-js/store-postgres@1.2.0` | **no** | n/a | n/a | n/a | **n/a — no binary**, not clean | **39** | 0 | `39 errors.` | **n/a, not 0** |
| `@zapo-js/store-mongo@1.2.0` | **no** | n/a | n/a | n/a | **n/a — no binary**, not clean | **284** | 0 | `284 errors.` | **n/a, not 0** |

**Build level and analyse level agree exactly on all four failing rows** —
39 = 39 three times and **284 = 284** for `store-mongo`, code for code
(`store-mongo`: 144 `SC1090`, 45 `SC2020`, 40 `SC2004`, 21 `SC2011`, 19
`SC2009`, 5 `SC1043`, 2 `SC2013`, 2 `SC2002`, 2 `SC2001`, and four codes with
one site each). Both columns are still reported separately because they are
**not the same question** and have disagreed before: at `3f3dd523` the
`store-mongo` build stopped at **1 error** (`SC1012 export = assignments` in
`@mongodb-js/saslprep`) while the survey found 242 sites. They agree here
because on this lane `saslprep` is **islanded** — evicted by the 16-package
provenance limit — so that module-link refusal never happens. §3c.

### 2b. Analyse level — `analyze()`, same entries, same flags

| package | state | stmts / failed | blocker SITES | roots | cascade `SC2004` | distinct msgs | runtime fences | advisories | unreached sites | the package's own share |
|---|---|---|---|---|---|---|---|---|---|---|
| `store-sqlite` (BARE lane) | ANALYSED | 46,963 / **0** | **0** | 0 | 0 | 0 | 1 | 53 | 7 | 0 of 0 |
| `store-memory` | not separately analysed — the **build** is the evidence: `rc=0`, 0 errors, binary runs, oracle MATCH | | | | | | | | | |
| `store-redis` | ANALYSED | 46,994 / 19 | **39** | 20 | 19 | 9 | 1 | 53 | 10 | **19 of 39** |
| `store-mysql` | ANALYSED | 47,006 / 19 | **39** | 20 | 19 | 9 | 1 | 53 | 13 | **19 of 39** |
| `store-postgres` | ANALYSED | 46,993 / 19 | **39** | 20 | 19 | 9 | 1 | 53 | 13 | **19 of 39** |
| `store-mongo` | ANALYSED | 48,647 / 177 | **284** | 244 | 40 | 180 | 1 | 55 | 1,496 | **1 of 284** |

### 2c. The BARE lane — what the published package reaches on its own attestation

The other half of the lane question, and the row `pkgstatus-0907` §5c is most
often quoted for.

| package | lane | prov packages resolved | stmts / failed | blocker SITES | roots | cascade |
| --- | --- | --- | --- | --- | --- | --- |
| `store-redis` | CONSUMER (`_x-redis-plus-zapo.ts`) | `zapo-js@1.8.2`, `@zapo-js/store-redis@1.3.0` | 46,994 / 19 | **39** | 20 | 19 |
| `store-redis` | **BARE** (`store-redis.ts`) | `@zapo-js/store-redis@1.3.0` **only** | 46,878 / 19 | **39** | 20 | 19 |
| `store-sqlite` | **BARE** (`store-sqlite.ts`) | `@zapo-js/store-sqlite@1.2.0` **only** | 46,963 / **0** | **0** | 0 | 0 |

**`store-redis` reads 39 on both lanes, to the site, to the code, to the file,
and `store-sqlite` reads 0 on both.**
The bare lane does not resolve `zapo-js` at all, and still reaches 46,878
statements — the store package's own attested checkout now answers for
`zapo-js*` specifiers out of its **tree root** `spec/`, which is exactly what
`d2c952ca` changed. The seven-site v1.8.0-core cluster that made the two lanes
differ at `3f3dd523` is gone from **both**.

This reproduces block `wamcoord`'s bare-lane figure independently, from a
different worktree and a different compiler build. `store-sqlite`'s bare lane
is the same story with a different headline: `pkgstatus-0907` records it at
**7 sites over 1,535 statements**; it is now **0 over 46,963**, with the store
package alone and no `zapo-js` resolved at all.

**Not measured, and why**: the bare lane for `store-mysql`, `store-postgres`
and `store-mongo`, and the analyse-level pass for `store-sqlite` on the
*consumer* lane. Not zero — **unmeasured**. The machine was throttled to one
job at a time mid-survey (`HOST-NOTES.md`) and these four were the lowest-value
runs left: the three failing packages read the same 39 on the lane that
matters, and `store-sqlite`'s consumer lane has a **binary** as its evidence,
which is stronger than any analyse count. `harness/queue.sh bare2`, `bare3`,
and a `consumer` stage for sqlite will produce them.



---

## 3. What is in front of each package, clustered by cause

### 3a. `store-sqlite` — nothing. It compiles.

`better-sqlite3` never reaches npm on this lane: the compiler lowers sqlite
natively. So the package has no islanded driver, and once the spec-twin fix let
the driver resolve `zapo-js` 1.8.2 the seven-site core cluster went too.

### 3b. `store-redis`, `store-mysql`, `store-postgres` — one cause, three times

The full comparison is [`THREE-PACKAGES.md`](THREE-PACKAGES.md); the mechanism
is [`LADDER.md`](LADDER.md). In one table, with `<Base>` =
`BaseRedisStore` / `BaseMysqlStore` / `BasePgStore` and `<drv>` =
`ioredis` / `mysql2` / `pg`:

| sites | code | where | what it says | whose |
| --- | --- | --- | --- | --- |
| 1 | `SC2013` | `<Base>Store.ts` | *values from the `<drv>` package run in the embedded dynamic engine* | the package |
| 16 | `SC1090` | the sixteen `*.store.ts` | *extending classes not declared in the program (`<Base>`)* | the package |
| 1 | `SC2013` | `createRedisStore.ts` / `connection.ts` | *importing `<drv>` requires the embedded dynamic engine* | the package |
| 1 | `SC2011` | `create<Pkg>Store.ts` | *values of type `Wa<Pkg>StoreConfig` have no static representation* | the package |
| 1 | `SC2011` | the driver | *values of type `Wa<Pkg>StoreResult` have no static representation* | the driver |
| 19 | `SC2004` | the driver | *uses of `s`/`c`/`r`/`create<Pkg>Store` inherit the blocker on its declaration* | the driver |

**19 of the 39 are the package's; 20 are the driver's** and would be a different
number for a different consumer. Only the 19 `SC2004` carry the compiler's
cascade marker, so a roots-vs-cascade split calls the other **20 independent
roots** — including all sixteen `SC1090` and the one `SC2013` that causes them.
Substitution says the real number is **one**.

**This is blocked on an upstream publisher, not on this compiler and not on a
zapo release** — see §4.1 and §4.3. `pg` and `ioredis` publish no provenance
attestation; `mysql2` publishes one whose `mysql2/promise` subpath has no
source mapping.

### 3c. `store-mongo` — the store package is not what is broken

**284 blocker sites, and one of them is the store package's.** By owner —
whose source the site is *in*, which is not the same question as whose fault
it is, and is reported separately for that reason:

| owner | sites | roots | cascade |
| --- | --- | --- | --- |
| `mongodb@6.21.0` `src/` | **197** | 165 | 32 |
| `bson@6.10.4` `src/` | **81** | 76 | 5 |
| the driver | 3 | 0 | 3 |
| `mongodb-connection-string-url@3.0.2` `src/` | 2 | 2 | 0 |
| **`@zapo-js/store-mongo@1.2.0`** | **1** | 1 | 0 |

That one site, opened rather than counted:

```
SC2011  packages/store-mongo/src/createMongoStore.ts:117
        values of type 'WaMongoStoreConfig' have no static representation but
        run in the embedded dynamic engine, which this build does not include
```

— the same `Wa<Pkg>StoreConfig` shape the other three store packages carry.

The 244 roots are **not one cause**. The largest clusters are 144 `SC1090`
across 52 files (37 *"constructing through a class value whose class has no
lowering"*, 21 *"extending the generic class `CommandOperation` without a
compiled concrete instantiation"*, 5 *"extending classes not declared in the
program (`MongoError`)"*), 45 `SC2020` standard-library gaps across 19 files,
21 `SC2011`, 19 `SC2009`, and a tail of nine codes with 1–5 sites each. **180
distinct messages.** This is a driver that is genuinely not fully compiled, not
a single fence.

**The honest sentence is "we do not fully compile the mongodb driver", not
"the store package is broken."**

Block `mongodriver` was working this package in more depth at the same time as
this survey. Where its numbers differ from these, compare the **lane and the
entry** first: mine is `drivers/_x-mongo-plus-zapo.ts`, the consumer lane, at
`f91fcd55`.

**A lane effect specific to this package.** The compiler resolves at most
**16** provenance packages, and on this lane it says so:

```
@mongodb-js/saslprep: skipped — provenance package limit (16) reached; island path used
```

On the bare lane at `3f3dd523` the package evicted by that limit was
`@zapo-js/native`, and `@mongodb-js/saslprep` was attested — its
`SC1012 export = assignments` was the single error that stopped that build.
**Adding one import to the driver changes which package falls off the end of
the attested set**, so for `store-mongo` the lane decides not only which
`zapo-js` is compiled but which sixteen packages are compiled at all. Any
comparison of two `store-mongo` numbers must check that list before the totals.

### 3d. `store-memory` — not a package

There is no `@zapo-js/store-memory` on npm. The in-memory store ships **inside
`zapo-js` core** (`src/store/memory`, published as `dist/store/`) and a consumer
reaches it through the `zapo-js/store` subpath. Its row is kept because the
objective names it, but it is a measurement of zapo-js core, not of a
`store-*` package.

Measured anyway, and it is one of the two binaries: **18,467,328 B**,
`--backend c`, `rc=0`, `RUN exit=0`, oracle **MATCH byte-exact**,
`quickjs=0 ScrDyn=0` against the armed `1`/`1`, and **1** non-`SC900x` runtime
fence over 12 emitted TUs / 95,836,403 bytes — the same `SC2020` at
`spec/proto/index.js:1` that `store-sqlite` carries. Provenance resolves
`zapo-js@1.8.2` and islands only `@zapo-js/native` (not installed under the
entry's `node_modules`).

The byte count is identical to `pkgstatus-0907`'s `--backend c` figure for the
same driver at `3f3dd523`, which is a useful cross-check on the whole rig: 56
commits later, the same entry, the same flags, the same size.

---

## 4. Found while measuring, not asked for

Six things this block did not set out to find.

### 4.1 A store-package release would change nothing — the sources are already identical

`diff -rq packages/<pkg>` between the two attested checkouts — `9a49e1fffdec`
(zapo `refs/tags/v1.8.0`, which **all five** published store packages attest)
and `757a8071b819` (`refs/tags/v1.8.2`) — reports **no differences at all**:

```
store-redis  22 vs 22 .ts   store-mysql 24 vs 24   store-postgres 24 vs 24
store-sqlite 27 vs 27       store-mongo 22 vs 22        -- all IDENTICAL
```

`pkgstatus-0907` §4 recorded this for `src/` and drew the right conclusion then.
Its **§0 headline 3** — *"most of what the objective is waiting on is a release,
not a compiler change"* — no longer reads correctly for the store packages: the
seven-site zapo-js-core cluster a release was to remove is **already gone at
`f91fcd55` without one**, and republishing would ship byte-identical source.
What these packages wait on is an **upstream** publisher, not a zapo one.

### 4.2 The mechanism is not about fields — arm D refutes the narrower statement

The standing statement is *"an islanded type in a **field** makes the whole
class undeclarable"*. Arm D of [`LADDER.md`](LADDER.md) puts the same islanded
type in a **method parameter** and in no field at all, and reads **4 sites,
identical to the baseline, in all three drivers**.

Position does not matter: an islanded type anywhere in a class's declared shape
rejects the declaration. This is not pedantry — it predicts the wrong thing
about the packages. `store-mysql` and `store-postgres` import `PoolConnection`
for a **method parameter** in fourteen store files each. Under the narrower
statement those fourteen are harmless *because they are not fields*. They are
in fact harmless for a different reason: their classes are already rejected for
extending a rejected base, and a rejected class is not re-reported. Fix the
base and those fourteen become live.

### 4.3 `mysql2` islands for a different reason than `pg` and `ioredis`

Identical consequence, different route out, and the compiler says so:

```
ioredis@5.11.1:  no provenance attestation published; island path used
pg@8.23.0:       no provenance attestation published; island path used
mysql2@3.24.3:   no source mapping for 'mysql2/promise' (published target: ./promise.js); island path used
```

`mysql2` **does** publish an attestation. It islands because the *subpath* the
store package imports has no source mapping. `pg` and `ioredis` need their
publishers to attest; `mysql2` needs a subpath mapping, which is a question
about this compiler's provenance resolution rather than about npm. A plan that
treats all three as "waiting on upstream attestation" is wrong for one of them.

### 4.4 On the one clean binary, a bare `SC` grep reports 6,075 refusals; there is one

| pattern over the 16 emitted TUs (141,386,592 bytes) | count |
| --- | --- |
| `SC[0-9]{4}` anywhere | **6,075** |
| of which `SC900[0-9]` — backend assertions for **correct** code | **6,073** (3,861 `SC9004`, 2,151 `SC9005`, 52 `SC9002`, 9 `SC9003`) |
| `\[SC[0-9]{4} at file:line\]` — actual runtime fences | **1** |
| the same, minus `SC900x` — what a status row may quote | **1** |

The other two bare occurrences are the *same* fence: `SC2020` appears twice on
its line, in the message and again as a string argument.

### 4.5 The emitted C is named after the ENTRY, not after `-o`

`build _x-sqlite-plus-zapo.ts -o out/c-store-sqlite.exe` writes
`out/c-store-sqlite.exe` **and** `out/_x-sqlite-plus-zapo.c`,
`…part1.c` … `…part14.c`, `…scrh`. A fence counter keyed on the `-o` basename
finds nothing beside a 28.9 MB binary. Ours printed `ABSENT, not 0` and was
fixed; one that prints `0` there produces a byte-sized, convincing false zero.

### 4.6 An `analyze()` pass costs ~1.9 GB, and half of it is invisible to a node scan

Each `sites.mjs` run peaked near **850 MB of node** *and* spawned a native
**`tsc.exe` child of a further 1.0–1.1 GB**. A process scan filtered to
`node.exe` — the obvious way to check what a block costs the box — sees about
**45%** of it. On a 40 GB box with four blocks running, that is the difference
between "three analyses fit" and "they do not". See
[`HOST-NOTES.md`](HOST-NOTES.md).

### 4.7 The provenance package limit (16) is a lane variable, not a constant

The compiler resolves at most sixteen provenance packages and names the one it
drops:

```
@mongodb-js/saslprep: skipped — provenance package limit (16) reached; island path used
```

On the **bare** `store-mongo` lane at `3f3dd523` the package that fell off the
end was `@zapo-js/native`, and `saslprep` was attested — its `SC1012 export =`
was the single error that stopped that build. On the **consumer** lane at
`f91fcd55`, `zapo-js` takes a slot and `saslprep` is the one evicted, so that
refusal never happens and the build reaches all 284 sites instead of 1.

**One added import line changes which sixteen packages are compiled from
source at all.** Two `store-mongo` numbers are not comparable until that list
is compared. The compiler prints it; `harness/tally.mjs` reproduces it under
`prov:` for every record.

