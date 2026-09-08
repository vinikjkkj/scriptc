# pkgstatus — the named packages, measured on main `3f3dd523`, 2026-09-07

> **STORE ROWS SUPERSEDED, 2026-09-08.** Measured again on `main` `f91fcd55`,
> 56 commits later, by `tests/perf/storestatus/`. The spec-twin fix `d2c952ca`
> opens reach by ~32x, so every `store-*` row below is stale in its statement
> count and three of them in their site count (46 -> 39). Which rows and why:
> **`tests/perf/storestatus/CORRECTIONS-pkgstatus-0907.md`**. Nothing here was
> measured wrongly and nothing here has been rewritten -- these are what the
> compiler did at `3f3dd523`.

The standing objective, verbatim: *"the store-\* packages, media-utils, wam and
voip must reach binaries, and their status must be measured and true (islanded
is never zero)."*

This is that measurement, on `main` at **`3f3dd523`** (2026-09-07 12:52 -03).
Nothing under `packages/` was changed by this block; every number here is a
measurement, not a claim about a fix.

**Supersedes `tests/perf/pkgrecheck/table-default.md`** (main `facbe036`,
2026-09-02, 266 commits back) and, for media-utils / voip / wam,
`tests/perf/mediavoip-remeasure/` (main `5d0e8427`, 2026-08-26). Both of those
are default-lane-heavy surveys of a **local source corpus**; this one measures
the **published npm packages** through `--provenance-sources`, which is a
different and more consequential question.

---

## 0. What a reader should take away first

1. **Three of the named subjects reach a binary today, and which zapo-js they
   are compiled against is what decides it.**
   * `store-memory` — 17,807,360 B (18,467,328 B on `--backend c`), runs, oracle
     MATCH byte-exact. It is not a package: there is no `@zapo-js/store-memory`
     on npm; the in-memory store ships inside `zapo-js` core.
   * `store-sqlite` — its own source against zapo-js 1.8.2: 47,078 statements,
     **0 failed, 0 blocker sites**, **28,903,424 B**, runs, oracle MATCH. And
     independently: `tests/perf/zapo-rest/app182` ships a 32,368,640 B service
     built on it at **zero errors and 77 advisories**.
   * `zapo-js` 1.8.2's own `WaClient` path — 46,957 statements, 0 blocker sites,
     **28,824,064 B**, runs, oracle MATCH.
2. **`media-utils` and `voip` cannot be measured through npm at all.** Neither
   publishes a provenance attestation, at any published version, so
   `--provenance-sources` islands them and the compiler says so unprompted.
   Their npm-lane numbers are the **island's** refusals, not the packages' —
   reported as **UNMEASURED**, never as a zero. Measured properly from source
   they are **27** and **59** sites, both real and both non-zero.
3. **Most of what the objective is waiting on is a release, not a compiler
   change.** The five published store packages attest tag **v1.8.0**; the
   compiler has already outgrown it. The seven-site cluster that blocks all five
   is v1.8.0's zapo-js core, and it does not exist in 1.8.2. Same for `wam`: the
   same source against 1.8.2 goes from 86 sites to 15.
4. **What a package is measured against is decided by what the DRIVER imports,
   and it moves the numbers by more than anything else here.** A driver that
   names only the store package gets the store package's attested v1.8.0 core;
   one that also names `zapo-js` -- as every real consumer must -- gets 1.8.2,
   because tsconfig "paths" is one table per program and zapo-js's answer wins
   the collision. One added import line takes `store-sqlite` from 7 blocker
   sites to **0** and `store-redis` from 46 to **39**, removing exactly the
   seven shared core sites from both and nothing else. And that **0**
   is a **28,903,936-byte binary that runs, oracle MATCH byte-exact**, built on
   the npm lane: the published store package, imported the way a real consumer
   imports it, compiles today. §5c.

5. **A cascade that does not carry the cascade code is invisible to a
   roots/cascade split.** 69 of `wam`'s 82 "roots" are one cause in one file and
   clear together. Only compiling the same source two ways showed it. §6a.


---

## 1. Lane, flags, host state

Every number in this document was produced with the flags and host state below.
A number without its lane is worthless, so the lane is named on every row.

| | |
| --- | --- |
| repo | `<blocks>\pkgstatus`, worktree of `<repo>`, branch `block/pkgstatus` |
| main | `3f3dd523` |
| compiler build | `packages/compiler` then `packages/cli`, `tsc -p tsconfig.json` under node **v22.18.0** (`harness/build.ps1`), rc=0/0 |
| measuring node | **v25.9.0**, resolved first on `PATH` and printed by every script |
| zig | **0.16.0**, the tree's (`<zapo-work>\tools\zig`), not Chocolatey's |
| tar | **GNU tar 1.35** from `C:\Program Files\Git\usr\bin`, ahead of System32 — bsdtar rejects `--force-local` and the provenance lane silently falls back to the island |
| nm | `C:\msys64\ucrt64\bin` |
| `SCRIPTC_CC` | `zigcc` |
| `SCRIPTC_TEST_CC` | `zig cc` |
| `SCRIPTC_TARGET` | `x86_64-windows-gnu` |
| `SCRIPTC_TEST_WORKERS` | **unset** (explicitly removed) |
| backend | the **default** on every lane, plus one `--backend c` pass (lane H) for fence counting. The default is not one backend: the compiler falls back to C on its own and says so in the log (`scriptc: backend c (llvm refused: weakmap:intrinsic)`), so which one ran is a per-build fact -- see §7.7 and §7.8 |
| flags | `--provenance-sources`, strict, **no `--best-effort`** |
| caches | everything under `<blocks>\pkgstatus-*`; nothing on `C:` |

`--best-effort` is absent on purpose: it defers a statement with no static
lowering into a runtime throw, so a diagnostic count taken under it is not a
count of what the compiler refuses.

### The lanes

| lane | question | entry | script |
| --- | --- | --- | --- |
| **A** | does the **published npm package** reach a binary? | `napp/drivers/<pkg>.ts`, importing the package by its bare specifier | `harness/queueA.sh` → `harness/build1.sh` |
| **B** | how many sites, by code, by file, roots vs cascade? | the same entries, one `analyze()` pass | `harness/queueB.sh` → `harness/sites.mjs` |
| **E** | are the store lane's blockers a v1.8.0/v1.8.2 skew? | `napp/drivers/_x-waclient-182.ts` | `harness/queueE.sh` |
| **F** | for the packages npm cannot measure: their **source** | `napp/pkgsrc/src-<pkg>.ts` (lib ES2020+DOM) over the v1.8.2 attested checkout | `harness/queueF.sh` |
| **G** | the same for the packages whose own tsconfig has no `DOM` | `napp/pkgsrcN/src-<pkg>.ts` (lib ES2020) | `harness/queueG.sh` |
| **D** | does block `mongoredecl`'s store-mongo headline still hold? | their `drv-mongo.ts`, read-only, from **this** worktree and compiler | `harness/queueD.sh` |
| **H** | fence count in an emitted C translation unit | the one driver that reaches a binary, rebuilt `--backend c` | `harness/queueH.sh` + `harness/fences.sh` |

The drivers are generated, not hand-written (`harness/gen-drivers.mjs`): every
store driver has the same shape — call the package's own factory, then take one
store out of each of the sixteen domains it hands back — so a difference between
two store packages is the package and not the driver. They typecheck clean under
plain `tsc` against the installed `.d.ts` before any build is attempted.

### The driver tree

`napp/package.json` (kept as `harness/napp-package.json`) installs the packages
at their **latest published versions** plus every peer dependency:

```
zapo-js 1.8.2                @zapo-js/store-sqlite 1.2.0   @zapo-js/store-mongo 1.2.0
@zapo-js/store-mysql 1.2.0   @zapo-js/store-postgres 1.2.0 @zapo-js/store-redis 1.3.0
@zapo-js/media-utils 1.0.0   @zapo-js/wam 0.1.1            @zapo-js/voip 1.0.0
better-sqlite3 12.11.1  mongodb 6.21.0  mysql2 3.24.3  pg 8.23.0  ioredis 5.11.1
sharp 0.33.5  file-type 19.6.0  @roamhq/wrtc 0.10.0  libmlow-wasm 0.1.1
@vinikjkkj/wa-wam 2.3000.1041713829-1ec0d3b  @types/node 24.13.3
```

---

## 2. The instruments, and the controls that were run before any number was quoted

### 2a. Counter positive controls — run as their own step

Two patterns, two different files, and the wrong one reads a silent zero: a
**build log** carries `` - error SC2020: ``; an **emitted C TU** carries
`[SC2020 at file:line]`.

| control | file | bytes scanned | recorded answer | this block's counter |
| --- | --- | --- | --- | --- |
| C-TU fence counter | `pkgrecheck-lab/bin/store-sqlite-open.c` | 364,322 | `total=5 distinct=5` | **5 / 5** ✔ |
| C-TU fence counter | `pkgrecheck-lab/bin/store-sqlite-names.c` | 107,026 | `total=4 distinct=4` | **4 / 4** ✔ |
| C-TU fence counter | `pkgrecheck-lab/bin/drv-pg-cleanup2.c` | 94,121 | `total=0` | **0** ✔ (file non-empty) |
| C-TU fence counter | `pkgrecheck-lab/bin/voip-stun.c` | 78,847 | `total=0` | **0** ✔ (file non-empty) |
| build-log site counter | `pkgrecheck-lab/bin/voip-callstate.build-llvm.log` | 4,650 | `9 errors.` | **9**, all `SC2020` ✔ |

The last row is the trap itself, reproduced: on that same log the **C-TU
pattern reads 0**, and the harness that recorded it printed `0 SC-tagged lines`
next to a build the compiler called nine errors. `harness/build1.sh` counts with
both patterns, prints the byte size of what it scanned beside every count, and
prints the compiler's own `N errors.` line as a cross-check.

The fence counter was later found to be under-scanning anyway, and that is
recorded as a finding rather than quietly fixed: see **§7.8**. The corrected
counter is `harness/fences.sh`, which scans every emitted translation unit
(`<name>.c`, `<name>.part1.c` … `<name>.partN.c`, `<name>.scrh`), prints each
file's byte size beside its count, and is controlled by `hello.c` (1,796 bytes,
0 fences).

### 2b. Lane controls, run first, in the same lane as the corpus

| control | assertion | result |
| --- | --- | --- |
| `hello.ts` (lane A) | must build, run, and match node | rc=0, 677,888 bytes, **ORACLE MATCH byte-exact** |
| `typesprobe.ts` (lane A) | 4-argument `execFile`, which only real `@types/node` accepts | rc=0, **0 error sites**, binary produced |
| `typesprobe-neg.ts` (lane A) | a genuine type error must fail the build | **rc=1**, 1 error site |
| `typesprobe` (lane B) | must cross preflight and name `@types/node` | `preflightFailed=false`, and its one site reads *"`child_process.execFile` is **typed by @types/node**"* — the fallback `.d.ts` cannot say that |
| `typesprobe-neg` (lane B) | must fail preflight and report `SC0001` | `preflightFailed=true`, `SC0001` |

The `@types/node` positive control matters because the fallback
`scriptc-node-fallback.d.ts` hides failures; the lane is compiling against the
real thing.

### 2c. `sites.mjs` hardening

`harness/sites.mjs` (taken from `tests/perf/pkgrecheck/harness/`, retargeted at
this worktree) throws `BLIND: …` rather than writing a record when `coverage` is
missing, `stats` is missing or not numeric, `preflightFailed` is not a boolean,
a site carries no code or message, or a read produced zero statements, zero
sites and zero source texts at once. It also resolves each site's **line** from
the source text, because `SrcLoc` carries a character offset and a survey that
reads `d.loc.line` collapses every site in a file into one.

### 2d. Two counts that are not the same question

For `store-mongo` the build log says **1 error** and `analyze()` says **242
blocker sites**. Both are correct and neither is "the" number:

* the **build** stops at the first module-link refusal — here `SC1012 export =
  assignments are not supported yet` in `@mongodb-js/saslprep`'s source — and
  never reaches lowering;
* `analyze()` surveys everything the entry reaches and reports all of it.

Every table below carries both columns for that reason.

### 2e. Engine scan, armed

A static build must embed no engine. Of five candidate markers only two
discriminate, and that was established here rather than assumed: `hello.ts`
built with `--dynamic` on this host (1,857,536 bytes, against 677,888 static)
reads

```
quickjs 1   ScrDyn 1   JS_NewRuntime 0   JS_Eval 0   __island_eval 0
```

`JS_NewRuntime`, `JS_Eval` and `__island_eval` read **zero in a binary that
certainly does embed the engine**, so a zero from them means nothing. Both
discriminating markers read 0 in the one binary this survey produced.

---

## 3. Definitions the objective depends on

| state | meaning | what the number means |
| --- | --- | --- |
| `ANALYSED` | preflight crossed, statements analysed | the numbers mean what they say |
| `PREFLIGHT-FAIL` | analysis never ran | every count is **absent**, not zero |
| `ISLANDED` | the package fell back to the island path — no provenance attestation, no source mapping, or an unfetchable source | **UNMEASURED.** The sites reported are the island boundary's, not the package's. Never a zero. |
| build rc ≠ 0 | no binary, and no C TU | the fence count is **n/a**, never 0 |

**Roots vs cascade.** `SC2004` is the compiler's own cascade marker —
*"uses of 'x' inherit the blocker on its declaration"*
(`diagnostics/diagnostic.ts`, `blockedBindingUseDiag`). Every other code is a
root. The two are counted separately and never netted.

**Every count in this document is a CALL SITE count.** Distinct-message counts
appear only in their own column, labelled. A previous brief quoted a
distinct-message count as a site count and the error propagated.

---

## 4. The subjects the objective names — what they actually are

`npm search @zapo-js` returns 20 packages. Under the `@zapo-js` scope the store
providers are exactly five, and **`store-memory` is not among them**:

| objective's name | what exists | latest | provenance attestation |
| --- | --- | --- | --- |
| `store-sqlite` | `@zapo-js/store-sqlite` | 1.2.0 (2026-08-19) | **yes** → `refs/tags/v1.8.0` @ `9a49e1fffdec` |
| `store-mongo` | `@zapo-js/store-mongo` | 1.2.0 (2026-08-19) | **yes** → `refs/tags/v1.8.0` @ `9a49e1fffdec` |
| `store-mysql` | `@zapo-js/store-mysql` | 1.2.0 (2026-08-19) | **yes** → `refs/tags/v1.8.0` @ `9a49e1fffdec` |
| `store-postgres` | `@zapo-js/store-postgres` | 1.2.0 (2026-08-19) | **yes** → `refs/tags/v1.8.0` @ `9a49e1fffdec` |
| `store-redis` | `@zapo-js/store-redis` | 1.3.0 (2026-08-19) | **yes** → `refs/tags/v1.8.0` @ `9a49e1fffdec` |
| **`store-memory`** | **no such package.** The in-memory store ships inside `zapo-js` core at `src/store/memory/`, published as `dist/store/memory/`, and a consumer reaches it through the `zapo-js/store` subpath | (zapo-js 1.8.2) | via `zapo-js` → `refs/tags/v1.8.2` @ `757a8071b819` |
| `media-utils` | `@zapo-js/media-utils` | 1.0.0 (2026-06-01) | **NO** |
| `wam` | `@zapo-js/wam` | 0.1.1 (2026-07-12) | **yes** → `refs/heads/master` @ `1dc6b9f8de93` |
| `voip` | `@zapo-js/voip` | 1.0.0 (2026-06-30) | **NO** |

Checked with `npm view <pkg> dist.attestations --json` and by decoding the
in-toto payload of each `registry.npmjs.org/-/npm/v1/attestations/<pkg>@<ver>`
bundle for the attested `{repo, gitCommit}`.

Also on npm: `@innovatorssoft/{store-mongo,store-sqlite,store-postgres,
store-redis,store-mysql,media-utils,fake-server}` — third-party republishes of
the same packages at older versions. They are not the objective's subjects and
were not measured.

### The version the provenance lane actually compiles

This matters and is easy to get wrong. The five store packages attest **tag
v1.8.0** (`9a49e1fffdec`), and the zapo monorepo checkout they pull in carries
zapo-js's own `src/` at its root with a tsconfig `paths` table aliasing
`zapo-js` → `src`. So a store driver's whole graph — the store package **and**
zapo-js — is read out of the **v1.8.0** checkout, and the `zapo-js@1.8.2`
installed in `node_modules` is never the thing measured. `wam@0.1.1` attests a
July `master` commit, older still. Only the `store-memory` driver, which
imports `zapo-js` directly, compiles **1.8.2**.

### The package sources are the same in both trees — only zapo-js core differs

`diff -r -q` between `packages/<pkg>/src` in the two attested checkouts:

```
store-sqlite     IDENTICAL src      media-utils      IDENTICAL src
store-mongo      IDENTICAL src      wam              IDENTICAL src
store-mysql      IDENTICAL src      voip             IDENTICAL src
store-postgres   IDENTICAL src
store-redis      IDENTICAL src
zapo-js's own src/                  17 differing entries
```

`packages/wam/src` is likewise byte-identical between wam's attested
`refs/heads/master` commit `1dc6b9f8` and the v1.8.2 tag. So **every lane-A
number below measures the package source that is published today**; the only
variable across the lanes is the zapo-js core compiled around it, and lane E
isolates that.

### What the driver contributes, and why it is the same everywhere

Where a package's factory call refuses, the driver's own locals inherit it and
each *use* of them raises its own `SC2004`. In the five store drivers that is
19 cascade sites apiece — one per `console.log` line — and they are the
driver's, not the package's. The `BLOCKER SITES BY OWNER` table in
`sites-detail.txt` separates them out for every record, and because
`harness/gen-drivers.mjs` emits all five store drivers from one template, the
driver's contribution is identical across them and the comparison between
packages still holds.

This is the same caveat the previous survey stated as *"`statementsFailed = 0`
for an entry is a LOWER bound, not a prediction"*: coverage is a property of the
entry, not of the package. A different driver reaches different code and gets a
different number. The drivers used here are in `drivers/`.


<!--SECTIONS-BELOW-->

---

## 5. THE ANSWER — lane A (published npm package) + lane B (`analyze()`), main `3f3dd523`

Commands, verbatim:

```sh
. harness/env.sh                                     # node v25.9.0 first on PATH, GNU tar ahead of System32
cd $LAB/napp
node $WT/packages/cli/dist/main.js build drivers/<pkg>.ts -o $LAB/out/<pkg>.exe --provenance-sources
node $LAB/sites.mjs   $LAB/napp/drivers/<pkg>.ts       $LAB/sites/<pkg>.json  --provenance-sources
```

| package (driver) | binary? | bytes | oracle | build error SITES | compiler's own line | analyse state | stmts reached / failed | blocker SITES | roots | cascade SC2004 | distinct msgs | runtime fences | advisories | unreached SITES |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `store-memory` | **yes** | 17,807,360 | MATCH | 0 | (none - 0 errors) | ANALYSED | 30690 / 0 | 0 | 0 | 0 | 0 | 1 | 0 | 1 |
| `store-sqlite` | **no** | n/a | n/a | 7 | 7 errors. | ANALYSED | 1535 / 5 | 7 | 6 | 1 | 7 | 0 | 1 | 202 |
| `store-mongo` | **no** | n/a | n/a | 1 | 1 error. | ANALYSED | 3131 / 149 | 242 | 201 | 41 | 181 | 0 | 3 | 1447 |
| `store-mysql` | **no** | n/a | n/a | 46 | 46 errors. | ANALYSED | 1462 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 208 |
| `store-postgres` | **no** | n/a | n/a | 46 | 46 errors. | ANALYSED | 1449 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 208 |
| `store-redis` | **no** | n/a | n/a | 46 | 46 errors. | ANALYSED | 1450 / 24 | 46 | 26 | 20 | 16 | 0 | 1 | 205 |
| `media-utils` | **no** | n/a | n/a | 5 | 5 errors. | **ISLANDED — UNMEASURED** | 3 / 3 | n/a — island (5 island-boundary sites) | n/a | n/a | n/a | n/a | n/a | n/a |
| `wam` | **no** | n/a | n/a | 86 | 86 errors. | ANALYSED | 1462 / 76 | 86 | 82 | 4 | 12 | 0 | 0 | 189 |
| `voip` | **no** | n/a | n/a | 4 | 4 errors. | **ISLANDED — UNMEASURED** | 6 / 2 | n/a — island (4 island-boundary sites) | n/a | n/a | n/a | n/a | n/a | n/a |
> **What lane this table is, exactly.** Each driver imports **only its own
> package** by bare specifier. For the five store packages that matters: because
> the driver never names `zapo-js`, `zapo-js` is not a driver-level mapped
> package, and every `zapo-js*` specifier inside the store package's source is
> answered by the store package's **own attested v1.8.0 checkout** through that
> checkout's tsconfig alias `zapo-js -> src`. A real consumer imports both, gets
> zapo-js 1.8.2, and gets different numbers. **§5c is that comparison**, and it
> is the row to read for "does this package work for me". This table is kept
> because it is what a package's own attestation reaches on its own, which is a
> true and load-bearing fact about the published artifact.



**`build error SITES` and `blocker SITES` agree exactly for eight of the nine
records** (7=7, 46=46, 46=46, 46=46, 5=5, 86=86, 4=4, 0=0), and each is
cross-checked against the compiler's own `N errors.` line. `store-mongo` is the
one that differs, for the reason in §2d: its build stops at the first
module-link refusal and never reaches the rest.

### Package by package

**`store-memory` — REACHES A BINARY.** The only one that does. 30,690
statements analysed, **zero failed, zero blocker sites**, one runtime fence
(`require()` with a run-time specifier, in zapo-js's own `spec/proto/index.js`)
and one unreached site. Build rc=0, **17,807,360 bytes**, runs to exit 0, and
its 467 bytes of stdout are **byte-identical** to the same driver under node
v25.9.0. Engine-free on the armed scan (`quickjs 0`, `ScrDyn 0`, against `1`/`1`
in the `--dynamic` control). It compiles **zapo-js 1.8.2** — `provenance:
zapo-js@1.8.2 ← refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)`.

Rebuilt `--backend c` (lane H) it is **18,467,328 bytes**, rc=0, exit 0, oracle
MATCH again — so it reaches a binary on both backends. Its emitted C is 12
translation units totalling **95,775,464 bytes** carrying exactly **one**
runtime fence, `[SC2020 at …/spec/proto/index.js:1]`, `'require() with a
run-time specifier'` — the same one `analyze()` reports as its single
`runtimeFence`. Two instruments, one site.

**`store-sqlite` — 7 blocker sites, 6 roots + 1 cascade, and NOT ONE of them is
in store-sqlite.** All seven are in zapo-js's own `src/`. store-sqlite's own
source contributes **zero**. `better-sqlite3` never islands, because the
compiler carries its own sqlite lowering (`frontend/lowering/lower-sqlite.ts`).

**`store-mysql` / `store-postgres` / `store-redis` — 46 sites each, with
identical histograms**: `{SC2013: 2, SC2011: 3, SC2001: 1, SC1090: 20,
SC2004: 20}` for all three, and the same split by owner — 7 in zapo-js core (the
shared cluster below), 19 in the package's own source, 20 in the driver (19 of
them `SC2004` cascade). Of each package's own 19, **16 are one cause**: `SC1090 extending
classes not declared in the program ('BaseRedisStore' / 'BaseMysqlStore' /
'BasePgStore')`, once per store class — and that base class did not compile
because it imports the database driver, which islanded:

| package | driver package | why it islanded |
| --- | --- | --- |
| store-redis | `ioredis@5.11.1` | **no provenance attestation published** |
| store-postgres | `pg@8.23.0` | **no provenance attestation published** |
| store-mysql | `mysql2@3.24.3` | attested, but **no source mapping for the `mysql2/promise` subpath** (published target `./promise.js`) |
| store-mongo | `mongodb@6.21.0` | maps fully — and contributes 223 sites of its own |
| store-sqlite | `better-sqlite3` | never reaches npm: the compiler lowers sqlite natively |

**Why all three land on exactly 46, to the site.** It is a shared shape plus a
shared scaffold, and `harness/why46.mjs` decomposes it identically for each:

```
store-mysql     total= 46  = zapo-js core 7 + own 19 + driver 20
store-postgres  total= 46  = zapo-js core 7 + own 19 + driver 20
store-redis     total= 46  = zapo-js core 7 + own 19 + driver 20
store-sqlite    total=  7  = zapo-js core 7 + own  0 + driver  0

  own    16x  SC1090  extending classes not declared in the program ('Base*Store')
         1x  SC2013  importing 'ioredis' / 'pg' / 'mysql2' requires the engine
         1x  SC2013  values from that package run in the engine
         1x  SC2011  the package's own Wa*StoreConfig / Wa*StoreResult
  driver 19x  SC2004  one per console.log line that uses the failed local
         1x  SC2011  the factory's result type
```

The **7** is the zapo-js-core cluster, identical site-for-site in all five
(§5, "one fix, not five"). The **16** is one per store class extending a base
that imports the islanded database driver, and all three packages implement the
same sixteen domains. The **20** is mine: `harness/gen-drivers.mjs` emits all
five store drivers from one template with nineteen `console.log` lines, so the
cascade off a failed factory call is nineteen sites in every one of them.

So 46 is not a coincidence and it is not one number: **only 19 of the 46 are the
package's own code**, and 16 of those 19 are a single cause.



**`store-mongo` — the build stops at 1 error; the survey finds 242 sites.**
The build's single error is `SC1012 export = assignments are not supported yet`
at `@mongodb-js/saslprep`'s `packages/saslprep/src/index.ts:155`. The survey's
242 sites (201 roots + 41 cascade, 181 distinct messages) attribute as:

| owner | sites | roots | cascade |
| --- | --- | --- | --- |
| `mongodb@6.21.0` | 164 | 132 | 32 |
| `bson@6.10.4` | 59 | 54 | 5 |
| zapo-js core (in the store-mongo checkout) | 7 | 6 | 1 |
| `@mongodb-js/saslprep@1.5.2` | 6 | 6 | 0 |
| the driver | 3 | 0 | 3 |
| `mongodb-connection-string-url@3.0.2` | 2 | 2 | 0 |
| **`@zapo-js/store-mongo`'s own source** | **1** | **1** | 0 |

Top root causes inside mongodb/bson: `SC1090` 97 sites over 48 files (21 of them
*"extending the generic class `CommandOperation` without a compiled concrete
instantiation"*), `SC2020` 46 over 20 files, `SC2011` 23 over 11, `SC2009` 19
over 10.

**`wam` — 86 sites, and 69 of them are ONE cause in ONE file.** 82 roots + 4
cascade, 12 distinct messages, 1,462 statements reached with 76 failed. By
owner: 78 in `packages/wam`, 4 in zapo-js core, 4 in the driver. The 69:

```
packages/wam/src/synthetic/fabrications.ts, 69 distinct lines
SC1090  calls of the generic method 'commit' through this receiver
        (no compiled declaration with a body resolves statically here — ambient
        'declare class' and interface-only methods are signature-only, and only
        class, static, and object-literal generic methods with bodies monomorphize)
```

`AMBIENT_FABS` is a 69-entry array of object literals whose `emit` callback
calls `c.commit(name, payload)`, where `c` is typed by an **`import type`** of
`WaWamCoordinator` and `commit<K extends WaWamEventName>(…)` is a generic
method. One gap, 69 call sites. The remaining 17: 7 `SC2013` — the
`@vinikjkkj/wa-wam` island (attested but "no source mapping … published target:
index.js") — 4 `SC2011`, 1 `SC2001`, 1 `SC1090` on the declaration-only
appstate spec, and 4 `SC2004`.

**Read §5b before quoting the 86 or the 69.** The same wam source against
zapo-js **1.8.2** is 15 sites and the 69 are **zero** — they are downstream of
`WaWamCoordinator` failing to compile on the older core that wam@0.1.1's own
attestation pins, not a gap of their own.

**`media-utils` and `voip` — ISLANDED, therefore UNMEASURED in this lane.**
Neither publishes a provenance attestation, so `--provenance-sources` cannot
reach their source and the compiler falls back to the island. It says so
itself, in the build log, unprompted:

> `provenance: @zapo-js/voip@1.0.0: no provenance attestation published; island path used`
>
> `hint: this build did NOT use the provenance lane for '@zapo-js/voip': resolving
> its attested source threw on this run …, so the package fell back to the island
> and these sites are the FALLBACK's refusals, not the lane's answer`

The give-away in the table is the statement count: media-utils analysed **3**
statements and voip **6** — the driver's own — against 1,449-30,690 for every
measured record. **Their 5 and 4 sites are the island boundary, not the
package.** Read as package numbers they would be the smallest in the table,
which is precisely backwards. Lane F measures them properly.

### The shared zapo-js-core cluster: one fix, not five

`harness/core-cluster.mjs` compares the zapo-js-core blocker sites across the
five store records, keyed on `code file:line`, restricted to the zapo checkout
(mongodb's attested tree also has a top-level `src/`, and counting it would turn
7 shared sites into 232 and hide the cluster):

```
store-sqlite  7   store-mongo  7   store-mysql  7   store-postgres  7   store-redis  7
IDENTICAL ACROSS ALL 5: true
  SC1090 src/abprops-spec.ts:25
  SC1090 src/appstate-spec.ts:78
  SC1090 src/client/coordinators/WaAbPropsCoordinator.ts:35
  SC1090 src/protocol/abprops.ts:48
  SC2001 src/client/WaClient.ts:903
  SC2004 src/client/WaClient.ts:903          <- the cascade off the line above
  SC2011 src/client/WaClient.ts:74
```

Six roots and one cascade, the same site in the same file at the same line in
all five. Two causes:

* **four `SC1090` on declaration-only spec modules** — `WA_ABPROPS`,
  `WA_ABPROPS_BY_CODE`, `RAW_WA_APPSTATE_SCHEMAS`, each *"has no compiled
  implementation — its module `…/spec/…/index.d.ts` ships only a declaration
  file"*. zapo-js's `spec/` directories carry an `index.d.ts` beside a plain
  `index.js`, so the static frontend gets a type and no source.
* **`WaClient.ts:74` `SC2011` `WaClientDependencies`** and **`WaClient.ts:903`
  `SC2001` `WaClientConstructor`** (`export const WaClient = WaClientImpl as
  unknown as WaClientConstructor`), plus the `SC2004` on `WaClientImpl` that
  cascades from it.

This cluster is what `store-sqlite` — the only store package with no blockers of
its own and no islanded database driver — is left standing on.

---

## 5b. Lanes F and G — the package SOURCE, compiled against zapo-js 1.8.2

Two packages have no npm artifact the compiler can reach (§0.2), and one
question the npm lane cannot answer is whether the store packages' blockers are
their own or their pinned zapo-js's. Both are answered by compiling the package
**source**, taken verbatim from the zapo-js@1.8.2 attested checkout
`757a8071b819` — whose `packages/<pkg>/src` is byte-identical to the v1.8.0 one
the store packages attest, so the package code is the same code.

Each entry sits under a tsconfig whose `lib` matches the package's own:
`["ES2020","DOM"]` for `voip` and `wam` (`napp/pkgsrc/`), `["ES2020"]` for
`media-utils` and the stores (`napp/pkgsrcN/`). Getting that wrong invents two
`TS2304`s on `RTCPeerConnection`/`RTCDataChannel` that the package does not
have.

```sh
node $LAB/sites.mjs $LAB/napp/pkgsrcN/src-store-sqlite.ts $LAB/sites/src-store-sqlite.json --provenance-sources
node $WT/packages/cli/dist/main.js build pkgsrcN/src-store-sqlite.ts -o $LAB/out/src-store-sqlite.exe --provenance-sources
```

| package (driver) | binary? | bytes | oracle | build error SITES | compiler's own line | analyse state | stmts reached / failed | blocker SITES | roots | cascade SC2004 | distinct msgs | runtime fences | advisories | unreached SITES |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `src-store-sqlite` | **yes** | 28,903,424 | MATCH | 0 | (none - 0 errors) | ANALYSED | 47078 / 0 | 0 | 0 | 0 | 0 | 1 | 53 | 7 |
| `src-store-redis` | **no** | n/a | n/a | 39 | 39 errors. | ANALYSED | 46993 / 19 | 39 | 20 | 19 | 9 | 1 | 53 | 10 |
| `src-media-utils` | **no** | n/a | n/a | 27 | 27 errors. | ANALYSED | 228 / 26 | 27 | 25 | 2 | 17 | 0 | 0 | 0 |
| `src-voip` | **no** | n/a | n/a | 59 | 59 errors. | ANALYSED | 48988 / 59 | 59 | 53 | 6 | 29 | 1 | 53 | 16 |
| `src-wam` | **no** | n/a | n/a | 15 | 15 errors. | ANALYSED | 48022 / 10 | 15 | 15 | 0 | 3 | 1 | 56 | 8 |

### `wam` source against zapo-js 1.8.2 — 86 sites become 15, and the 69 go to ZERO

The same wam source (`diff -r -q` says `packages/wam/src` is byte-identical
between wam's attested `1dc6b9f8` and the v1.8.2 tag), compiled against
**zapo-js 1.8.2** instead of the July core its own attestation pins:

| | lane A (`@zapo-js/wam@0.1.1`, its attested tree) | lane F (same source, zapo-js 1.8.2) |
| --- | --- | --- |
| statements reached / failed | 1,462 / 76 | **48,022 / 10** |
| blocker sites | 86 (82 roots + 4 cascade) | **15 (15 roots + 0 cascade)** |
| distinct messages | 12 | **3** |
| `SC1090 'commit' through this receiver` | **69** | **0** |
| `SC2013 @vinikjkkj/wa-wam` island | 7 | 15 |
| sites in zapo-js core | 4 | 0 |
| sites in the driver | 4 | 0 |

**The two instruments agree on every row of this lane.** Build error sites
against `analyze()` blocker sites: `src-store-sqlite` 0=0, `src-store-redis`
39=39, `src-media-utils` 27=27, `src-voip` 59=59, `src-wam` 15=15 — each also
matching the compiler's own `N errors.` line. On the npm lane they agree on
eight of nine (§5), the exception being `store-mongo`, where the build stops at
a module-link refusal and the survey does not. `src-wam` does **not** reach a
binary: `BUILD rc=1`, `15 errors.`, so **no fence count — n/a, not 0**.


**All 15 remaining sites are `SC2013`, and every one of them is the
`@vinikjkkj/wa-wam` island** — 9 *"values from the package run in the embedded
dynamic engine"*, 5 *"importing … requires"*, 1 the `commit` instantiation
crossing that boundary — across `WaWamCoordinator.ts` (4), `registry.ts` (3),
`wire/encoder.ts` (3), `wire/WamBatch.ts` (3), `globals.ts` (2). wam has **no
blocker of its own left** that is not that island.

That is the correction the two queue entries were groping at. The 69
receiver-dispatch sites are **not 69 independent compiler gaps**: they are
downstream of `WaWamCoordinator`'s own declaration failing to compile, which it
does on the older core and does not on 1.8.2. They are formally roots — the
code is `SC1090`, not the `SC2004` cascade marker — so no roots/cascade split
would have revealed it. **Only compiling both ways did**, and it is the same
shape as the store packages' 16 `extending classes not declared in the program`
sites, which are downstream of an islanded database driver.

`@vinikjkkj/wa-wam` **does** publish a provenance attestation
(`npm view @vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b dist.attestations` returns
one). What fails is the mapping: *"no source mapping for '@vinikjkkj/wa-wam'
(published target: index.js)"* — the published entry is a plain `index.js` with
no source counterpart the mapper resolves. That is a different defect from
media-utils' and voip's, and a narrower one.

**`voip` source — 48,988 statements analysed, 59 blocker sites, ALL of them
voip's own.** 53 roots + 6 cascade, 29 distinct messages, 1 runtime fence, 53
advisories, 16 unreached sites. Preflight crossed. By cause:

| sites | code | where | what |
| --- | --- | --- | --- |
| 21 | `SC1090` | `relay/WaSctpRelay.ts` 16, `relay/relay-ack.ts` 2, `crypto/srtp.ts` 2, `bytes.ts` 1 | 11× *compound assignment to fields of computed receivers*; 2× string conversion of a union with object arms; 2× compound array-element assignment; 2× reading a field off `any` |
| 17 | `SC2020` | `call/call-state.ts` 9, `relay/WaSctpRelay.ts` 4, 4 others | **7× `new Date`**, 2× `Date.getTime`, `ArrayBufferLike.byteLength`, `createCipheriv with this algorithm`, … |
| 11 | `SC2003` | `relay/WaSctpRelay.ts` 11 | union re-tag: `null \| { close: () => void } \| undefined` against `RTCDataChannel`, `null \| RTCPeerConnection`, `dgram.Socket \| null` |
| 2 | `SC2001` | `crypto/srtp.ts`, `call/WaCallMediaSession.ts` | **`bigint`**; and a `(ep: RelayEndpoint) => "" \| Uint8Array \| undefined` |
| 1 | `SC2011` | `relay/relay-ack.ts` | a value of type `any` |
| 6 | `SC2004` | — | cascade |

The build agrees with the survey exactly: `BUILD rc=1 615s`, `LOG-SITES
total=59`, the compiler's own `59 errors.`, and the same histogram —
`SC1090 21, SC2020 17, SC2003 11, SC2004 6, SC2001 2, SC2012 1, SC2011 1`. No
binary, so **no fence count: n/a, not 0**.

Its four peer packages all island for want of an attestation —
`@roamhq/wrtc@0.10.0`, `libmlow-wasm@0.1.1`, `argo-codec@0.2.1`, and
`@zapo-js/native` is not installed — but **zapo-js@1.8.2 maps**, and none of the
59 sites is in an islanded package: every one is in voip's own source. This is
the number the objective asks for, and it is real.

For scale: `tests/perf/mediavoip-remeasure/` recorded voip's entry at
`5d0e8427` as *not crossing* on `RTCPeerConnection`/`RTCDataChannel`, with 7
modules preflight-failed on an `SC1016` import cycle in zapo-js's `protocol/`.
Here the entry crosses and reaches 48,988 statements. The count is larger than
that survey's "14 unique refusal sites" because far more code is now reachable,
which is the same shape of movement that report itself flagged: *"the site count
halves; the cause count nearly doubles … because the provenance lane compiles
549 times more code."*

### The decisive one: `store-sqlite`'s source against zapo-js 1.8.2

Lane G takes `packages/store-sqlite/src` verbatim out of the v1.8.2 checkout —
byte-identical to the v1.8.0 copy the published `@zapo-js/store-sqlite@1.2.0`
attests, so it is the same package code — and compiles it against **zapo-js
1.8.2** with the same 16-domain driver lane A used:

```
sites=61 preflightFailed=false total=47078 failed=0 island=0 ms=702565
BLOCKER SITES=0  (roots=0  cascade/SC2004=0)  runtimeFence=1  advisory=53  unreached-sites=7
prov: zapo-js@1.8.2 <- 757a8071b819
```

**47,078 statements, zero failed, zero blocker sites** — against 1,535 / 5 / 7
on lane A. `store-sqlite`'s seven blockers are not store-sqlite's and not the
compiler's: they are the **zapo-js its own npm attestation pins**.

And it **reaches a binary**:

```
BUILD rc=0  703s   LOG-SITES total=0    (no `N errors.` line -- there were none)
BINARY bytes=28,903,424       RUN exit=0  stdout=264B
ORACLE node v25.9.0 exit=0    ORACLE: MATCH (byte-exact)
provenance: zapo-js@1.8.2 <- refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
```

The binary constructs all sixteen SQLite store domains against a `:memory:`
database and prints `auth=object … messageSecret=object`, byte-identical to the
same driver under node. Its emitted C is 16 translation units,
**140,994,112 bytes**, carrying exactly **one** runtime fence -- the same
`[SC2020 at …/spec/proto/index.js:1]` `require()` site every program in this
survey carries.

### The contrast: `store-redis`

`store-redis`'s source on the same 1.8.2 core does **not** go clean, and that is
the point of running it beside `store-sqlite`:

```
sites=103 preflightFailed=false total=46993 failed=19 island=0 ms=565498
BLOCKER SITES=39  (roots=20  cascade/SC2004=19)  distinct messages=9
prov: note: ioredis@5.11.1: no provenance attestation published; island path used
```

46,993 statements against lane A's 1,450 — the zapo-js half opened up exactly as
it did for `store-sqlite` — but **39 blocker sites remain, all in store-redis's
own source**, and 16 of them are the same one cause lane A found:

```
16x  SC1090  extending classes not declared in the program ('BaseRedisStore')
     thread.store.ts, signal.store.ts, session.store.ts, sender-key.store.ts,
     privacy-token.store.ts, pre-key.store.ts, … 16 files, one site each
 2x  SC2013  ioredis: `importing` and `values from` the package
 2x  SC2011  …
19x  SC2004  cascade
```

`BaseRedisStore` imports `ioredis`; **`ioredis@5.11.1` publishes no provenance
attestation**, so it islands, so the base class has no compiled declaration, so
none of the sixteen stores that extend it compiles. A zapo-js release does not
touch that. `store-postgres` is the same shape (`pg@8.23.0`, no attestation) and
`store-mysql` a near-neighbour (`mysql2` is attested but its `mysql2/promise`
subpath has no source mapping).

**`store-sqlite` is the exception because the compiler carries its own sqlite
lowering** — `frontend/lowering/lower-sqlite.ts` opens with *"better-sqlite3 —
the ONE npm package the static lane serves itself"* — so it never needs an
attestation. Its record carries zero `better-sqlite3` provenance notes and zero
sqlite-related blocker sites.
The build says the same thing: `BUILD rc=1 552s`, `LOG-SITES total=39`, the
compiler's own `39 errors.`, histogram `SC2004 19, SC1090 16, SC2013 2,
SC2011 2` — identical to the survey — and **no binary**, so no fence count
(n/a, not 0). Its provenance notes carry `zapo-js@1.8.2 ← refs/tags/v1.8.2 @
757a8071b819` beside `ioredis@5.11.1: no provenance attestation published;
island path used`. Same core as `store-sqlite`, same lane, opposite outcome, and
the note names why.


### `media-utils`, measured properly

`@zapo-js/media-utils` publishes no attestation, so lane A could only island it
(3 statements, 5 island-boundary sites, **UNMEASURED**). Its source, compiled
against zapo-js 1.8.2:

```
sites=27 preflightFailed=false total=228 failed=26 island=0 ms=26610
BLOCKER SITES=27  (roots=25  cascade/SC2004=2)  distinct messages=17
```

All 27 are in media-utils' own two runtime modules:

| sites | code | file | what |
| --- | --- | --- | --- |
| 17 | `SC2020` | `ffmpeg.ts` | the `@types/node` child-process surface: 4x `ChildProcess.stdin`, 2x `child_process.execFile`, 2x `spawn with this stdin slot`, 2x `child.on("close", ...)`, and 7 more |
| 3 | `SC2003` | `ffmpeg.ts` | `Readable \| null` will not re-tag into `Readable` |
| 2 | `SC1090` | `ffmpeg.ts` | `instanceof` on a non-class-instance; a `Uint8Array` where a `string` is expected |
| 2 | `SC1031` | `sharp.ts` | object destructuring of a dyn-typed source |
| 1 | `SC2013` | `sharp.ts` | `importing 'sharp'` — `sharp@0.33.5` publishes no attestation either |
| 2 | `SC2004` | `sharp.ts` | cascade off the line above |

`media-utils`' own tsconfig has **no `DOM`** in `lib`, so this lane was re-run
under `napp/pkgsrcN/` to match; the numbers came out identical to the first
(`lib: ES2020, DOM`) pass — 27 sites, 228 statements, 26 failed — so the `lib`
choice happens not to reach this package. It reaches `voip`, which is why the
two directories exist.

The entry **crosses preflight**, which it did not in
`tests/perf/mediavoip-remeasure` at `5d0e8427`: that survey recorded
`index.ts` failing preflight in both lanes on `fileTypeFromFile`, and had to
measure past it with a modified copy. That is closed.


---

## 5c. The `store-sqlite` discrepancy — resolved, and the table row it re-labels

**The objection.** This survey measures `store-sqlite` at **7 blocker sites and
no binary**. But `tests/perf/zapo-rest/app182/zapo-rest.ts` was built from this
same `main` a few hours earlier, wired to the SQLite store on all twelve
domains with no memory-store branch anywhere in the program, and it compiled at
**zero diagnostics** into a **32,368,640-byte** binary that passes delivery
verification. Both cannot be a complete description of the same package.

**They are the same package, and the seven sites are not in it.** Neither of the
two obvious explanations is right: the artifact is not different (the driver
resolves the published `@zapo-js/store-sqlite@1.2.0` in both cases, and
`diff -r -q` makes its `src` byte-identical between the v1.8.0 and v1.8.2
checkouts), and the sites are not in an unreached corner of it (**all seven are
in zapo-js's own `src/`, and store-sqlite's own source contributes zero** — see
the owner table in §5).

**On "is the local `packages/store-sqlite` a different artifact?" — there is no
local one.** `packages/` in this repo holds `cli`, `compiler` and `runtime` and
nothing else; `find packages -maxdepth 2 -iname '*store*'` returns nothing. The
store packages live in the zapo repo and reach both builds the same way, through
npm plus provenance. This survey's record maps exactly one package —
`@zapo-js/store-sqlite@1.2.0 <- 9a49e1fffdec` — and every one of its 210 sites,
blockers and unreached alike, lies in that one checkout.

**What differs is which zapo-js the store package was compiled against, and it
is decided by what the DRIVER imports.** The compiler says so itself, in the
shipped build's log:

> `provenance: zapo-js@1.8.2 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)`
>
> `provenance: @zapo-js/store-sqlite@1.2.0 ← https://github.com/vinikjkkj/zapo@refs/tags/v1.8.0 @ 9a49e1fffdec (source compiles statically)`
>
> `provenance: 41 alias key(s) are spelled by more than one mapped package with
> different targets ('zapo-js/store', 'zapo-js/signal', 'zapo-js/auth',
> 'zapo-js/appstate', 'zapo-js/retry', …); tsconfig "paths" is one table per
> program, so zapo-js's answer is used for all of them and @zapo-js/store-sqlite
> compile against zapo-js's checkout for those specifiers`

`app182/zapo-rest.ts` imports **both**:

```ts
import { WaClient, createStore } from "zapo-js";
import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite";
```

so `zapo-js@1.8.2` is a mapped package, it wins the one-table-per-program alias
collision, and store-sqlite's source is compiled against **1.8.2**. This
survey's lane-A driver imports **only** `@zapo-js/store-sqlite`, so `zapo-js` is
never a driver-level mapped package and the store's own attested **v1.8.0**
checkout answers every `zapo-js*` specifier through its tsconfig alias
`zapo-js → src`. The 7 sites are v1.8.0's.

The shipped log confirms which tree it actually compiled: of the 78 occurrences
of a provenance commit in it, **77 are `757a8071…` (v1.8.2) and every one of
those is an advisory**; `9a49e1ff…` (v1.8.0) appears exactly **once**, in the
provenance note, and never in a diagnostic path. `rg -c ' - error SC[0-9]{4}: '`
over that log reads **0**, and it ends `77 advisories (the build succeeded).`

### The A/B, run here, one line apart

`drivers/_x-sqlite-plus-zapo.ts` is `drivers/store-sqlite.ts` with one line
added — `import { WaClient } from 'zapo-js'` — and nothing else changed.
`drivers/_x-redis-plus-zapo.ts` is the same one-line change to
`drivers/store-redis.ts`, run as the contrast: if both arms went to zero the
mechanism would be something other than the alias table.

| package | driver imports | statements / failed | blocker sites | where those sites are |
|---|---|---|---|---|
| `store-sqlite` | the store package only | 1535 / 5 | **7** | zapo-js core (v1.8.0) 7 |
| `store-sqlite` | **+ `zapo-js`** (app182's shape) | 47079 / 0 | **0** | - |
| `store-redis` | the store package only | 1450 / 24 | **46** | the package's own source 19, zapo-js core (v1.8.0) 7, the driver 20 |
| `store-redis` | **+ `zapo-js`** (app182's shape) | 46994 / 19 | **39** | the package's own source 19, the driver 20 |

Provenance notes on the `+ zapo-js` arms:

- `store-sqlite`: zapo-js@1.8.2 <- 757a8071b819
- `store-sqlite`: @zapo-js/store-sqlite@1.2.0 <- 9a49e1fffdec
- `store-redis`: zapo-js@1.8.2 <- 757a8071b819
- `store-redis`: @zapo-js/store-redis@1.3.0 <- 9a49e1fffdec

**Read the two arms against each other.** The `+ zapo-js` line removes **exactly
the seven zapo-js-core sites, from both packages, and nothing else**:
`store-sqlite` 7 → 0, `store-redis` 46 → 39 with its own 19 and the driver's 20
untouched to the site. Statements reached go from ~1,500 to ~47,000 in both,
because the whole 1.8.2 core is now analysable. And both runs print the note the
shipped build printed, naming the package concerned:

> `41 alias key(s) are spelled by more than one mapped package with different
> targets …; tsconfig "paths" is one table per program, so zapo-js's answer is
> used for all of them and @zapo-js/store-redis compile against zapo-js's
> checkout for those specifiers`

If the mechanism were anything other than the alias table, both arms would not
have moved by the same seven sites, and `store-redis` would not have kept every
one of its own. **`store-sqlite` reaches zero because the core cluster was all
it had; `store-redis` does not, because `ioredis` publishes no attestation and
no zapo-js release touches that.**

**And the zero is a binary, on the npm lane.** The `+ zapo-js` sqlite arm was
carried through a full build: `BUILD rc=0 699s`, **28,903,936 bytes**,
`RUN exit=0`, **`ORACLE: MATCH (byte-exact)`**, and a fence scan over
17,269,175 bytes of emitted C reading **0 sites** — a real 0, from a binary that
exists. That driver resolves the published `@zapo-js/store-sqlite@1.2.0` and
`zapo-js@1.8.2` through npm with `--provenance-sources`, so this is lane A's own
plumbing, not the source lane: **the published store package, imported the way a
real consumer imports it, compiles and runs today.** It lands 512 bytes from the
source-lane binary in §5b (28,903,424), which is the same program reached by the
other road.



### What this re-labels

The lane-A store rows in §5 are correct for the lane they name, and that lane is
**a consumer who imports the store package and not `zapo-js`**. That is not what
a real consumer does — you need `WaClient` or `createStore` from `zapo-js` to
have anything to give a store to — so for the store packages the realistic row
is the one with both imports. The table header now says which, and both numbers
are kept: the 7 is a true measurement of a real (if unrealistic) lane, and
hiding it would hide the fact that a package's attested tag reaches into every
program that names it.

**Neither the 7 nor the shipped zero was wrong. The row was under-labelled.**

---

## 6. The two standing-queue entries — verdicts

### 6a. `wam`: *"14 interface-receiver dispatch sites and `Date.getHours`"* vs *"wam has zero compiler-gap blockers"* — **both wrong**

Measured, main `3f3dd523`, lane A/B, `--provenance-sources`, no `--best-effort`,
`@zapo-js/wam@0.1.1` mapped to its attested `refs/heads/master` commit
`1dc6b9f8de93` (whose `packages/wam/src` is byte-identical to the v1.8.2 tag's):

| claim | measured |
| --- | --- |
| "14 interface-receiver dispatch sites" | **69** sites. `SC1090 calls of the generic method 'commit' through this receiver`, all in `packages/wam/src/synthetic/fabrications.ts`, on 69 distinct lines. |
| "`Date.getHours`" | **0 sites, in any section.** `node -e` over `sites/wam.json`: *sites mentioning getHours or Date.: 0*. |
| "wam has zero compiler-gap blockers" | **86** blocker sites, 82 roots + 4 cascade, 12 distinct messages. Build rc=1, `86 errors.` |

Where the "14" came from: `tests/perf/mediavoip-remeasure/sites-prov-7080/wam__index.json`
(main `5d0e8427`, 2026-08-26) records `"statementsFailed": 14` for the wam entry
in the provenance lane. **That is a STATEMENT count, and it was carried forward
as a site count.** The same record's blocker list is 18 sites, none of them
`SC1090`.

Where the `Date.getHours` came from: the same sweep's
`wam__WaWamCoordinator.json` carries one site reading *"'Date.getHours' is part
of the standard library types but has no scriptc lowering yet"* — in the
**`unreached`** section, at `wam/synthetic/WaWamSyntheticUi.ts:738`, i.e. in code
the entry never reached, so it never blocked anything. It is now gone outright:
`17b9ef54 feat(date): the live-clock local hour, and the fence on every other
instant` landed 2026-09-03, and `surfaces.ts` now carries `stdlib.date.getHours`.

Where the "zero compiler-gap blockers" came from: most likely the **provenance
lane at `5d0e8427`, where the wam entry's `SC1090` count really was 0** — the
69-site `commit` family shows in the *default* lane there (69 `SC1090` on
`wam__index.json` in `sites-default-7080`, 207 across the whole wam sweep in
`tests/perf/pkgrecheck/`). At `3f3dd523` the family is present in the
**provenance** lane too, because provenance now reaches
`synthetic/fabrications.ts` where it did not before.

**The cause is one gap, not 69** — and lane F shows it is not even wam's gap.
`AMBIENT_FABS` is a 69-entry array of object literals whose `emit` callback
calls `c.commit(name, payload)`, `c` typed by an `import type` of
`WaWamCoordinator`, and
`commit<K extends WaWamEventName>(name: K, payload: WaWamEventArgs<K> = {}): void`
is a generic method; the diagnostic's rule is *"only class, static, and
object-literal generic methods with bodies monomorphize"*, and here no compiled
declaration with a body resolves because `WaWamCoordinator` itself did not
compile. Recompile the **same wam source** against zapo-js **1.8.2** instead of
the July core its attestation pins (§5b) and the family goes to **zero**: 86
sites become 15, all 15 the `@vinikjkkj/wa-wam` island, and 48,022 statements
are reached with 10 failed against 1,462 with 76.

Note what that costs the roots/cascade split: all 69 are `SC1090`, so they count
as **roots**, not as the `SC2004` cascade. A roots-vs-cascade table alone would
have called them 69 independent gaps. **Compiling both ways is what showed
otherwise.**

**Queue entry verdict: retire it and replace it with —** *`wam`: 86 blocker
sites against its own attested tree, but **15** against zapo-js 1.8.2, and all
15 are the `@vinikjkkj/wa-wam` island (that package is attested; its published
entry `index.js` has no source mapping). The 69 `commit` receiver-dispatch sites
are downstream of the coordinator not compiling on the older core, not a gap of
their own. `Date.getHours` is closed. The actionable item for wam is a source
mapping for `@vinikjkkj/wa-wam`, plus a wam release built against 1.8.2.*

### Three figures for `wam` that must not be inherited

Two came from the standing queue and one from reading this survey's own table.
All three are wrong, and the third is the one worth dwelling on.

| figure | where it came from | measured |
| --- | --- | --- |
| "14 interface-receiver dispatch sites" | `statementsFailed: 14` in `sites-prov-7080/wam__index.json`, a **statement** count read as a site count | **69** sites, one file, 69 distinct lines |
| "`wam` has zero compiler-gap blockers" | true of the provenance lane at `5d0e8427`, where `SC1090` really was 0 — provenance did not reach `synthetic/fabrications.ts` then | **86** blocker sites, `86 errors.`, no binary |
| "82 roots means 82 distinct problems, not one spreading" | this survey's own roots/cascade column | **false.** 82 roots, but **12** distinct messages, and **69 of the 82 are one message in one file** |

The third is the trap the roots/cascade split cannot see. `SC2004` is the
compiler's cascade marker, so a survey that splits roots from cascade will call
anything else a root — and the 69 `commit` sites are `SC1090`. They are
nonetheless downstream: `WaWamCoordinator`'s own declaration failed to compile
on the older core, so no compiled declaration with a body resolved at any of the
69 call sites. Compile the **same wam source** against zapo-js 1.8.2 and 86
sites become **15**, the 69 become **0**, and reached statements go from 1,462
to 48,022 with failures from 76 to 10.

**A cascade that does not carry the cascade code is invisible to the split.**
The only thing that found it was compiling the same source two ways. Any
"roots = independent problems" reading of this document, or of any coverage
survey, is unsafe for exactly that reason.

### 6b. `store-mongo`: *"9 async-method overrides needing vtable slots"* — **closed, and the entry is dead**

`98068a8d feat(classes): an async method's vtable entry is its spawn, so
overrides dispatch` (2026-09-05) **is an ancestor of `3f3dd523`**
(`git merge-base --is-ancestor 98068a8d 3f3dd523` → yes). Its own commit message
closes the item in the same words the queue used:

> `store-mongo (drivers/drv-mongo.ts, --provenance-sources): the nine
> async-override blockers — createIndexes x8 and destroy — are gone.`

**Independently reproduced here, at the same commit but from a different
worktree, a different compiler build and a different provenance cache.** Block
`mongoredecl` recorded, for
`<blocks>/mongoredecl-lab/app/drivers/drv-mongo.ts` with
`--provenance-sources`:

```
sections={"blocker":233,"runtimeFence":1,"advisory":49,"unreached":1235} preflightFailed=false total=47324 failed=143 ms=394542
```

Lane D ran the same entry (their lab read-only; the record written into mine)
through `<blocks>/pkgstatus`'s compiler:

```
sections={"blocker":233,"runtimeFence":1,"advisory":49,"unreached":1235} preflightFailed=false total=47324 failed=143 ms=592746
```

**Every field identical**; only elapsed ms differs, and this host was running
four analyses at once. Of those 233 blockers, 194 are roots and 39 are `SC2004`
cascade. Searching the whole record for the queue entry's own subject:
**`createIndexes` appears in zero sites**, and the only blocker message
containing "async" at all is `SC2020 'Symbol.asyncDispose'`, an unrelated
standard-library surface.

So the headline holds, and the nine async-override blockers are confirmed gone
by measurement rather than by the commit message alone.

**Queue entry verdict: dead. Delete it.** Anything dispatched against it is
dispatched against finished work — which has already happened once.


---

## 7. Things the objective does not name, found while measuring it

1. **`store-memory` is not a package.** There is no `@zapo-js/store-memory` on
   npm and no `store-memory` directory in the monorepo's `packages/`. The
   in-memory store is `zapo-js/src/store/memory/`, published as
   `dist/store/memory/`, reached through the `zapo-js/store` subpath. Any queue
   item that treats it as a package to be fixed is aimed at nothing. Measured
   the only way a consumer can reach it, it is the one subject that **already
   works**.

2. **Two of the nine subjects cannot be measured through npm at all.**
   `@zapo-js/media-utils@1.0.0` and `@zapo-js/voip@1.0.0` publish **no
   provenance attestation** (`npm view … dist.attestations` is empty for both,
   at every published version). Everything else in the scope has one. Until
   they are republished from CI with provenance, `--provenance-sources` can
   only island them, and any number taken from that lane is the island's.

3. **The published store packages pin a zapo-js the compiler has already
   outgrown.** All five attest `refs/tags/v1.8.0` @ `9a49e1fffdec`, and because
   the monorepo checkout carries zapo-js's own `src/` with a tsconfig `paths`
   alias `zapo-js → src`, the store lane compiles **v1.8.0's zapo-js**, never
   the `zapo-js@1.8.2` sitting in `node_modules`. The seven-site cluster that
   blocks all five is in that v1.8.0 core.
   **Lane E settles whether that matters.** `napp/drivers/_x-waclient-182.ts` is
   three lines — `import { WaClient } from 'zapo-js'` and one `console.log` of
   `typeof WaClient` — so it reaches the very code the cluster lives in, but
   through the **installed zapo-js 1.8.2** (`provenance: zapo-js@1.8.2 <-
   757a8071b819`) instead of the store packages' pinned v1.8.0:

   ```
   sites=61 preflightFailed=false total=46957 failed=0 island=0 ms=637602
   BLOCKER SITES=0  (roots=0  cascade/SC2004=0)  runtimeFence=1  advisory=53  unreached-sites=7
   ```

   **46,957 statements, zero failed, zero blocker sites.** And it is not only
   an `analyze()` result — the same entry **builds**:

   ```
   BUILD rc=0  811s  log=65844B      LOG-SITES total=0
   BINARY bytes=28,824,064           RUN exit=0  stdout=18B
   ORACLE node v25.9.0 exit=0        ORACLE: MATCH (byte-exact)
   ```

   zapo-js 1.8.2's whole `WaClient` path reaches a 28.8 MB binary that runs and
   agrees with node byte for byte. **The seven-site cluster does not exist in
   1.8.2.** It exists in v1.8.0, and the five published store packages reach
   v1.8.0 because that is the tag their own attestation names.

4. **`@zapo-js/wam@0.1.1` attests a BRANCH, not a tag** —
   `git+https://github.com/vinikjkkj/zapo@refs/heads/master @ 1dc6b9f8`. A tag
   is immutable; a branch ref is not. The commit digest pins the content, so
   this run is reproducible, but the provenance note printed in every build log
   names a moving ref. Every other package in the scope attests a tag.

5. **`MAX_PACKAGES = 16` is a silent measurement hazard.** The store-mongo
   driver's notes end with
   `@zapo-js/native: skipped — provenance package limit (16) reached; island
   path used`, where the other four drivers say `not installed under the
   entry's node_modules`. `frontend/provenance.ts:49` caps one compile at 16
   source-mapped packages, value imports claiming slots before type-only ones.
   A driver with a wide dependency fan can therefore island a package purely
   for being seventeenth, and the only trace is one note among seventeen.

6. **A build's error count and `analyze()`'s site count are different
   questions, and they can differ by 240.** `store-mongo`: the build reports
   `1 error.` (`SC1012 export =` in `@mongodb-js/saslprep`, a module-link
   refusal that stops the pipeline before lowering); `analyze()` reports 242
   blocker sites. Any table carrying one of those without the other is
   misleading. Both columns are in §5.

7. **The backend a build actually uses is not the one the flags imply, and the
   log is the only place it says so.** The lane-E build printed
   `scriptc: backend c (llvm refused: weakmap:intrinsic)` — it fell back from
   LLVM to C on its own. `store-memory` on the same flags stayed on LLVM and
   wrote a 126 MB `.ll` and no C TU. So "the LLVM lane keeps no C TU, therefore
   the fence count is absent" is true **per build**, never per lane, and a
   survey that assumes one backend for a whole run will report absent counts
   for some rows and real ones for others without noticing.

8. **A large program's C output is SPLIT, and scanning `<name>.c` alone is a
   byte-sized false zero.** This one nearly reached the document. The C backend
   writes `<name>.c` plus `<name>.part1.c` … `<name>.partN.c` plus a
   `<name>.scrh`. `harness/build1.sh` scanned only `<name>.c`:

   ```
   _x-waclient-182.c        17,163,938 bytes   fences=0     <- what build1.sh saw
   … 14 more .c parts + .scrh                                <- what it did not
   TOTAL   16 files   140,513,435 bytes   FENCES=1           <- in part4.c
   ```

   Seventeen megabytes read, a confident zero printed, and the answer is one.
   `harness/fences.sh` scans every emitted unit and prints each file's byte size
   beside its count. Re-scanned that way, both binaries agree with `analyze()`
   exactly — one runtime fence each, and it is literally the same site:
   `[SC2020 at …/spec/proto/index.js:1]`, `'require() with a run-time
   specifier'`, emitted as a `scr_fence_fatal` call. `hello.c` (1,796 bytes)
   reads 0 as the control.
   A smaller instance of the same family bit while writing §5c: the shipped
   log's decisive line is `node : provenance: zapo-js@1.8.2 ← …`, because
   PowerShell prefixed the first stderr line. `rg '^provenance:'` reads **two**
   mapped packages there; anchor-free reads **three**, and the missing one is
   the load-bearing one. `harness/build1.sh` uses `rg -a -n '^provenance:'` on
   its OWN logs, where the prefix cannot occur — but any reader pointing that
   pattern at a PowerShell-captured log will lose lines silently.


9. **Two builds of one source collide, whatever their `-o` says.** The emitted
   C translation units are named after the **source** basename, not the output
   binary: `pkgsrcN/src-store-sqlite.ts` writes `out/src-store-sqlite.c` and
   `out/src-store-sqlite.part*.c` whether the binary is `src-store-sqlite.exe`
   or `src-store-sqlite-early.exe`. Running the same entry twice in parallel to
   save wall time therefore puts two writers on one set of files. Caught here
   before it produced a number; the redundant run was killed and
   `logs/early-sqlite.log` says so in place of a result.

10. **`argo-codec@0.2.1` has no provenance attestation and islands in 9 of the
   12 records** — every record whose graph actually reached it. (It is absent
   from `store-memory`, whose subpath does not import it, and from the
   `media-utils` / `voip` npm records, which island at the package boundary
   before reaching anything.) It is zapo-js's own optional peer; it never became
   a blocker here, but it is the island that the measured subjects share.

11. **`@zapo-js/native` was not installed in the driver tree**, and eight records
   carry `not installed under the entry's node_modules; island path used` for
   it. It exists on npm (`@zapo-js/native@0.1.0`, the Rust NAPI accelerator with
   a WASM fallback). It never became a blocker in these runs, but a driver tree
   that installs it would resolve a package these runs islanded, so a
   re-measurement that adds it is not comparable to this one without saying so.
   `harness/notes-check.mjs` prints this table from the records, so the claim is
   checkable rather than remembered.

12. **Host note.** Free space on `G:` fell from 42 GB to **24 GB** during this
   block's runs, with this block accounting for ~2.6 GB (2.2 GB of it the
   provenance source cache, which holds nine checkouts including the whole
   mongodb and bson trees). A single `store-memory` build wrote a **126 MB**
   `.ll` beside a 17 MB binary. The volume was at **98%** at the end, which is why counted translation units
   were pruned as soon as they were counted rather than kept.


---

## 8. Reproducing this

```sh
# 1. worktree + compiler, node v22
git worktree add <blocks>\pkgstatus -b <branch> 3f3dd523
pwsh -File harness/install.ps1        # pnpm install --frozen-lockfile
pwsh -File harness/build.ps1          # tsc packages/compiler, then packages/cli   -> BUILD-EXIT rc=0/0

# 2. the driver tree, node v22 or v25 (npm, not pnpm)
mkdir  $LAB/napp && cp harness/napp-package.json $LAB/napp/package.json
cp harness/napp-tsconfig.json $LAB/napp/tsconfig.json
pwsh -File harness/ninstall.ps1       # npm install --no-audit --no-fund
node harness/gen-drivers.mjs          # writes napp/drivers/*.ts
# the two A/B probes are gen-drivers output + one import line; see drivers/_x-*.ts
cd $LAB/napp && node $WT/node_modules/typescript/bin/tsc -p tsconfig.json   # must be clean but for typesprobe-neg

# 3. the lanes, node v25.9.0 first on PATH
bash harness/queueA.sh   # build   -> queueA.log
bash harness/queueB.sh   # analyze -> sites/*.json, queueB.log
bash harness/queueE.sh   # the zapo-js 1.8.2 probe
bash harness/queueF.sh   # voip + wam source, lib ES2020+DOM
bash harness/queueG.sh   # store-sqlite / store-redis / media-utils source, lib ES2020
bash harness/queueD.sh   # the store-mongo cross-check against block mongoredecl
bash harness/queueI.sh   # the A/B: store-sqlite + a zapo-js import
bash harness/queueJ.sh   # the contrast arm: store-redis + the same import
bash harness/queueH.sh   # --backend c, so there is a C TU to count fences in
bash harness/fences.sh $LAB/out hello store-memory   # scans EVERY emitted TU

# 4. everything derived
bash harness/appendix.sh # table-lane-*.md, sites-detail.txt, core-cluster.txt
```

`harness/env.sh` must be sourced by every step. It puts node v25.9.0, the
tree's zig 0.16.0 and **GNU tar** ahead of System32, points every cache at
`<blocks>\pkgstatus-*`, and unsets `SCRIPTC_TEST_WORKERS`. If bsdtar wins the
`tar` race the provenance lane falls back to the island **and finishes
suspiciously fast** — check `tar --version` before believing any number.

### Files

| path | what |
| --- | --- |
| `table-lane-a.md` | the lane A/B table, generated by `harness/table.mjs` from `queueA.log` and `sites/*.json` |
| `table-lane-f.md` | the same for the source lanes (F and G) |
| `fences.txt` | runtime fences per emitted translation unit, with each file's byte size |
| `sites-detail.txt` | every record, expanded: sites by owner, by code, by file, roots and cascade apart |
| `core-cluster.txt` | the shared zapo-js-core cluster check |
| `sites/*.json` | the raw `analyze()` records, one per entry |
| `logs/*` | every build log, binary stdout, oracle stdout and queue log |
| `drivers/*.ts` | the lane-A drivers and the two armed controls |
| `harness/*` | every script, including the hardened `sites.mjs` |

### What would change these numbers

Ranked by sites cleared, from the measurements above and nothing else:

| move | clears | measured, or inferred? | who does it |
| --- | --- | --- | --- |
| **republish the five store packages from a tag whose zapo-js is 1.8.2** | the 7-site core cluster, in all five at once — and for `store-sqlite` that is **every** blocker it has | **measured**: lane G, `store-sqlite`'s own source on 1.8.2 is 47,078 statements, 0 failed, **0 blocker sites**; lane E, zapo-js 1.8.2's `WaClient` path builds to a 28.8 MB binary that matches node | zapo release |
| **republish `@zapo-js/wam` built against 1.8.2** | 71 of wam's 86 sites, the 69-site `commit` family included | **measured**: lane F, the same wam source on 1.8.2 is 15 sites, all of them one island | zapo release |
| **publish `@zapo-js/media-utils` and `@zapo-js/voip` with provenance** | turns two UNMEASURED subjects into measured ones | measured, in the negative: both island today and the compiler says so | zapo release |
| a source mapping for `@vinikjkkj/wa-wam` (attested; published target `index.js`) | wam's remaining 15 | measured: they are all that is left | compiler / provenance |
| a source mapping for `mysql2/promise` (attested; published target `./promise.js`) | store-mysql's island | inferred from the note | compiler / provenance |
| `ioredis` and `pg` publishing provenance | store-redis's and store-postgres's 16-site `extending classes not declared in the program` families | **measured**: lane G, store-redis's own source on 1.8.2 opens up from 1,450 to 46,993 statements and the 16 sites **stay** — a zapo release does not touch them | upstream, not us |
| `export =` support (`@mongodb-js/saslprep`) | the single error that stops the store-mongo **build** | measured: it is the only error the build reports | compiler |
| the 223 `mongodb`/`bson` sites | store-mongo's survey total | not attempted here; that is the mongodb driver stack, not zapo | compiler |

The first two rows are the whole story of this measurement: **most of what the
objective is waiting on is a release, not a compiler change.** The compiler
already compiles zapo-js 1.8.2's client path to a running binary and
store-sqlite's source to zero blockers; the published artifacts point at an
older tag.


