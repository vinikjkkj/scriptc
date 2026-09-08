# wam reaches a binary, and the last wall was already built

Block `wamcoord`, branch `block/wamcoord`, worktree `<blocks>\wamcoord`, base
main **`83432479`**. Lab `<blocks>\wamcoord-lab`. Measured 2026-09-07.

Follows `tests/perf/pkgstatus-0907/`, which measured `wam` at **86 blocker
sites** on main `3f3dd523` and listed *"a source mapping for
`@vinikjkkj/wa-wam`"* under **what would change these numbers**, owner
*compiler / provenance*.

**That row is already implemented.** It landed on 2026-08-30 as
`4676cdc1 feat(provenance): map an attested package that publishes the source it
authored`, was defaulted OFF the same day because it produced a wrong binary,
and both halves of that wrong binary were fixed before `3f3dd523`. The gate is
still off, so `pkgstatus` measured the world without it and read the row as work
not yet done. Turning it on is one environment variable, and with it `wam`
compiles to **0 blocker sites** and a **running, byte-exact binary**.

---

## 0. What a reader should take away first

1. **`wam` reaches a binary. Two of them, strict, no `--best-effort`, engine
   scan `quickjs=0 ScrDyn=0 JS_NewRuntime=0`, oracle MATCH byte-exact.**
   * the **published npm package** `@zapo-js/wam@0.1.1`, through
     `--provenance-sources`, imported the way a real consumer imports it:
     **34,315,264 B**, exit 0, MATCH.
   * the same package's **source** on zapo-js 1.8.2, driving the 15-assertion
     entry probe: **33,431,040 B**, exit 0, `WAM-ENTRY2: ALL PASS`, MATCH.
2. **86 was never one number.** It is two independent facts multiplied
   together, and each is closed by a different move:

   | | gate OFF | gate ON |
   | --- | --- | --- |
   | driver names `@zapo-js/wam` only | **86** | **79** |
   | driver names `zapo-js` too | **15** | **0** |

   The rows are the **lane** (which zapo-js wins the alias table); the columns
   are the **compiler flag** (`SCRIPTC_PROVENANCE_AUTHORED_JS`). 71 sites are
   the lane. 15 are the flag. Neither move sees the other's sites.
3. **The flag's cost on a package that is not `wam` is smaller than this
   document first said, and §5 now carries the correction.** `store-mysql`
   **does not link under either setting** — rc=1 both ways, so its fence count
   is **n/a on both sides, not 0 → 20**. At the build the flag takes it from
   `46 errors.` to `11 errors.`, all of them named missing modules. §5, §10.
4. **The lane has a shape limit nobody had written down.** A mapped
   authored-JavaScript body is JavaScript, so its parameters are `unknown`
   whatever the `.d.ts` beside it declares. Measured twice on a fixture built
   for it: `table[param]` builds and then throws `[SC1090]`; `switch (param)`
   builds and then throws `[SC1100]`. The lane carries a package whose surface
   is **data** (wa-wam: 0 fences over 11,044,135 B of emitted C) and does not
   yet carry one whose surface is **functions taking arguments**. §6.
5. **Nothing covered any of this.** The four provenance suites pass 25/25 with
   the gate off AND with it on — they are indifferent to the mapping. A fifth
   suite, `tests/harness/provenance-authored-js.test.ts`, is added here: 4
   tests, both sides of the gate, including the `protocol=5` const read that
   was the original silent wrong answer. §7.

6. **`voip` is at 45 blocker sites, and nineteen of the 45 are not compiler
   work at all.** 8 are `any` casts zapo writes over a surface `lower-wrtc.ts`
   already supports; 11 are a representation decision that was declined with
   its cost written down. A site count cannot show that, and it changes what
   "voip is blocked on 45 things" means in a status table. The compiler-side
   tail is **17 sites over 16 distinct messages**, and it is a tail: after the
   two lowering fixes in sections 14 and 15 the largest remaining cause is two
   sites. Sections 15.5 and 16.

---

## 1. Lane, flags, host state

| | |
| --- | --- |
| repo | `<blocks>\wamcoord`, worktree of `<repo>`, branch `block/wamcoord` |
| main | **`83432479`** |
| compiler build | `packages/compiler` then `packages/cli`, `tsc -p tsconfig.json` under node **v22.18.0**, rc=0/0 |
| measuring node | **v25.9.0**, resolved first on `PATH`, printed as line 1 of every log |
| zig | **0.16.0**, the tree's (`<zapo-work>\tools\zig`) |
| tar | **GNU tar 1.35** (`C:\Program Files\Git\usr\bin`), ahead of System32 |
| `SCRIPTC_CC` / `SCRIPTC_TEST_CC` | `zigcc` / `zig cc` |
| `SCRIPTC_TARGET` | `x86_64-windows-gnu` |
| `SCRIPTC_TEST_WORKERS` | **unset** |
| flags | `--provenance-sources`, strict, **no `--best-effort`** anywhere |
| backend | `--backend c` on every build |
| caches | everything under `<blocks>\wamcoord-*`; nothing on `C:` |

The lab is `pkgstatus`'s driver tree (`napp/`), copied verbatim — same installed
versions, same `pkgsrc/wam` (verified `diff -r -q` byte-identical to the zapo-js
**1.8.2** attested checkout `757a8071b819`), so a difference between a number
here and one there is the compiler or the driver, never the corpus.

**Offline reproducibility, 2026-09-07.** This host s sandbox blocks network: a
curl of codeload.github.com, registry.npmjs.org and a known-good control all
return **HTTP 000**. And nine of the thirteen block roots the committed
`tests/perf/*/env.sh` files name no longer exist on disk, `<blocks>/pkgstatus-prov`
among them -- the provenance cache `pkgstatus-0907` was measured against. Those
numbers stand, because the cache is content-addressed and refetchable, but they
are **not reproducible offline today**: a reproduction goes to the network, and
the network is closed. Every number in THIS document was produced against
`<blocks>/wamcoord-prov`, which is intact.

### The six analysis lanes

| id | driver | names in the driver | gate |
| --- | --- | --- | --- |
| **A** | `drivers/wam.ts` | `@zapo-js/wam` | off |
| **A+** | `drivers/wam.ts` | `@zapo-js/wam` | **on** |
| **A2** | `drivers/_x-wam-plus-zapo.ts` | `zapo-js` **and** `@zapo-js/wam` | off |
| **A2+** | `drivers/_x-wam-plus-zapo.ts` | both | **on** |
| **F** | `pkgsrc/src-wam.ts` | the wam source on 1.8.2 | off |
| **F+** | `pkgsrc/src-wam.ts` | the wam source on 1.8.2 | **on** |

`_x-wam-plus-zapo.ts` is `drivers/wam.ts` with **one line added**, a value
import of `zapo-js` — the same A/B `pkgstatus` ran on `store-sqlite`.

---

## 2. The instruments, controlled before any number was quoted

### 2a. The blocker counter, against answers already on record

`harness/tally2.mjs`, run against `tests/perf/pkgstatus-0907/sites/`:

| control file | bytes | recorded | this block |
| --- | --- | --- | --- |
| `sites/src-wam.json` | 39,404 | 15 sites, 15 roots, 0 cascade, 3 messages | **15 / 15 / 0 / 3** ✔ |
| `sites/wam.json` | 134,115 | 86 sites, 82 roots, 4 cascade, 12 messages | **86 / 82 / 4 / 12** ✔ |

The 12 needs one word of definition, because two honest counters disagree on
it. `tally2.mjs` prints **8 distinct ROOT messages**; the 4 `SC2004` cascade
sites carry 4 further distinct messages of their own, and 8 + 4 = 12. Every
"distinct messages" figure below is the ROOT count unless the row says
otherwise.

### 2b. The fence counter, against answers already on record

`pkgstatus` §2a recorded four; all four reproduce:

| control file | bytes scanned | recorded | this block |
| --- | --- | --- | --- |
| `pkgrecheck-lab/bin/store-sqlite-open.c` | 364,322 | total=5 distinct=5 | **5 / 5** ✔ |
| `pkgrecheck-lab/bin/store-sqlite-names.c` | 107,026 | total=4 distinct=4 | **4 / 4** ✔ |
| `pkgrecheck-lab/bin/drv-pg-cleanup2.c` | 94,121 | total=0 | **0** ✔ (file non-empty) |
| `pkgrecheck-lab/bin/hello.c` | 2,193 | total=0 | **0** ✔ (file non-empty) |

### 2c. The trap this block walked into anyway

`build2.sh` first counted fences over `$OUT/$NAME.c` and printed

    TOTAL files=0 bytes=0 FENCES=0

for a build that had emitted **11,044,135 bytes** of C. The `-o` name and the
translation-unit name are **different**: the TU is named after the SOURCE
(`wawam-min.c`), not after the output (`wawam-min-c.exe`). `files=0 bytes=0` is
what saved it — a count with no bytes beside it would have shipped as a zero.
Every fence table below prints the file list and the byte total.

---

## 3. The measured start, and the 2x3 that explains 86

`analyze()`, `--provenance-sources`, strict. Every row ran on THIS compiler at
`83432479`; the two `pkgstatus` rows it reproduces are marked.

| lane | blocker sites | roots | cascade | distinct root msgs | stmts reached / failed | island | fences | advisories | unreached |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A** (reproduces 86) | **86** | 82 | 4 | 8 | 1,462 / 76 | 0 | 0 | 0 | 189 |
| **A+** | **79** | 75 | 4 | 6 | 1,484 / 74 | 0 | 0 | 0 | 184 |
| **A2** | **15** | 15 | 0 | 3 | 48,023 / 10 | 0 | 1 | 56 | 8 |
| **A2+** | **0** | 0 | 0 | 0 | **48,045 / 0** | 0 | 1 | 56 | 8 |
| **F** (reproduces 15) | **15** | 15 | 0 | 3 | 48,022 / 10 | 0 | 1 | 56 | 8 |
| **F+** | **0** | 0 | 0 | 0 | **48,044 / 0** | 0 | 1 | 56 | 8 |

A reproduces `pkgstatus`'s 1,462 / 76 and F its 48,022 / 10 exactly, so the
lab, the compiler and the counter all agree with the recorded survey before any
new number is read.

### 3a. The message and file clustering, which is the point of the table

**A — 86 sites, 8 root messages, and 69 of them are one message in one file:**

```
69  SC1090  calls of the generic method 'commit' through this receiver     packages/wam/src/synthetic/fabrications.ts   (69 distinct lines)
 5  SC2013  importing '@vinikjkkj/wa-wam' requires the embedded engine     5 files, line 1 of each
 2  SC2011  WaClientPluginDefinition & { exposeAs: "wam"; … }              plugin.ts, WaWamCoordinator.ts
 2  SC2013  values from '@vinikjkkj/wa-wam' run in the embedded engine     registry.ts, globals.ts
 1  SC2011  WaClientDependencies                                           <prov>/src/client/WaClient.ts
 1  SC2001  WaClientConstructor                                            napp/drivers/wam.ts
 1  SC1090  RAW_WA_APPSTATE_SCHEMAS (declaration-only module)              <prov>/src/appstate-spec.ts
 1  SC2011  WaClientPluginContext                                          <prov>/src/client/WaClient.ts
+4  SC2004  cascade                                                        WaClient.ts, wam.ts x3
```

**A+ — 79 sites, 6 root messages.** Exactly the **7** `@vinikjkkj/wa-wam`
`SC2013` sites left; nothing else moved. The 69 stayed, and they are the whole
reason a gate-only reading of `wam` looks like almost no progress.

**A2 and F — 15 sites, 3 root messages, all `SC2013`, all one package:**

```
9  values from '@vinikjkkj/wa-wam' run in the embedded dynamic engine
5  importing '@vinikjkkj/wa-wam' requires the embedded dynamic engine
1  … (instantiating 'commit' with <string>)

4  WaWamCoordinator.ts     3  registry.ts     3  wire/encoder.ts
3  wire/WamBatch.ts        2  globals.ts
```

**A2+ and F+ — no blocker sites at all.** `sections:` reads
`runtimeFence=1 advisory=56 unreached=8` and nothing else.

### 3b. The two axes are orthogonal, and the compiler says so unprompted

Naming `zapo-js` in the driver is a **lane** fact. A2's own provenance notes
carry the compiler's explanation, printed without being asked:

> `40 alias key(s) are spelled by more than one mapped package with different
> targets ('zapo-js/store', 'zapo-js/signal', …); tsconfig "paths" is one table
> per program, so zapo-js's answer is used for all of them and @zapo-js/wam
> compile against zapo-js's checkout for those specifiers`

That is `pkgstatus` §5c's 41-key collision, seen from wam's side, and it takes
`wam` from the July core its own attestation pins to 1.8.2. The 69 `commit`
sites are downstream of `WaWamCoordinator` failing to compile on that older
core: they are `SC1090`, never `SC2004`, so **no roots/cascade split can see
them as fallout** — the correction `pkgstatus` bought, reproduced here from the
other direction.

`packages/wam/src` is byte-identical between wam's attested `1dc6b9f8de93` and
the 1.8.2 tag (`diff -r -q`, empty). The 71-site difference is entirely which
zapo-js the program compiles against.

---

## 4. The binaries

`build2.sh`, `--backend c`, strict. `LOG-SITES` counts `` - error SCxxxx: ``
over the build log; fences count `[SCxxxx at file:line]` over **every** emitted
TU (`.c`, `.partN.c`, `.scrh`), byte total printed.

| binary | lane | gate | rc | log sites | bytes | run | oracle | fences / bytes scanned | engine scan |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `srcwam-off` | F | off | **1** | **15**, all `SC2013`, compiler's own `15 errors.` | — | — | — | **n/a, NOT 0** | — |
| `srcwam-on` | F | **on** | **0** | **0** | **34,314,240** | exit 0 | **MATCH byte-exact** | 1 / 164,961,837 over 15 TUs | 0 / 0 / 0 |
| `srcwament-on` | F, 15 assertions | **on** | **0** | **0** | **33,431,040** | exit 0, `WAM-ENTRY2: ALL PASS` | **MATCH byte-exact** | 1 / 159,209,742 over 15 TUs | 0 / 0 / 0 |
| `npmwam-on` | **A2, the published package** | **on** | **0** | **0** | **34,315,264** | exit 0 | **MATCH byte-exact** | 1 / 165,944,512 over 16 TUs | 0 / 0 / 0 |
| `wawam-min-c` | the 6-line wa-wam probe | **on** | **0** | **0** | **2,701,824** | exit 0 | **MATCH byte-exact** | **0** / 11,044,135 | 0 / 0 / 0 |

The one fence in the three large binaries is the same site in all three, and it
is not wam's:

    1  [SC2020 at <prov 757a8071>/spec/proto/index.js:1]   'require() with a run-time specifier'

`pkgstatus` records that exact site as the single fence in `store-memory` and in
`_x-waclient-182`. It is zapo's protobuf bundle, shared by everything that
loads zapo-js.

`npmwam-on`'s provenance notes are the claim in the compiler's own words:

```
provenance: zapo-js@1.8.2 ← …@refs/tags/v1.8.2 @ 757a8071b819 (source compiles statically)
provenance: @zapo-js/wam@0.1.1 ← …@refs/heads/master @ 1dc6b9f8de93 (source compiles statically)
provenance: @vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b ← …@refs/heads/master @ 1ec0d3b91d0e (source compiles statically)
```

### 4a. A recorded defect, retired by compiling rather than by reading

`tests/perf/wamfix/BINARIES.md` keeps two binaries as **the reproduction of an
open defect**: `wawam-min.c.exe` printed `protocol=0` where node prints `5` and
then died `0xC0000005`, because the mapped twin's module-init function was
emitted and never called. `provenance.ts`'s own comment says both halves are
fixed. **That comment is a hypothesis until something compiles it.**

Rebuilt here from the same probe source, on `83432479`, strict, gate on:

    protocol=5
    wire.regular=0
    wire.private=2
    CHAT_OPEN=3
    LT128=3
    WAWAM-MIN: reached the end

exit 0, 88 bytes, byte-identical to node v25.9.0, **0 fences over 11,044,135
bytes**, engine scan 0/0/0. **The comment is upheld. `tests/perf/wamfix/`'s two
## 5. What the flag costs on a package that is not `wam`

The gate is global. `store-mysql` is the other package whose island note names
an authored-JavaScript entry (`mysql2/promise`), and `provenance.ts`'s own
comment names it too. Lane A, same driver, same compiler, gate off then on.

### 5a. The build: neither setting links, so there is no binary to lose

| | gate OFF | gate ON |
| --- | --- | --- |
| `BUILD rc` | **1** | **1** |
| log error sites / compiler's own line | 46 / `46 errors.` | **11** / `11 errors.` |
| the codes | 20 SC1090, 20 SC2004, 3 SC2011, 2 SC2013, 1 SC2001 | **11 SC1010, nothing else** |
| binary | none | none |
| fences in an emitted TU | **n/a, NOT 0** | **n/a, NOT 0** |
| log bytes scanned | 22,158 | 11,516 |

With the gate on the build **stops at module link** — eleven
`SC1010 the '<x>' module is not supported yet` — and never reaches the checker,
so it reports none of the codes the OFF build reports (`SC2013` off=2 on=0,
`SC2011` 3/0, `SC2001` 1/0, `SC2004` 20/0, `SC1090` 20/0). This is the shape
`pkgstatus` recorded for `store-mongo`: *"the build stops at a module-link
refusal and the survey does not."*

**So the flag costs `store-mysql` no working binary, because it has none under
either setting.** What it changes is the failure: 46 mixed errors become 11 that
each name a module nobody has lowered (`lru.min`, `sql-escaper`,
`generate-function`, `iconv-lite`, `long`, `aws-ssl-profiles`).

### 5b. The survey, and the correction to how it was counted

`analyze()`, the same two runs:

| | gate OFF | gate ON |
| --- | --- | --- |
| blocker sites | **46** | **58** |
| roots / cascade | 26 / 20 | 38 / 20 |
| distinct root messages | 11 | **18** |
| statements reached / failed | 1,462 / 24 | **1,523 / 44** |
| `runtimeFence` **section** of the dump | 0 | 20 |

**The last row is not a fence count on an artifact.** It is `analyze()`'s
projection of what *would* fence, over code that never reaches a translation
unit, because the build fails. An artifact-level fence count for this package
is **n/a on both sides**. The first version of this document printed it as
`0 → 20` beside artifact fence counts taken on real binaries, which invited
exactly the comparison it cannot support.

**And the closed/uncovered split was counted by MESSAGE and is wrong at site
identity.** `harness/diffsites.mjs` compares the two dumps by
`(section, code, file, line)`. 213 of the sites are identical in both. The rest:

| | blockers | all sections |
| --- | --- | --- |
| only with the gate OFF (closed) | **3** | 6 |
| only with the gate ON (uncovered) | **15** | 39 |

46 − 3 + 15 = 58, which is the arithmetic the message tally could not show.
Two of the three "closed" and two of the fifteen "uncovered" are **the same
file and line**:

```
store-mysql/src/BaseMysqlStore.ts:13   SC2013 island refusal  ->  SC2009 'Pool' member 'getConnection' does not compile
napp/drivers/store-mysql.ts:7          SC2011 island refusal  ->  SC2009 'WaMysqlStoreResult' member 'pool' does not compile
```

Those two sites were not closed and not opened — they were **re-diagnosed**, and
strictly more informatively: an "it runs in the engine" refusal became a named
member with a named type. So the honest ledger is **1 site removed**
(`connection.ts:1`, the `mysql2` import), **2 re-diagnosed deeper**, and **13
genuinely newly visible**.

### 5c. Caused, or exposed?

All 13 newly visible blockers live in `mysql2`'s own published artifact —
`lib/parsers/*.js`, `lib/base/*.js`, `lib/packets/packet.js`,
`lib/constants/ssl_profiles.js`, `promise.js`, `promise.d.ts` — and none in
`store-mysql` or the driver. Eleven are `SC1010 module is not supported yet`
against six third-party modules; two are `SC1090` in `promise.d.ts`
(`extending computed expressions`, `extending 'QueryableAndExecutableBase'`).

**Exposed, not caused.** Nothing about the flag creates them: they are
properties of `mysql2` and of which modules have lowerings, and they hold
under any setting *once that code is reachable*. Reachability is the only thing
the flag grants. Not one already-reachable line got a worse diagnosis — the two
that changed got a better one (5b).

The same is true of all 20 `runtimeFence` entries: every one is in
`mysql2/promise.js` (`SqlString` references, `exports.__defineGetter__`,
`Connection.once`, `createPool`/`createPoolCluster` bindings). They are that
file's own constructs, and they are a projection, not a binary's contents.

er one, and the 20 fences are new code that can throw where
before there was a build-time refusal.

---

## 6. The shape limit of the lane, measured

A mapped authored-JavaScript file is JavaScript. Its function parameters are
`unknown` inside the body whatever the `.d.ts` beside it declares, and the first
thing done with one refuses. Both measured on the fixture added here, both as
**runtime fences in a binary that built cleanly** — `analyze()` reported 0
blockers each time:

| body | outcome |
| --- | --- |
| `const code = CHANNEL_WIRE_CODES[channel]` | built; threw `indexing records with non-string or non-number keys are not supported yet` `[SC1090 at index.js:30]` |
| `switch (channel) { … }` | built; threw `switch statements on 'unknown' values are not supported yet` `[SC1100 at index.js:35]` |

So the lane carries a package whose published surface is **data** —
`@vinikjkkj/wa-wam` is 1,657,939 bytes of frozen tables and compiles to **0
fences over 11,044,135 bytes of C** — and does not yet carry one whose surface
is **functions that take arguments**. That is the same wall `mysql2` hits in §5
from the other side, and it is the honest scope of the flag: it is not a general
"authored packages now compile" switch.

---

## 7. The coverage that did not exist

The four existing provenance suites pass **25/25 with the gate off and 25/25
with the gate on**, on the same tree, same compiler. They do not exercise the
mapping in either direction — so the fix that made the `0xC0000005` go away is
protected by nothing, and a default flip would ship untested.

Added: **`tests/harness/provenance-authored-js.test.ts`** — 4 tests, both sides
of the gate, offline (fixture manifest, no network):

1. gate OFF: the tree is located, the mapping is refused, the note reads
   `no source mapping for 'authoredjs' (published target: index.js)`, and the
   island build still prints the right answer — the shipped default is a
   refusal to compile statically, never a wrong number;
2. gate ON: the package maps, and it maps to the **`.d.ts`**, not the `.js`
   (taking the implementation directly would drop the types and send any
   consumer naming one type token back to the island);
3. gate ON: `analyze()` reports **0** blockers;
4. gate ON: `dynamic:false` — no engine in the binary — and the output is
   byte-identical to the island build, **`protocol=5` included**. That const is
   the line that read `0` while the twin's init was never called.

Fixture: `tests/fixtures/provenance/{node_modules,attested-src}/authoredjs`
(CJS frozen tables + hand-written `.d.ts`, `main: index.js`, no build step —
wa-wam's shape), `manifest-authoredjs.json`, `cases/authoredjs/main.ts`.

All five provenance suites, default env: **5 files, 29 tests, 29 passed.**

No compiler source was changed by this block. The default lane is byte-identical
to base by construction, and lanes A and F reproduce `pkgstatus`'s recorded
numbers exactly, which is the measurement of that.

---

## 8. The fork

`wam` reaches a binary today. What it costs to make that the DEFAULT answer
rather than one an environment variable buys:

| move | clears | costs | who decides |
| --- | --- | --- | --- |
| **leave the gate as it is** and record that `wam` compiles behind it | nothing new; the objective's `wam` row is answerable with a flag named beside it | every consumer must know the variable exists; `pkgstatus`'s "compiler / provenance" row stays open-looking when it is not | — |
| **flip `SCRIPTC_PROVENANCE_AUTHORED_JS` on by default** | `wam`'s last 15 sites without a flag; 1 `store-mysql` site removed and 2 re-diagnosed deeper | `store-mysql` gains 13 newly visible blockers, all of them `mysql2`'s own and all of them true under any setting — and it **linked under neither setting before or after**, so no working binary is at risk. What is unmeasured is the other packages: 33 of 122 installed packages could take this path, and only 2 have been measured. §10.3 | the user |
| **flip it only for packages whose published entry has no imports** | `wam`, and nothing that can regress: wa-wam imports nothing, which is exactly why it fences 0 | a new rule to write and test; narrower than the flag, and it would not have helped `mysql2` anyway | the user, then compiler |
| a `wam` release built against 1.8.2 (`pkgstatus`'s row) | the 71 lane sites for a driver that does **not** name `zapo-js` | nothing here; a real consumer names `zapo-js` and gets those 71 for free today | zapo release |

The third row **was** the one worth arguing about, and §10.3 now settles it:
"imports nothing" selects 21 of the 33 candidate packages, so it is a rule and
not a fit to one case — but it is the **wrong** rule. `libmlow-wasm` imports
nothing and exports five functions that take parameters, which is precisely the
shape §6 shows this lane cannot carry. The predicate that matches the observed
failure is about the exported **surface**, not the imports, and it is not
cleanly decidable from a package manifest. §10.3 proposes a fourth option that
needs no predicate at all.

**This block did not flip the default.**

---

## 9. Reproducing

```sh
. harness/env.sh                          # rewrite the wamcoord-* paths for your block
bash harness/q1.sh                        # lanes A, A2, F     (gate off)
bash harness/q2.sh                        # lanes F+, A+, A2+  (gate on)
bash harness/q3.sh                        # the minimal wa-wam probe, gate on
bash harness/q4.sh                        # srcwam off/on + the 15-assertion entry
bash harness/q5.sh                        # the published package, gate on
bash harness/q6.sh                        # store-mysql blast radius, both ways
bash harness/q7.sh                        # the four existing suites, both ways
bash harness/q9.sh                        # all five suites, default env
node harness/tally2.mjs sites/<name>.json # roots / cascade / messages / files
```

| what | where |
| --- | --- |
| every `analyze()` dump | `sites/*.json` |
| every queue and build log, binary stdout, oracle stdout | `logs/*` — the logs are `<name>.log.txt`, **not** `<name>.log`: `.gitignore` line 24 is `*.log`, so the first version of this commit silently committed none of them. `tests/perf` carries 405 `.txt` files and 0 `.log` for exactly this reason. vitest's ANSI colour escapes are stripped from the four suite logs, which say so on their first line; no other byte differs |
| the drivers, including the one-line A/B | `drivers/*.ts` |
| the harness, including the corrected fence walk | `harness/*` |

---

## 10. The coordinator's five questions

Everything below was measured after the first version of this document, on the
same rig, same compiler at `83432479`, same host state as §1. Two answers
correct §0 and §5 above; those sections have been rewritten rather than
annotated, so the body no longer carries the wrong number anywhere.

### 10.1 Does `store-mysql` produce a binary at all?

**No — under neither setting.** `harness/qA.sh`, strict, `--backend c`, no
`--best-effort` (no build this block ran ever received it; a grep of every log
returns one hit and it is the word inside a comment):

    gate OFF   BUILD rc=1   41s   LOG-SITES 46   compiler: "46 errors."   BINARY: none
    gate ON    BUILD rc=1   10s   LOG-SITES 11   compiler: "11 errors."   BINARY: none

So the two numbers did not coexist, and the coordinator was right to say so.
**The 20 was never a fence count on an artifact** — it is the `runtimeFence`
**section of the `analyze()` dump**, a projection over code that never reaches a
translation unit. An artifact fence count for `store-mysql` is **n/a on both
sides**, and the `0` on the OFF side would have been exactly the "no artifact
read as zero" trap this document's own §2 is armed against. §5a carries the
corrected table.

**The flag therefore costs no working binary today**, because there is none to
lose. It changes the failure mode: 46 mixed errors become 11, each naming a
module with no lowering, at module-link time before the checker runs.

### 10.2 Caused, or exposed?

**Exposed.** `harness/diffsites.mjs` compares the two dumps by
`(section, code, file, line)` rather than by message. All 13 genuinely new
blockers are inside `mysql2`'s own published artifact and none in `store-mysql`
or the driver; 11 are `SC1010` against six third-party modules and 2 are
`SC1090` in `promise.d.ts`. They hold under any setting once that code is
reachable, and reachability is the only thing the flag grants.

The identity comparison also corrected the ledger itself: **not "closed 2,
uncovered 14"** but **1 site removed, 2 re-diagnosed deeper** (an island refusal
becoming a named member with a named type, which is strictly more informative),
**13 newly visible**. §5b.

### 10.3 Is "imports nothing" a rule, or a rule fitted to one case?

Measured with `harness/predicate.mjs` over the lab's 122 installed packages,
applying the compiler's own `publishedTargetOf` + `authoredJsEntry` tests:

    authored-JavaScript candidates                     33 of 122
    P1  "the mapped entry imports nothing"             21 of the 33
    P2  "exports no declared function taking params"   26 of the 33

So **P1 is a rule, not a fit** — it selects 21 packages, and it does separate the
two cases that have actually been measured (`@vinikjkkj/wa-wam` 0 imports;
`mysql2` root 1, `mysql2/promise` 3 — `bluebird`, `events`, `sql-escaper`).

**But it is the wrong rule, and the counter-example is in the corpus:**

    libmlow-wasm    imports = 0        exported declare-functions taking parameters = 5

P1 admits it. §6 says the lane cannot carry it: every one of those five
parameters is `unknown` inside the mapped body. And the converse exists too —
`buffer`, `iconv-lite`, `token-types`, `long` all import something and export no
parameter-taking function, so P1 rejects packages the failure mode does not.

**"Imports nothing" is not a proxy for "surface is data".** They are different
predicates that happen to agree on the two packages I had measured, which is
exactly the shape of a generalisation that should not be trusted.

Can the real predicate be stated directly? Partly, and that is the honest
answer. The failure is per-*use*, not per-package: it fires when a mapped body
does something with a parameter that needs a type. The compiler already decides
that per site — it emits the fence. A package-level approximation ("no exported
function takes a parameter") is (a) not decidable from the manifest, only from
parsing the `.d.ts`, (b) blind to callable surfaces that are not
`export declare function` — `sharp`'s 82,672-byte `.d.ts` scores 0 on P2 and is
certainly not data — and (c) reachability-dependent anyway.

**A fourth option that needs no predicate:** make the gate take a **package
list** instead of a boolean —
`SCRIPTC_PROVENANCE_AUTHORED_JS=@vinikjkkj/wa-wam`. `wam` gets its binary with a
blast radius of exactly one named package, the general rule stays deferred until
more than two packages have been measured, and the flag stops being a global
switch whose cost nobody can bound. It is a small change to `authoredJsEntry`'s
two lines and it is testable with the fixture already added here.

### 10.4 Would a DefinitelyTyped-declaration rule close the same 15?

**No.** The two rules take different inputs and select different packages.

`@vinikjkkj/wa-wam` **ships its own `index.d.ts` inside its own attested tree**,
beside its own `index.js` (2,037,013 B and 1,657,939 B). There is no
`@types/wa-wam` — the lab's `@types` inventory is `better-sqlite3`, `node`,
`pg`, `webidl-conversions`, `whatwg-url`, `ws`. A rule that pairs a package's
JavaScript with a **separate `@types/*` package's** declaration has nothing to
pair here, so it closes none of wam's 15.

The caveat worth passing to that block: if their rule is written generally — *"a
declaration twin from anywhere, paired with the published implementation"* —
then it **is** `authoredJsEntry` widened, it inherits this same blast radius and
this same §6 parameter limit, and it should face one fork rather than two. If it
is written specifically as "`@types/*` only", the two are complementary and can
be decided separately.

### 10.5 Does the new suite write outside its own tmp, and is it order-independent?

**Writes.** Only `node_modules/.cache/scriptc-tests/provenance-authored/<flavor>`
— its own directory, distinct from all four siblings, which each have their own
(`provenance`, `provenance-aliasbase`, `provenance-dist-esm`,
`provenance-transitive`). Contents after a full run: three `.exe`, two `.pdb`,
one 16,767-byte `main.c`. Plus the shared CAS at
`node_modules/.cache/scriptc-tests/cas` that `vitest.config.ts` hands **every**
suite. `git status tests/fixtures` after the runs: empty — the fixture tree is
read-only to the test.

**Order-independence.** One real hazard existed and is fixed: the first version
`delete`d `SCRIPTC_PROVENANCE_MANIFEST` and `SCRIPTC_PROVENANCE_AUTHORED_JS` in
`afterEach`. Both are process-global, so on a run where the *caller* had set the
gate, this file would have silently cleared it for every file sharing its worker
afterwards. It now **saves the entry values and restores them**, and the two
tests that assert the shipped default `delete` the gate explicitly for their own
duration instead of assuming it is unset.

Measured three ways, `harness/qB.sh`, all five provenance suites:

| run | result |
| --- | --- |
| default env, declared order | **5 files, 29 tests, 29 passed** |
| `SCRIPTC_PROVENANCE_AUTHORED_JS=1` forced for the whole run | **29 passed** |
| reversed file order, default env | **29 passed** |

Run 2 is the one that matters for caller-independence: the two gate-OFF
assertions hold with the gate forced on globally, which is what the explicit
`delete` buys. There is no module-level state beyond those two variables; the
compiler's `setProvenanceSources` is reset to `null` in `afterEach`, as in the
sibling suite. Files run in separate workers and sequentially within one, so no
concurrency hazard is introduced.

### 10.6 `G:` footprint

    <blocks>/wamcoord           405M   worktree (node_modules is pnpm-linked)
    <blocks>/wamcoord-lab       934M   of which out/ 850M (emitted C, prunable)
    <blocks>/wamcoord-zig       524M
    <blocks>/wamcoord-cache     135M
    <blocks>/wamcoord-zig-g      71M
    <blocks>/wamcoord-prov       53M   three attested checkouts
    <blocks>/wamcoord-tmp       3.7M
                                 ----
                          TOTAL  2.1G      disk: 31G free of 932G

The 850M in `wamcoord-lab/out` is the emitted C of the five builds, kept because
the fence counts in §4 are auditable only against it. It is the one item worth
pruning on request; everything else is the rig.

---

## 11. Option 4 shipped: the gate is a whitelist, and `wam` needs no flag

Decided by the coordinator after §10; this section is the change and its
evidence. Compiler source is touched for the first time by this block:
`packages/compiler/src/frontend/provenance.ts` and one export line in
`packages/compiler/src/index.ts`.

### 11.1 What the gate is now

`AUTHORED_JS_DEFAULT_PACKAGES` — one exported constant, data, not a branch:

    export const AUTHORED_JS_DEFAULT_PACKAGES: readonly string[] = ["@vinikjkkj/wa-wam"];

`SCRIPTC_PROVENANCE_AUTHORED_JS` now reads four ways:

| value | meaning |
| --- | --- |
| unset | the default whitelist above — **what ships** |
| `pkg` or `a,b` | exactly those packages |
| `1` / `true` / `all` (any case) | every package — **the original boolean spelling, unchanged** |
| `` (empty), or whitespace-only | no package at all — the way to turn the lane fully off |

**Precedence, because one value can look like both spellings at once:** if any
comma-separated entry is an all-sentinel, **ALL wins** and the named entries are
ignored, so `1,@scope/pkg` means every package and `1` is never read as the name
of a package called `1`. The wider answer wins deliberately: the boolean
spelling is the one already sitting in env templates, and silently narrowing it
would change what those templates do. The rule is stated in the function's own
doc comment, not only here.

The allowlist is read on every call rather than cached — a caller can set the
variable between two resolutions in one process (the suite does), and a cache
would make the second answer with the first one's world.

### 11.2 The headline: `wam` with no environment variable at all

`harness/qC.sh`, `AUTHORED_JS=<unset>`, strict, no `--best-effort`,
`--backend c`. The driver is the npm-lane one: the **published**
`@zapo-js/wam@0.1.1`, imported the way a real consumer imports it.

    BUILD rc=0   1402s   LOG-SITES total=0   (compiler printed no errors line)
    BINARY bytes=34,315,264
    RUN exit=0   59 B stdout
    ORACLE node v25.9.0 exit=0   ORACLE: MATCH (byte-exact)
    FENCES 1 over 165,944,512 bytes across 16 TUs  (zapo's spec/proto require)
    engine scan: quickjs=0  ScrDyn=0  JS_NewRuntime=0

    provenance: zapo-js@1.8.2 <- v1.8.2 @ 757a8071b819 (source compiles statically)
    provenance: @zapo-js/wam@0.1.1 <- master @ 1dc6b9f8de93 (source compiles statically)
    provenance: @vinikjkkj/wa-wam@2.3000... <- master @ 1ec0d3b91d0e (source compiles statically)

Byte-identical in size to the flagged build of §4 (34,315,264 both), which is
the check that the whitelist reaches the same program and not a similar one.

### 11.3 The regression the whitelist exists to prevent

A package **not** on the list must behave exactly as it did when the gate was a
boolean set to off. `store-mysql`, lane A, four spellings, same compiler:

| spelling | blockers | roots / cascade | `runtimeFence` section | stmts / failed |
| --- | --- | --- | --- | --- |
| old gate OFF (pre-change baseline) | 46 | 26 / 20 | 0 | 1,462 / 24 |
| **unset (shipped default)** | **46** | **26 / 20** | **0** | **1,462 / 24** |
| old gate ON (pre-change baseline) | 58 | 38 / 20 | 20 | 1,523 / 44 |
| **`=1`** | **58** | **38 / 20** | **20** | **1,523 / 44** |
| **`=mysql2`** | **58** | **38 / 20** | **20** | **1,523 / 44** |

The default reproduces the old OFF exactly and `=1` reproduces the old ON
exactly. Neither number is netted and neither is a fence count on an artifact —
`store-mysql` still links under no setting (§5a), so its artifact fence count
remains **n/a, not 0**.

### 11.4 Coverage

`tests/harness/provenance-authored-js.test.ts` — **9 tests**, up from 4. The
five added ones are the four readings plus the constant itself:

* the default list is data and is exactly `["@vinikjkkj/wa-wam"]` — if that
  constant changes, the change is the review;
* unset means the default list, **not** all (the fixture package is deliberately
  not on the list, which is what makes this assertable);
* an explicit list of one maps exactly that package, and a list naming somebody
  else does not carry it in;
* `1`, `true`, `all`, `ALL` all mean every package, and `1,other` resolves to
  all — the precedence rule, asserted;
* empty, and whitespace-only, mean no package.

The save-and-restore discipline from §10.5 is kept: the file restores both
environment variables to their entry values, and the assertions about the
shipped default `delete` the variable explicitly rather than assuming it unset.

### 11.5 Suites run, and suites NOT run

`harness/qF.sh` — **96 of the 100 `tests/harness` suites plus every
`packages/*` suite**:

    Test Files  93 passed | 3 skipped (96)
         Tests  1858 passed | 49 skipped (1907)
        Errors  2 errors
      Duration  1042.51s

**The 2 errors are `[vitest-worker]: Timeout calling "onTaskUpdate"`** — vitest's
reporter RPC timing out, twice, while a 23-minute compile was running on the
same six cores. Not a test failure and not a program: 0 failed. Named here
rather than swallowed, because a reader counting "errors" is entitled to know
which kind they were.

**NOT RUN, named as unrun:** `differential.test.ts`,
`llvm-differential.test.ts`, `windows-differential.test.ts`,
`linux-differential.test.ts` — the four corpus differential drivers. They are
excluded for cost, not because they are irrelevant; no corpus program passes
`--provenance-sources`, so the whitelist cannot reach them, but that is an
argument and the full gate is the measurement. The `pnpm test` full gate was not
run by this block.

### 11.6 The table that decides option 2 later

The question was: of the 33 authored-JavaScript candidates, how many move, which
way, and does any move backwards. `harness/candidates.mjs`, resolution only —
no build, no `analyze()` — because the authored probe is only **reached** for a
package whose attested tree was located, so "can it move at all" is answerable
first and cheaply, for all 33.

| class | count | what it means |
| --- | --- | --- |
| **NOT-ATTESTED** | **26** | publishes no provenance attestation, so the mapping is never reached under any setting. **UNMEASURABLE through this lane — not 0** |
| **ordinary TypeScript path** | **4** | `@sec-ant/readable-stream`, `aws-ssl-profiles`, `lru.min`, `sql-escaper` — they look like authored-JS candidates from their *published* shape but carry `src/*.ts` in their **attested** trees, so they map the normal way whatever this list says |
| **NOT-REACHED** | **1** | `buffer` — resolves as the Node builtin, never enters as an npm package |
| **on the default list** | **1** | `@vinikjkkj/wa-wam` |
| **MOVES when widened to `all`** | **1** | **`mysql2`** |

**So in zapo's dependency closure, flipping to `all` changes exactly one
package, and it is the one already fully measured in §5.** It moves the way
`mysql2` moved: deeper true walls uncovered, 1 site removed, 2 re-diagnosed, 13
newly visible, and **no artifact on either side**. **Nothing moves backwards** —
no package maps under the default and stops mapping under `all`, which the
`default`/`all` pair in the scan checks directly for all 33.

That corrects my own §10.3 wording, which said 31 of the 33 were unmeasured. The
honest count is that 31 of the 33 **cannot be affected by this setting at all**
in this corpus — 26 unreachable, 4 mapping by another rule, 1 a builtin — and
the scan proves it rather than assuming it.

**Verified, not assumed, that the whitelist does not leak.** Four packages map
on the shipped default while not being on the list, which would be a bug if they
used the authored path. `harness/checkmap.mjs` reads the mapped entry's
extension: `.d.ts` is the authored path, `.ts` is the ordinary one.

    @sec-ant/readable-stream  -> .../src/index/index.ts             ordinary TypeScript path
    aws-ssl-profiles          -> .../src/index.ts                   ordinary TypeScript path
    lru.min                   -> .../src/index.ts                   ordinary TypeScript path
    sql-escaper               -> .../src/index.ts                   ordinary TypeScript path
    @vinikjkkj/wa-wam         -> .../packages/wam/index.d.ts        AUTHORED-JS PATH

Exactly one entry takes the authored path on the default, and it is the one on
the list.

**What this does and does not settle.** It settles that option 2 is close to
free *in this corpus, today*. It does not settle option 2, for two reasons the
whitelist is the right answer to: attestation is a per-publish property, so a
package unreachable today becomes reachable the day it publishes with
provenance and a wide setting would adopt it **silently**; and the §6 parameter
limit is real, so the lane still has a shape it cannot carry. A list is where a
package gets recorded as *checked*. Growing the array is a reviewable diff;
widening a boolean is not.

**What was left undone:** pass 2 — per-candidate `analyze()` and build under
both settings — was not run for the 31 that cannot move, because a setting that
provably never reaches them cannot change their numbers. For `mysql2`, the only
mover, pass 2 already exists as §5. If the 26 unattested ones are wanted as
measured island numbers rather than as unreachable, that is a different survey
and a large one; say so and I will run it.

### 11.7 `tests/perf/wamfix/BINARIES.md` corrected

Its two `WRONG` rows recorded an open defect — `protocol=0` where node prints
`5`, then `0xC0000005` — that §4a refuted by rebuilding. Both rows now say when
they were built and that the defect is closed, and a new section carries the
rebuild's numbers (`protocol=5`, exit 0, 2,701,824 B, MATCH byte-exact, 0 fences
over 11,044,135 B), what the cause actually was (an edge dropped at resolution,
not the twin-init redirect the file's own diagnosis blamed), and the note that
the probe now builds with no environment variable at all.

---

## 12. An incident: five attested trees on the user's C: drive, and the guard

**It was me.** One invocation out of thirty-four, and it was the script I wrote
to verify that the whitelist does not leak.

### 12.1 What happened, and the evidence it was this and not something else

`<home>\.cache\scriptc\provenance` appeared at 18:56 on 2026-09-07:
**254 files, 10.4 MB**, containing a checkout whose hash is present in exactly
one block cache on `G:` — mine.

The mechanism is `packages/compiler/src/frontend/provenance.ts:312`:

```ts
return process.env["SCRIPTC_PROVENANCE_CACHE"] ?? join(homedir(), ".cache", "scriptc", "provenance");
```

No warning, no error, unbounded size. An earlier occurrence of this same
directory put **2.17 GB** on the user's drive.

The invocation was `node checkmap.mjs`, run from a shell that had **not**
sourced `env.sh` — the §11.6 script that reads each mapped entry's extension to
prove the authored-JS whitelist does not leak. It resolves provenance for
exactly five packages.

**The fingerprint is exact.** Those same five trees, as they sit in my own
pinned `G:` cache:

| tree | files | bytes |
| --- | --- | --- |
| `lru.min` | 50 | 212,311 |
| `@sec-ant/readable-stream` | 42 | 455,646 |
| `sql-escaper` | 64 | 256,271 |
| `aws-ssl-profiles` | 30 | 264,558 |
| `wa-spec` (`@vinikjkkj/wa-wam`) | 68 | 9,715,795 |
| **total** | **254** | **10,904,581 = 10.4 MB** |

254 files and 10.4 MB, against 254 files and 10.4 MB observed on `C:`. That is
not a coincidence and I am not going to argue it down.

The timeline corroborates it: those four small trees entered my `G:` cache at
**18:55:11–18:55:16**, written by `harness/qG.sh` (which *does* source
`env.sh`); `checkmap.mjs` ran immediately after `qG` finished at 18:55:17; the
`C:` directory was written at **18:56**. It is the same five trees extracted a
second time, by a shell without the pin.

### 12.2 The audit, in both directions

Mechanical, over every entry point in the rig:

| | count | verdict |
| --- | --- | --- |
| `.sh` entry points that source `env.sh` (all six pins) | 30 of 33 | pinned |
| `.sh` that do not | 3 | `env.sh` itself, `early.sh`, `trailer-check.sh` — **none resolves provenance** |
| `.mjs` that can trigger an extraction | **3** | `sites.mjs`, `candidates.mjs`, `checkmap.mjs` |
| of those, invoked only from pinned scripts | 2 | `sites.mjs`, `candidates.mjs` |
| of those, invoked bare | **1** | **`checkmap.mjs`** |

The other thirty-three were right. **Being right thirty-three times out of
thirty-four is not a mechanism**, which is the whole point of the fix below.

### 12.3 The fix: a guard that refuses, not a convention to remember

`harness/pins.mjs` — imported by all three resolving entry points, before the
dynamic import of the compiler that would trigger an extraction. It requires all
eight path variables to be set **and to point at `G:`**, and exits 2 naming each
one that is not, with `homedir()` printed so the reader sees where the data
would have gone.

Checking the drive, not merely that the variable is set, is deliberate: "unset"
is only one of the two ways to get there, and a pin copied from another block is
the other.

`harness/env.sh` gained the same check at source time, for the shell that sets
some pins and not others.

**Three controls, all run:**

| control | result |
| --- | --- |
| bare shell, all pins unset — *the exact invocation that did it* | **exit 2**, refuses, names all eight |
| pins set but `SCRIPTC_PROVENANCE_CACHE` pointed at `C:` | **refuses**, names that one |
| pinned shell (positive control — a guard that always refuses is useless) | **exit 0**, and reproduces §11.6's answer unchanged |

`<home>\.cache\scriptc` is absent, parent included, and nothing of
mine has recreated it.

### 12.4 Everything else of mine that could reach `C:`

`homedir()`/`USERPROFILE` across the whole compiler and CLI is **three** call
sites, and only one is a path the toolchain writes to:

| site | risk |
| --- | --- |
| `frontend/provenance.ts:312` | **the one.** Unconditional home-drive default, silent, unbounded |
| `backend/emission/emit-exprs.ts:3545,3563` | `scr_os_homedir()` / `scr_os_user_homedir()` — emitted *into the compiled program*, not a path the compiler writes |

Everything else is safe by construction or already pinned:

* `cc.ts` `cacheRootDir()` returns **null** when `SCRIPTC_CACHE_DIR` is unset —
  caching is opt-in, there is no home fallback;
* every `tmpdir()` caller (`cc.ts`, `emit-exprs.ts`, `provenance.ts`) is pinned
  by `TMP`/`TEMP`/`TMPDIR` on win32;
* zig ignores `TMP` and writes to `C:` on its own — pinned by
  `ZIG_LOCAL_CACHE_DIR`/`ZIG_GLOBAL_CACHE_DIR`;
* pnpm's store is already `G:\.pnpm-store\v11`; `npm_config_cache` is pinned;
* `vitest.config.ts` defaults `SCRIPTC_CACHE_DIR` to `node_modules/.cache`
  inside the worktree, which is on `G:`.

**So `provenance.ts:312` is the only unconditional home-drive default in the
toolchain**, and it is the one that has now fired three times this week.

### 12.5 A second trap, found while auditing — and it has already fired twice

Twelve committed `tests/perf/*/env.sh` files hardcode one block's private cache
paths. **Two of them already name a different block's cache than their own:**

    tests/perf/pkgstatus2/env.sh   ->  SCRIPTC_PROVENANCE_CACHE = <blocks>\wamfix-lab\prov
    tests/perf/voipfix/env.sh      ->  SCRIPTC_PROVENANCE_CACHE = <blocks>\pkgstatus-lab\prov

Copying one of these is the normal way to start a block, so copying one is the
normal way to inherit somebody else's cache — and a copier who edits some lines
and not others gets a mix, which is the other route to an unpinned variable.
None of the twelve points at `C:`, so none of them caused *this*; they are the
adjacent bug.

`harness/env.sh` here is now derived from a single `BLOCK` name rather than a
list of literals — `BLOCK=other . env.sh` yields `<blocks>\other-prov`, so the
one edit cannot be half-done — and it carries the guard. The other eleven are
not mine to change.

### 12.6 The product finding, offered rather than taken

`provenance.ts:312` is one line and I did **not** change it: refusing to run
would break every legitimate user who has never set the variable, and choosing
the alternative is not my call. What would have made this visible at zero cost
is a note in the same place the lane already prints its other notes —

    provenance: cache directory is <home>\.cache\scriptc\provenance
    (set SCRIPTC_PROVENANCE_CACHE to place it elsewhere)

— printed once per run when the variable is unset. The lane already prints five
or six `provenance:` notes on every build, so this costs one line and no
behaviour change. Say the word and I will write it with a test.

---

## 13. `voip`: the lane, the clusters, and one line that carries eleven sites

Measured on `block/wamcoord` at `42cf77e5` (main `83432479` plus this block's
three commits), same pins and host state as §1, `--provenance-sources`, strict,
**no `--best-effort`** anywhere.

### 13.1 The lane table, because a site count is two facts multiplied

| lane | what the driver names | stmts reached / failed | blocker sites | roots / cascade | distinct root msgs |
| --- | --- | --- | --- | --- | --- |
| **A** | `@zapo-js/voip` alone | **6 / 2** | 4 | — | — |
| **A2 — what a consumer gets** | `zapo-js` **and** `@zapo-js/voip` | **48,994 / 58** | **58** | 52 / 6 | **25** |
| **F** | the source, on zapo-js 1.8.2 | 48,988 / 59 | 59 | 53 / 6 | 29 |
| **F + authored-JS = all** | same | 48,988 / 59 | 59 | — | — |

**Lane A is not `voip`'s status. It is the island boundary**, and the six
statements are the driver's own — the give-away `pkgstatus` itself named. Its
four sites are the fallback's refusals, not the package's.

**Lane A2 is what shipping means**, and it is one site away from lane F. The two
lanes agree because they are compiling the same code by two routes.

The authored-JavaScript setting moves **nothing** here — 59 either way, to the
site. `voip`'s island dependencies (`@roamhq/wrtc`, `libmlow-wasm`, `argo-codec`)
publish no attestation, so the mapping is never reached for them. Measured, not
assumed.

### 13.2 Attestation, and why `pkgstatus`'s `UNMEASURED` row is the wrong lane

`@zapo-js/voip@1.0.0` publishes **no provenance attestation**. The compiler says
so unprompted, on lane A2, in the same run that measures 58 sites:

    provenance: @zapo-js/voip@1.0.0: no provenance attestation published; island path used

Both halves of that are true at once, and the pair is the whole point.
**The npm PACKAGE islands. The package's SOURCE is inside zapo-js's attested
tree** (`757a8071b819`, `packages/voip/src`), and the 40-key alias collision
routes `@zapo-js/voip` into it as soon as the driver names `zapo-js`. Every site
in the table below is in `packages/voip/src/...` — reached through zapo-js's
attestation, never through voip's own.

So `voip` is **not** one of the four packages that map by the ordinary
TypeScript path (§11.6): it has no attestation of its own at all. It is reached
because it is *vendored inside* something that does.

`tests/perf/pkgstatus-0907` reports `voip`'s npm lane as **UNMEASURED**, which
was the correct label for the lane it measured — and that lane is a driver that
imports the package and nothing else. **No consumer does that.** A consumer
imports `zapo-js` too, because the plugin exists to be handed to a `WaClient`,
and that consumer gets 48,994 statements and 58 blockers. The row should read
lane A2 with lane A beside it, labelled as the isolated driver's view.

This is the third instance: `media-utils` 5 → 32, `wam` 86 → 15, `voip`
UNMEASURED → 58. In all three the survey measured the way a **test driver**
imports the package, not the way a **consumer** does.

### 13.3 The clusters, before the count

58 blocker sites, 52 roots + 6 cascade, **25 distinct root messages**. By file:

```
31  packages/voip/src/relay/WaSctpRelay.ts      <- more than half, in one file
 9  packages/voip/src/call/call-state.ts
 3  packages/voip/src/relay/relay-ack.ts
 3  packages/voip/src/crypto/srtp.ts
 2  packages/voip/src/bytes.ts
 2  packages/voip/src/call/WaCallMediaSession.ts
 1  packages/voip/src/crypto/primitives.ts
 1  packages/voip/src/WaVoipCoordinator.ts
```

By cause, and the count that matters is the number of **causes**, not of sites:

| sites | cause | shape |
| --- | --- | --- |
| **11** | `closeQuietly`'s parameter type | **ONE cause — proven by substitution, §13.4** |
| **11** | `SC1090` compound assignment to fields of computed receivers | one compiler gap: `this.stats.connected++`, `conn.stats.sentBytes += n` — a two-level member path |
| **9** | `SC2020` `new Date` (7) and `Date.getTime` (2) | a **design decision**, not an oversight — §13.5 |
| 4 | `SC1090` reads off `any` (`connectionState` ×2, `getStats`, `bufferedAmount`) + 6 `SC2004` inheriting them | the untyped `peerConnection` handle |
| 2 | `SC1090` string conversion of a union with object arms | |
| 2 | `SC1090` compound array-element assignment | |
| ~11 | singletons | `bigint`, `MessageEvent`, `Function.name`, `send of ArrayBuffer`, `createCipheriv with this algorithm`, `ArrayBufferLike.byteLength`, `.buffer` outside `DataView`, `.replace()`, `createSocket` with a non-literal options argument, a function-typed value, a checked-dynamic listener |

Roots-vs-cascade would call this **52 independent problems**. It is closer to
**six causes and about eleven singletons**, and only two of the six are large.

### 13.4 The substitution: one line carries eleven sites

`WaSctpRelay.ts:22` declares

```ts
function closeQuietly(closeable: { close(): void } | null | undefined, logger: Logger): void
```

and calls it at eleven sites with four different handle types —
`conn.channel` (`RTCDataChannel`), `ch` (`null | RTCDataChannel`),
`conn.peerConnection` (`null | RTCPeerConnection`), `conn.udpSocket`
(`dgram.Socket | null`) — in three cleanup paths (424-427, 636-638, 1004-1007).

The probe replaces that **one line with one line** — the parameter widened to
name the four handle types — and nothing else. Line-neutral on purpose: the
first attempt added four lines, and the resulting identity diff was 37 "cleared"
against 27 "added" that were the *same sites shifted by four*. A count would
have called that a finding. It is not one, and it is exactly the failure mode a
substitution probe is supposed to avoid.

Line-neutral, `harness/subdiff.mjs` over `(section, code, file, line)`:

```
CLEARED by the substitution: 11
  SC2003  WaSctpRelay.ts:424 425 426 427 636 637 638 1004 1005 1006 1007
NEWLY APPEARING: 1
  SC1090  WaSctpRelay.ts:24
      '?.' on 'dgram.Socket | null | { close: () => void } | RTCDataChannel | RTCPeerConnection | undefined'
```

**All eleven, and exactly one deeper site behind them** — the optional call
`closeable?.close()` through the widened six-arm union. 59 → 49.

So `voip` does not have eleven union problems. It has **one**, and behind it
**one more**. This is the `WaWamCoordinator` shape again: a cluster that
roots-vs-cascade calls eleven roots, because `SC2003` is not the cascade marker.

The probe is a **measurement, not a fix**: widening a parameter to name four
foreign handle types is not something zapo should do, and zapo's source was not
modified — `pkgsrc/voipB` is a copy.

### 13.5 The Date cluster is a decision, and it is not cheap

Nine of the 58 are `new Date` (7) and `Date.getTime` (2). These are **not** an
oversight: `2fc8e048 fix(voip): the entry reaches a binary — a resolution row,
and Date as a handle` mapped `Date` deliberately as **a shape with no values**,
the way `request` and the WebRTC handles are, and deliberately **not** as the
f64 epoch it would fit in. That commit's own reasoning:

> a scalar answers `if (new Date(0))` false where node says true, and
> `d1 === d2` true where node says false. Every dangerous spelling still refuses
> by name.

So a record can *carry* a `Date` today; constructing and observing one refuses,
on purpose. Giving `voip` the two members it uses means giving `Date` a value
representation with node-exact `==`/truthiness/identity semantics — the precise
thing that commit declined — or special-casing `new Date()` and `getTime()` into
an epoch scalar while leaving the rest a handle, which reintroduces the
divergence at every place the two spellings meet. **I have not measured what
else moves**, and I am not going to call it cheap. It is a design question with
an owner and a written rationale, and it should go back to whoever owns `Date`.

### 13.6 `voip` does NOT demote off the LLVM tier — the recorded claim is stale

The standing note is *"no dgram program is on the LLVM tier — 16 of 20 dgram
library functions are absent from the emitter, so every UDP build silently
demotes to C."* **Refuted, by building, twice.**

| probe | surface | backend | result |
| --- | --- | --- | --- |
| `dgramprobe` | `createSocket`, `bind`, `address`, `close` | **default** | rc=0, 698,880 B, exit 0, **ORACLE MATCH byte-exact** |
| `dgramprobe2` | voip's own: `createSocket`, `bind`, `address`, `on('listening'/'message'/'error')`, `send`, `close` — a real UDP round trip | **default** | rc=0, 699,904 B, exit 0, **ORACLE MATCH byte-exact**, prints `port>0=true` / `msg=3` |

**The artifact is the evidence, not the absence of a message.** Both builds
emitted `<name>.ll` (10,390 and 15,592 bytes) and **no `.c`**, and neither log
carries a `backend c (llvm refused: ...)` line. A demoted build would have left
a `.c`.

Counting the emitters rather than trusting the note: `dgram.*` lib entries are
**32 in `backend/llvm/emitter.ts`** against **22 in `backend/emission/emit-exprs.ts`**
— the LLVM side carries *more* of the surface than the C side, which is the
opposite of the recorded claim.

What this does **not** settle: `voip` does not compile, so it has never reached
backend selection, and the two probes exercise the dgram calls `voip` makes but
not every one of the twenty. The blanket claim is dead; a per-function audit is
a separate job.

### 13.7 The build, and the number that is n/a

Consumer lane, strict, `--backend c`:

    BUILD rc=1   424s   log=34,054 B
    LOG-SITES total=58    21 SC1090 · 16 SC2020 · 11 SC2003 · 6 SC2004 · 2 SC2001 · 1 SC2012 · 1 SC2011
    compiler's own line: "58 errors."
    BINARY: none (rc=1) -- FENCE COUNT n/a, NOT 0

`analyze()` says 58 blocker sites; the build says 58 log sites; the compiler
says `58 errors.` Three instruments, one number. **`voip` does not reach a
binary**, so there is no artifact and its fence count is **n/a**.

### 13.8 Where `voip` actually stands

**Not blocked behind another block.** `@roamhq/wrtc` was closed by `2fc8e048`
(it was a resolution row, not a lowering gap) and does not appear in these 58 at
all. `libmlow-wasm` is unreached on this entry. The wall is `voip`'s own code
plus two compiler gaps, and the largest single item is now proven to be one
line.

Ranked by sites, with what each would take:

| move | clears | measured? | owner |
| --- | --- | --- | --- |
| let a nominal handle re-tag into a structural `{ close(): void }` arm, **or** narrow at the four call sites | **11**, and opens 1 | **measured** (§13.4) | compiler, or zapo |
| compound assignment through a two-level member path (`a.b.c++`, `a.b.c += n`) | **11** | not attempted | compiler |
| give `Date` the two members `voip` uses | **9** | **not** measured, and not cheap (§13.5) | whoever owns `Date` |
| a representation for the `peerConnection` handle instead of `any` | 4 + up to 6 cascade | not attempted | compiler / zapo |
| the ~11 singletons | 11 | — | mixed |

Two of those five are one compiler change each and together they are **22 of
58**. That is the shape of the next step, and it is a smaller wall than the
count suggests.

---

## 14. Taking the 22: one closed, one characterised and declined

Two compiler changes were named in §13.8 as 22 of `voip`'s 58 sites. One is
done. The other is not the change it looked like, and the measurement that says
so is 13 lines.

### 14.1 Compound assignment through a computed receiver — CLOSED, 11 sites

`voip` writes `this.stats.connected++` and `conn.stats.sentBytes += n` eleven
times. `fieldCompoundParts` refused every one:

```ts
if (!ts.isIdentifier(access.expression) && access.expression.kind !== ts.SyntaxKind.ThisKeyword) {
  L.unsupported("SC1090", access, "compound assignment to fields of computed receivers");
}
```

**The reason was never that the shape could not be emitted.** It was that the
desugar evaluates the receiver **twice** — once for the read's field target,
once when `write` re-derives it from the AST — and only an identifier or `this`
is safe to evaluate twice. The file says so itself: *"Second, independent
evaluation of the (side-effect-free) receiver."*

So the fix is not to prove receivers pure. It is to stop evaluating them twice.
A non-simple receiver is now pinned into a hidden local, **exactly the pattern
`arrayLengthCompoundParts` already uses for `%lenRecv` twenty lines above**, and
the read and the write both address that local. One evaluation, which is what
JavaScript does.

The checked-dynamic arm keeps the old restriction: its write re-lowers the
receiver through `L.lowerExpr` and has no field target to re-point.

**Is it a lowering change or a frontend predicate change?** Answered before
touching it, by building:

    c.stats.connected = c.stats.connected + 1     rc=0, runs, ORACLE MATCH byte-exact

`fieldGet` over `fieldGet` already compiles. So the change emits **no new IR
shape**, and:

* `ir/validate.ts` asserts, for `fieldGet`/`fieldSet`, that the class is
  declared, that `obj` has type `{ kind: "object", className }` and that the
  field types match. A nested `fieldGet` receiver satisfies all three — its type
  *is* the inner field's object type. **No assertion was relaxed, extended or
  touched.**
* Consumers of the two nodes: `emission/emit-exprs.ts` (`fieldGet`),
  `emission/emit-stmts.ts` (`fieldSet`), `llvm/emitter.ts` (both). Every one
  recurses into `e.obj` and addresses through a pointer — `obj->member` in C,
  `classFieldPtr` in LLVM — so a two-level path writes the real object, not a
  copy. There is no by-value receiver to lose a write into.

**Correctness, both backends, node as oracle.** The probe's load-bearing lines
count receiver evaluations:

```
a=2,5        two levels, through `this` and through a local
b=1,41
c=5          three levels
calls=1      <- r.pick(1).stats.connected++   ONE evaluation of a call receiver
d=1
e=2,4,4      value position, postfix and prefix
idx=1,f=44   <- r.conns[nextIdx()]!.stats... ONE evaluation of a side-effecting index
```

`calls=1` and `idx=1` are the whole point: under the old two-evaluation desugar
they would read **2**. Both backends produce this byte-identically to node
v25.9.0.

**Negative control**, because a probe that passes proves nothing unless it
failed before: rebuilt at base with the change reverted, the same program is
`BUILD rc=1`, **9 errors, all `SC1090 compound assignment to fields of computed
receivers`**.

**`voip` lane A2, before and after** — the lane a consumer gets, same driver,
same host:

| | before | after |
| --- | --- | --- |
| `analyze()` blocker sites | **58** | **47** |
| statements reached / failed | 48,994 / 58 | 48,994 / **47** |
| build `LOG-SITES` | 58 | **47** |
| **the compiler's own line** | `58 errors.` | **`47 errors.`** |
| `SC1090` | 21 | **10** |
| binary | none | none |
| fences over emitted bytes | **n/a, NOT 0** | **n/a, NOT 0** |

`harness/subdiff.mjs` over `(section, code, file, line)`:
**11 cleared, 0 newly appearing.** All eleven are the `SC1090` compound sites in
`WaSctpRelay.ts` at 347, 458, 664-666, 686-688, 720-722. No line-shift
reconciliation is needed — `voip`'s source was not touched; this is the attested
tree compiled twice by two compilers.

**Regression test:** `tests/corpus/7797-a-compound-assignment-through-a-computed-receiver-evaluates-it-once.ts`.
The repo's own convention (`record-width-copy.test.ts`) puts a program that
*compiles and matches node byte for byte* in `tests/corpus`, not
`tests/harness`. Verified by hand on **both** backends: rc=0, exit 0, ORACLE
MATCH byte-exact, 684,544 B (C) and 686,592 B (LLVM).

### 14.2 The union re-tag — NOT the change it looked like

The other eleven read as *"a nominal type will not flow into a structural
`{ close(): void }` arm"*. **That is false, and one probe says so.** Four
sources into the same arm:

```
q(sock)            the structural arm itself      compiles
q(new Closer())    a nominal CLASS with close()   compiles
q(iface)           a nominal INTERFACE with it    compiles
q(ch)              an RTCDataChannel HANDLE       REFUSES  SC2003
```

So nominal-to-structural already works. **Only a handle refuses**, and that is a
much narrower — and much deeper — statement.

`RTCDataChannel` is not a record. It is a primitive-like IR kind,
`{ kind: "rtcDataChannel" }`, sitting in the same list as `date`, `request`,
`response` and `classval` under the comment *"a peer connection and a data
channel are JS objects: always truthy"*. **A handle has no shape**, so there is
no field table for a structural arm to match against.

Making `q(ch)` compile therefore means one of:

* **box the handle into a record** with a `close` closure bound to it — an
  adapter, which changes identity (`c === ch` would answer false where node
  says true), the exact class of divergence the `Date` decision was made to
  avoid; or
* **give unions a handle-flavoured arm** and dispatch `.close()` on the arm tag
  rather than a record slot — a runtime representation change to every union
  carrying a structural arm.

Both are representation work with semantics attached, not a predicate widening,
and **neither is measured**. I am not doing it on this pass, and I am not
calling it cheap — it is the same shape as §13.5's `Date` fork and it belongs
with whoever owns the handle kinds.

The repro is 13 lines and fast (520 ms), kept as
`drivers/retag.ts` and `drivers/retag2.ts` so the next block starts from the
narrow statement rather than the wide one.

**The other route to those same eleven sites is one line in zapo**, and it is
already proven: §13.4's line-neutral substitution widened `closeQuietly`'s
parameter to name the four handle types and cleared all eleven, opening exactly
one site behind them. That is a zapo change, not a compiler change, and it is
available today.

### 14.3 Where `voip` stands now

**47 blocker sites** on lane A2, from 58. Still no binary, so **fence count
n/a**. What is left, by cause:

| sites | cause | state |
| --- | --- | --- |
| 11 | the handle-into-structural-arm re-tag | **characterised** (§14.2); one line in zapo, or a representation change in the compiler |
| 9 | `new Date` (7), `Date.getTime` (2) | a decision with an owner (§13.5) |
| 4 + 6 | reads off the untyped `peerConnection` handle, and the cascade behind them | not attempted |
| ~17 | singletons | mixed |

### 14.4 Suites run, and suites NOT run

`lower-exprs.ts` is the expression lowerer and sits under most of the harness,
so the scope was every `tests/harness` suite plus every `packages/*` suite:

    Test Files  93 passed | 3 skipped (96)
         Tests  1860 passed | 49 skipped (1909)
        Errors  2 errors
    failure markers in the log: 0

The 2 errors are `[vitest-worker]: Timeout calling "onTaskUpdate"` — vitest's
reporter RPC timing out under a concurrent compile, the same pair as §11.5, not
test failures.

**NOT RUN, named as unrun:** `differential.test.ts`,
`llvm-differential.test.ts`, `windows-differential.test.ts`,
`linux-differential.test.ts`, and the full `pnpm test` gate. That matters more
than usual here, because the corpus program added in §14.1 is driven by
`differential.test.ts` — so the suite that will run it is one I did not run. It
was verified by hand instead, on both backends, with node as the oracle, which
is what that suite does to it.

---

## 15. The other 36, characterised — and the two that were not compiler gaps

§14 accounted for 11 of `voip`'s 47 (the handle re-tag, declined). This section
characterises the rest. Two of the three largest causes turned out not to be
compiler work at all, which is the useful part.

### 15.1 The census, with messages and files beside the roots

| | |
| --- | --- |
| blocker sites | **47** |
| roots / cascade | 41 / 6 |
| **distinct root messages** | **24** |
| already accounted | 11 handle re-tag (declined, §14.2) + 9 `Date` (out of scope, §13.5) |
| **left to characterise** | **21 roots + 6 cascade = 27 sites over 18 distinct messages** |

18 messages for 21 roots is the shape of a long tail, not a wall. By file:
`WaSctpRelay.ts` 20, `call-state.ts` 9 (all `Date`), `relay-ack.ts` 3,
`srtp.ts` 3, `bytes.ts` 2, `WaCallMediaSession.ts` 2, and two singletons.

The largest sub-clusters in that tail were:

| sites | cause | verdict |
| --- | --- | --- |
| **10** | reads off a value of type `any` (4 roots + all 6 cascade) | **8 of them are `as any` in zapo** — §15.2 |
| **2** | compound array-element assignment through a field-chain receiver | **CLOSED** — §15.3 |
| 2 | `String()` of a union with object arms | not attempted |
| 2 | `getStats` (1 root + 1 cascade) | a real 2-site gap — §15.2 |

### 15.2 The `any` cluster is three casts in zapo, not a compiler gap

The ten-site cluster reads as *"the compiler cannot see through the
`peerConnection` handle"*. It is not that. zapo writes the `any` itself:

```ts
const connState = (pc as any).connectionState          // WaSctpRelay.ts:274
const connState = (pc as any)?.connectionState || 'unknown'   // :583
const buffered  = (conn.channel as any)?.bufferedAmount       // :586
const stats     = (pc as any).getStats?.()                    // :252
```

And **the compiler already supports three of those four members.**
`lower-wrtc.ts` carries `connectionState`, `bufferedAmount`, `readyState`,
`iceConnectionState`, `close`, `send` and two dozen more on the two handles. The control is one line away in the same file:
`pc?.iceConnectionState` at :582 carries **no cast and no site**.

**Proved by line-neutral substitution.** Three casts removed, one line for one
line, 1,026 lines before and after; baseline and probe both analysed on the
**same** compiler (`harness/qV9.sh` / `qV10.sh` — an earlier pair was discarded
because the baseline predated a lowering change and would have credited the cast
removal with two sites it did not clear):

```
CLEARED by the substitution: 8
  SC1090  WaSctpRelay.ts:274  reading 'connectionState' from a value of type 'any'
  SC1090  WaSctpRelay.ts:583  reading 'connectionState' from a value of type 'any'
  SC1090  WaSctpRelay.ts:586  reading 'bufferedAmount'  from a value of type 'any'
  SC2004  WaSctpRelay.ts:277 279 282 587 599   the five cascades behind them
NEWLY APPEARING: 0
```

**Eight sites are three `as any` casts in zapo.** Per the standing rule this is
named and stopped at: **we do not change zapo, and the deliverable is a compiler
that takes it as-is.** Recording it is what is useful — if zapo drops those three
casts, eight sites go without a compiler change.

The fourth cast is different. **`getStats` is genuinely absent** from the
compiler's WebRTC surface, so :252 and its cascade at :253 stay whatever zapo
writes. That is a real gap, and it is **2 sites**.

### 15.3 Compound array-element assignment through a field chain — CLOSED, 2 sites

`srtp.ts` writes `this.ivBuffer[4 + i] ^= this.ssrcBuffer[i]` twice.
`lowerElemCompound` refused because the receiver was not a bare identifier or
`this`.

**The same diagnosis as §14.1, one function over**, and the file states it
itself: *"JS evaluates a compound target's receiver and index exactly once, so
re-lowering them is only faithful when they are repeatable."* The function
already carries `repeatableIndexExpr` for the index half. **The receiver half
was missing**, so the receiver rule was a hard `isIdentifier || this`.

Added `repeatableRecvExpr`, written to match its sibling: an identifier, `this`,
or a chain of **plain data fields** over them. A class or record field read runs
no user code, so evaluating it twice is indistinguishable from evaluating it
once.

**The accessor link is refused, deliberately.** `o.viaGetter[i] += 1` would call
the getter twice where JS calls it once, and a getter that hands back a fresh
array each call would take the write into an object the program has already
discarded — a silent wrong answer, which is worse than a refusal. Each link is
resolved through `fieldTarget`; only the `class` and `record` containers pass,
while `accessor`, `recordAccessor` and the index-signature overflow container
keep the fence.

**The stale text was fixed too.** The diagnostic still said *"a bare identifier
receiver"* and the function's doc comment still described the old rule; both now
state the repeatability rule and why an accessor is excluded. A diagnostic that
describes a rule the compiler no longer has is the same class of defect this
block has been correcting all session.

**Correctness, both backends, node as oracle:**

```
a=225,45      this.<field>[4 + i] ^= this.<field>[i]   over typed arrays
b=3,12,3,4    identifier.<field>[index] over a numeric array
c=12          a two-link field chain
d=12          read through an ALIAS taken before the write -- the write landed
              on the object itself, not on a copy
```

**Negative control:** rebuilt at base with only this change reverted, the same
program is `BUILD rc=1`, **4 errors**, all `SC1090` array-element compound.
**Accessor control:** the getter program refuses, before and after.

### 15.4 `voip` lane A2, both lowering changes

| | §13 | after §14.1 | after §15.3 |
| --- | --- | --- | --- |
| `analyze()` blocker sites | **58** | 47 | **45** |
| statements reached / failed | 48,994 / 58 | 48,994 / 47 | 48,994 / **45** |
| roots / cascade | 52 / 6 | 41 / 6 | **39 / 6** |
| distinct root messages | 25 | 24 | **23** |
| binary | none | none | none |
| fences over emitted bytes | **n/a, NOT 0** | **n/a, NOT 0** | **n/a, NOT 0** |

`subdiff.mjs`, identity-level: **2 cleared, 0 newly appearing**, both the
`srtp.ts` array-element sites.

**The build agrees, on its own instrument.** Strict, `--backend c`: `BUILD rc=1`, `LOG-SITES total=45`, and the compiler prints **`45 errors.`** — 16 `SC2020`, 11 `SC2003`, 8 `SC1090`, 6 `SC2004`, 2 `SC2001`, 1 `SC2012`, 1 `SC2011`. `SC1090` is 21 at section 13, 10 after section 14.1, **8** now. `voip` still does not reach a binary, so its fence count remains **n/a, NOT 0**.

### 15.5 Where the remaining 45 sit

| sites | cause | who |
| --- | --- | --- |
| 11 | handle into a structural arm | **compiler**, representation work — declined, §14.2. One line in zapo is the alternative |
| 9 | `Date` | **decision with an owner**, out of scope |
| 8 | reads off `as any` | **zapo** — three casts, members already supported |
| 2 | `getStats` absent from the WebRTC surface | **compiler**, a real 2-site gap |
| 2 | `String()` of a union with object arms | compiler, not attempted |
| 13 | singletons | mixed |

**Of the 45, 19 are not compiler work** — 8 are zapo's casts, 11 are a
representation decision. That is the number worth carrying forward: the wall is
smaller than the count, and it is smaller in a way a site count cannot show.

### 15.6 Suites run, and suites NOT run

`lower-stmts.ts` is the statement lowerer, so the same scope as §14.4: every
`tests/harness` suite plus every `packages/*` suite.

    Test Files  93 passed | 3 skipped (96)
         Tests  1860 passed | 49 skipped (1909)
        Errors  3 errors
    failure markers in the log: 0

All **3** errors are `[vitest-worker]: Timeout calling "onTaskUpdate"`, verified
by grouping them — the reporter RPC timing out under four concurrent jobs, one
more than §14.4's two because the box was busier. Not failures.

Then `diagnostics.test.ts` on its own, to generate the new fixture's snapshot:
**154 tests passed, 1 snapshot written.**

**NOT RUN, named as unrun:** `differential.test.ts`,
`llvm-differential.test.ts`, `windows-differential.test.ts`,
`linux-differential.test.ts`, and the full `pnpm test` gate. Both corpus
programs added by this block are driven by the first of those, so both were
verified by hand instead, on both backends, with node as the oracle.

---

## 16. The compiler-side tail: seventeen sites, sixteen messages, and no twelfth cause

§15 left `voip` at 45. Of those, **19 are not compiler work** — 8 `any` casts
zapo writes over a surface `lower-wrtc.ts` already supports, and 11 the
representation decision declined in §14.2 — and 9 are `Date`, out of scope. What
remains that is ours is **17 sites**.

**They carry 16 distinct messages: one pair and fifteen singletons.** There is
no third eleven-in-one-line result in `voip`, and this section is the evidence
for that rather than an attempt to manufacture one.

### 16.1 The three-way split

| sites | message | class |
| --- | --- | --- |
| **2** | `String()` of a union with an **array** arm | capability — §16.2 |
| 2 | `getStats` (1 root + 1 cascade) | capability **and** zapo-side, both needed — §16.3 |
| 1 | `ArrayBufferLike.byteLength` | capability, stdlib surface |
| 1 | `createCipheriv with this algorithm` (`aes-128-ctr`, a string literal) | capability, stdlib surface |
| 1 | `.replace()` on strings | capability — **dynamic-only in the shipped surface manifest**, §16.4 |
| 1 | `MessageEvent` typed by `@types/node` | capability, types surface |
| 1 | `createSocket` with a non-literal options argument | capability |
| 1 | `Function.name` | capability |
| 1 | `send of ArrayBuffer` | capability |
| 1 | `'on'` of `call_inbound_audio` with a checked-dynamic listener | capability |
| 1 | assignment to non-variables | capability |
| 1 | `bigint` | **representation** — no value type, the `Date` shape |
| 1 | `.buffer` outside `new DataView(x.buffer)` / `Buffer.from(x.buffer)` | **representation** — *"no free-standing ArrayBuffer value exists"* |
| 1 | a function-typed value `(ep: RelayEndpoint) => "" \| Uint8Array \| undefined` | **representation** |
| 1 | values of type `any` (`relay-ack.ts:36`) | **zapo-side** — §16.5 |

**13 capability · 3 representation · 1 zapo-side.**

### 16.2 The only pair, and why it is not worth taking

`relay-ack.ts:106` and `:118` are the same expression twice:

```ts
rcNode.content instanceof Uint8Array ? bytesToBase64(rcNode.content) : String(rcNode.content)
```

**`instanceof` narrowing is not the problem** — probed, four variants:

```
String(string | Uint8Array)                  compiles
String(string | Uint8Array | undefined)      compiles
String(string | Uint8Array | { tag: string })  compiles   <- a RECORD arm is fine
String(string | Uint8Array | T[])            REFUSES SC1090
```

The rule is in `lower-exprs.ts` and it is deliberate: the per-union `sc_us_*`
ToString helper handles `undefined`, `null`, `string`, `f64`, `bool` and plain
data records, and *"Array, class and every other ref arm stay fenced."* Records
were added on purpose because they answer a **constant**
(`Object.prototype.toString`'s text).

An array arm does not. `String([a, b])` is a **recursive join** — every element
stringified in turn, each of which may itself be a record, an array or a union.
Adding it means implementing that recursion inside the per-union helper, in both
emitters. For **two sites** whose arms are `string | WaNode[]`, so the value the
recursion would faithfully produce is `"[object Object],[object Object]"`.

**Not taken.** It is a real capability gap, it is correctly classified as one,
and the ratio is wrong. Recorded so the next reader does not re-derive it.

### 16.3 `getStats` needs BOTH halves

`WaSctpRelay.ts:252` is `(pc as any).getStats?.()`, and it is the one site where
the zapo cast and the compiler gap are **both** load-bearing:

* the cast makes the read a read off `any`, so removing the compiler gap alone
  changes nothing;
* `getStats` is genuinely **absent** from `lower-wrtc.ts`'s surface (unlike
  `connectionState` and `bufferedAmount`, which are present — §15.2), so
  removing the cast alone changes nothing either.

Both, or neither. And what `getStats()` answers is an `RTCStatsReport` — another
handle — which zapo immediately walks with `(report: any) => …`, so supporting it
properly is a second representation question, not a member addition.

### 16.4 `.replace()` is a declared gap, and one probe reading needs its own look

`packages/compiler/surface-manifest.json` — the shipped artifact — is
unambiguous:

```
dynamic-only  SC2012  string.prototype.replace
dynamic-only  SC2012  string.prototype.replaceAll
```

So `jid.replace('@', ':0@')` refusing is the manifest's recorded answer, not a
surprise. Classified as a capability gap with a known status.

**That reading is now REFUTED, by mechanism — see section 17.** It is not a
missed fence: the ambient receiver read throws before the call is reached, so
no refusal is owed and none fires.

### 16.5 The last `any` is zapo's type, not a narrowing gap

`relay-ack.ts:36` iterates `child.content` after `Array.isArray(child.content)`.
The obvious suspicion is that `Array.isArray` fails to narrow. **It does not** —
probed with `string | Uint8Array | { tag: string }[] | undefined`: the guard
narrows, the `for…of` compiles, and reading `.tag` off the element compiles. The
`any` comes from zapo's own declared node type. **zapo-side**, named and stopped
at.

### 16.6 The honest conclusion

`voip`'s remaining compiler-side wall is **a long tail of 17 sites over 16
messages**, and it does not have another large shared cause. Ranked, the work
is: one 2-site item whose fix is recursive `ToString` in a union helper, one
2-site item that needs a zapo change *and* a compiler change, and thirteen
singletons — nine of them single stdlib-surface entries (`byteLength`,
`aes-128-ctr`, `MessageEvent`, `Function.name`, `send of ArrayBuffer`, a
non-literal `createSocket` options bag, a checked-dynamic listener,
`.replace()`, and one assignment form), three representation decisions of the
`Date` kind, and one zapo type.

Whether that is worth doing is a decision about how much single-entry surface
work `voip` justifies, and it is the user's, not this block's. What is settled
is the shape: **`voip` is not 45 problems, and it is not one problem. It is 19
that are not ours, 9 that are a decision already made, and a 17-site tail with
no twelfth cause in it.**

---

## 17. The false green, refuted: two lowerings, both correct

§16.4 recorded an unresolved observation — `.replace()` raising `SC2012` 3/3
over a function parameter and **not** raising it over a `declare const`
receiver. If a fence could be missed on some receiver shapes, every "0 strict
errors" this project has quoted would inherit the doubt, because a green build
would stop being evidence that the refusal cannot fire.

**It is not a miss.** The two calls take different lowerings and both are
correct. Decided by mechanism, as follows.

### 17.1 It was never an instrument disagreement

The first thing to rule out: `analyze()` and the build reporting different
things. They do not. On `drivers/repl.ts` both report **exactly one** site, and
the same one:

    analyze()   1 blocker, line 5
    BUILD       rc=1, LOG-SITES 1, "1 error.", line 5:11

Line 5 is the literal receiver. Neither instrument reports the ambient-receiver
call on line 3. So the difference is in the compiler's lowering, not in how it
was measured.

### 17.2 The mechanism, read out of the emitted C

Minimal program (`drivers/amb1.ts`), three lines, ambient receiver only:

```ts
declare const s: string
const a = s.replace('@', ':0@')
console.log('a=' + a)
```

`BUILD rc=0`, **0 sites**, a 677,888-byte binary — and a 2,219-byte translation
unit whose whole body is:

```c
ScrStr *sc_t2 = (ScrStr *)&sc_lit_0;
double  sc_t3 = (scr_undef_global_read(sc_t2), 0);
if (scr_exc_pending()) { return; }
```

**`scr_undef_global_read` is the whole answer.** A `declare const` is an ambient
binding with no runtime value, so *reading* it is an undefined-global read,
which throws a `ReferenceError`. The compiler emits that read, checks for a
pending exception, and returns. **The member call is never emitted at all** —
`grep` for a string-replace symbol in the TU answers **0**, and the TU carries
**0** `[SCxxxx]` fences. There is no `.replace()` in the program to refuse.

And Node agrees, for the same reason:

    binary:  Uncaught ReferenceError: s is not defined
    node:    ReferenceError: s is not defined

Both throw the same error class on the same line. (The texts differ in
formatting — one line against Node's stack — which is why this is not a corpus
program.)

### 17.3 It is about reachability, not about `.replace()`

The decisive control, because "dynamic-only method" and "unreadable receiver"
are confounded in the original observation. `drivers/amb2.ts` puts a **fully
supported** method on the same ambient receiver:

```ts
declare const s: string
console.log('u=' + s.toUpperCase())
```

`BUILD rc=0`, 0 sites, **0 `toUpperCase` symbols in the emitted C**, and the
identical `ReferenceError` at run time. So the silence has nothing to do with
`.replace()`'s support status: **any** member call on an unreadable receiver is
unreachable, and unreachable code owes no diagnostic.

### 17.4 One variable changed, and the fence fires

`drivers/amb3.ts` is `amb1.ts` with exactly one thing different — the receiver
is a real string instead of an ambient binding:

```ts
function f(s: string): string { return s.replace('@', ':0@') }
console.log('a=' + f('u@v'))
```

    BUILD rc=1   LOG-SITES 1   1 SC2012

**Silence and refusal turn on reachability alone.** Every real receiver tried
refuses: a parameter (3/3 in `drivers/repl2.ts`), a literal, a local.

### 17.5 The boundary, closed

The remaining risk in this area is not the fence but the lowering itself: if an
ambient binding's global genuinely existed at run time, an unconditional
undefined-global read would throw where Node succeeds.

**That program cannot be written.** `drivers/amb4.ts` tries to define the global
first and is refused before it gets there:

    SC2020: 'globalThis' is part of the standard library types but has no scriptc lowering yet

`globalThis` has no lowering, so there is no compilable way to make an ambient
binding exist at run time. The undefined-global lowering therefore cannot
diverge from Node in any program that compiles.

### 17.6 What is pinned, and what this costs

`tests/diagnostics/a-dynamic-only-call-on-a-receiver-that-cannot-be-read.ts`
carries **both** shapes in one file, and its snapshot is the assertion:

    exactly one SC2012, on the REAL receiver at line 31
    nothing at all on the ambient receiver at line 26

So a future change that starts refusing the ambient call, or stops refusing the
real one, fails that snapshot. Diagnostics suite: **155 programs, 155 passed, 1
snapshot written.**

**No compiler source was changed by this investigation**, so the suite scope is
the diagnostics suite alone, and that is what was run. No green is in doubt: the
refusal fires wherever the call is reached, and where it does not fire there is
no call.

### 17.7 The general form, worth keeping

*A refusal is owed only where the code is reached.* An expression whose receiver
provably throws first emits no call, so it carries no site — and a site census
that finds nothing there is right, not blind. The way to tell that apart from a
missed fence is to change **one** thing about the receiver and watch the site
appear, then read the emitted code for the mechanism. Two outcomes look
identical from the outside; the emitted C does not.

---

## 18. `store-redis` on current main: 39 reproduced, on BOTH lanes — PARTIAL

**Status: partial and paused.** The starting measurement is done and reproduces
the expected number. The single-cause claim is **not** verified, and the
mechanism is **not** established — two obvious candidates were tried and neither
reproduces. Nothing below rests on an unfinished run.

Measured at `e48c5e52`, which carries the spec-twin change `d2c952ca`
(`main` was `325eb515` at rebase time; it has since moved to `0c66825d`, one
commit ahead of this measurement — a ts7 baseline record, no compiler change).
`--provenance-sources`, strict, no `--best-effort`, node v25.9.0 measuring.

### 18.1 39 reproduced, and the lane difference is gone

| lane | driver names | stmts reached / failed | blocker sites | roots / cascade | distinct root msgs |
| --- | --- | --- | --- | --- | --- |
| **A** — the isolated driver | `@zapo-js/store-redis` | **46,878 / 19** | **39** | 20 / 19 | 5 |
| **A2** — consumer shape | `zapo-js` **and** the store | **46,994 / 19** | **39** | 20 / 19 | 5 |

**39 is reproduced.** The spec-twin change behaves as measured.

Two things moved, and the second is new:

1. **Reach opened by a factor of 32** — `pkgstatus-0907` recorded ~1,450
   statements on this lane; it is now **46,878**. That is the same shape as the
   spec-twin change's recorded effect on `store-mongo` (3,131 → 48,563).
2. **The lane difference collapsed.** `pkgstatus` recorded lane A at **46** and
   lane A2 at **39**, the seven-site zapo-js-core cluster being what the extra
   `zapo-js` import removed. Both lanes now read **39**, to the site. The lane
   trap that governs `wam`, `media-utils`, `voip` and `store-sqlite`
   **no longer applies to `store-redis`**: the spec-twin fix removed the reason
   it existed here. A status table that still says "46 isolated / 39 as a
   consumer" for this package is out of date.

### 18.2 The 39, clustered

Five distinct root messages, 20 roots + 19 `SC2004` cascade:

```
16  SC1090  extending classes not declared in the program ('BaseRedisStore')
 1  SC2013  importing 'ioredis' requires the embedded dynamic engine
 1  SC2013  values from the 'ioredis' package run in the embedded dynamic engine
 1  SC2011  values of type 'WaRedisStoreConfig' have no static representation
 1  SC2011  values of type 'WaRedisStoreResult' have no static representation
+19 SC2004  cascade
```

By file: the 16 are one per store class (`thread`, `signal`, `session`,
`sender-key`, …), 2 in `createRedisStore.ts`, 1 in `BaseRedisStore.ts`, 1 in the
driver.

**CORRECTION, section 19.** This section first said there was no site on
`BaseRedisStore`'s own declaration saying why it failed to be declared. **That
is wrong.** There is one, and it is the single most important site in the
package: `BaseRedisStore.ts:8`, `SC2013`, on the field `protected readonly
redis: Redis`. I read it out of the by-file summary ("1 BaseRedisStore.ts")
without opening what that 1 was -- a count quoted instead of an identity, which
is the exact error this document keeps catching elsewhere.

### 18.3 NOT established — and two hypotheses already refuted

**The single-cause claim is unverified.** "39 faces, one cause" has been right
three times today and wrong once; the substitution that would settle it — stub
the base class so it compiles, re-measure, see whether 16 + 19 collapse — has
**not been run**. Until it is, 39 is a count, not a diagnosis.

**The mechanism is not the obvious one.** `BaseRedisStore` imports `ioredis`
with `import type` — a **type-only** import, so no runtime value of the islanded
package crosses into it. Its field `protected readonly redis: Redis` is typed by
a name the checker knows and the compiler cannot lay out. The natural hypothesis
is therefore *"a class carrying a field of unrepresentable type cannot be
declared, and the island is only why the type is unrepresentable"* — which would
mean the island is not the mechanism.

**Both attempts to reproduce that without an island FAILED to reproduce it:**

| probe | base class field | result |
| --- | --- | --- |
| `drivers/baseext.ts` | `bigint` | **0 blockers** — the subclass compiles |
| `drivers/baseext2.ts` | an ambient `declare class Opaque` | **0 blockers** — two subclasses compile |

So neither "a refused scalar type" nor "an ambient class type" in a base-class
field reproduces `extending classes not declared in the program`. The simple
field-representability story is **refuted**, and the mechanism is currently
**unknown**. It is specifically not safe to write down "ioredis islands,
therefore the base class does not compile" — that is the first line of the log,
not a demonstrated cause, and the `whatwg-url` case had exactly this shape and
turned out to be a class-layout gap reproducible with a stdlib global.

### 18.4 What happens next, when work resumes

1. Substitute: stub `BaseRedisStore` so it compiles, re-measure line-neutrally,
   and see whether the 16 and the 19 clear together.
2. Find the mechanism by narrowing what *does* reproduce the message, starting
   from the two probes that do not.
3. Only then decide whether it is a compiler capability, a representation
   decision, or a zapo-side pattern.

No build of `store-redis` was attempted, so there is **no binary and no fence
count — n/a, not 0.**

---

## 19. `store-redis`: the mechanism, reproduced in three small files

§18 left 39 measured and the mechanism unknown, with two candidate explanations
already refuted. This section has the mechanism, a minimal reproduction, and the
substitution that proves it is one cause.

Measured at `41588bb7`, rebased onto `main` `0c66825d`.

### 19.1 39 still holds on current main

    drivers/_x-redis-plus-zapo.ts   46,994 statements / 19 failed
                                    39 blocker sites, 20 roots + 19 cascade,
                                    5 distinct root messages

Unchanged from §18 to the site, so the number did not move under the rebase and
there was nothing to stop for.

### 19.2 The correction: the cause has a site, and I had missed it

§18.2 said there was no site on `BaseRedisStore`'s own declaration. **Wrong.**
Listing every site touching that file, in every section, finds it immediately:

```
[blocker] SC2013  BaseRedisStore.ts:8
    values from the 'ioredis' package run in the embedded dynamic engine
```

and line 8 is

```ts
protected readonly redis: Redis
```

**The field declaration is the cause, and it carries its own diagnostic.** I
reached the wrong conclusion by reading the by-file summary — "1
BaseRedisStore.ts" — and never opening what that 1 was. A count quoted where an
identity was needed, which is the error this document keeps catching in other
people's numbers.

So the chain is not mysterious, and every link has a site:

```
ioredis publishes no attestation      -> the package islands
BaseRedisStore.ts:8  SC2013           -> the FIELD's type is an islanded type
                                      -> the class cannot be declared
16x  SC1090 extending classes not declared in the program ('BaseRedisStore')
19x  SC2004 cascade in the driver
```

### 19.3 The minimal reproduction: three files, and the variable is CROSS-MODULE

The first ladder (`drivers/redisbase.ts`) put base and subclass in the **same
file**. It reproduced **half** the chain:

```
line 13  SC2013  values from the 'ioredis' package ...   <- the field, reproduced
line 22  SC2013  the same, on an abstract class with a protected constructor
```

— and the subclasses did **not** say *extending classes not declared*. So
`abstract`, `protected constructor` and the type-only import are **not** what
produces that message.

Adding one variable — putting the subclass in a **different module** — completes
it (`drivers/rmod/base.ts`, `drivers/rmod/sub.ts`, `drivers/redismod.ts`, 26
lines total):

```
rmod/base.ts:6   SC2013  values from the 'ioredis' package run in the embedded dynamic engine
rmod/sub.ts:5    SC1090  extending classes not declared in the program ('RBase')
redismod.ts:4    SC1090  constructing through a class value whose class has no lowering
redismod.ts:5    SC1090  method calls like 's.who'
```

That is `store-redis`'s chain end to end, with no store package involved.

**The mechanism, stated:** a **type-only** import of a type from an **islanded**
package, used as a **field type**, raises `SC2013` on the field declaration and
leaves the class undeclarable; a subclass **in another module** then reports
*extending classes not declared in the program*, naming the consequence while
the cause sits one module away with its own code.

Two things this corrects:

* the earlier probes were right to fail. A `bigint` field and an ambient
  `declare class` field do not reproduce it, because neither is an *islanded
  package* type — `SC2013` is specific to that, and no amount of general
  "unrepresentable field type" reasoning reaches it;
* **here the island really is the mechanism**, unlike the `whatwg-url` case.
  That is now demonstrated rather than assumed, which was the whole point of
  being told not to assume it.

### 19.4 The substitution: one line, all four sites

`drivers/rmodB/` is `rmod/` with exactly one line different in `base.ts` — the
field's type stops being an islanded package type — and one matching type
spelling in the subclass's constructor. Line-neutral in both files, 13 → 13 and
9 → 9.

| | baseline (`redismod.ts`) | probe (`redismodB.ts`) |
| --- | --- | --- |
| blocker sites | **4** | **0** |
| statements reached / failed | 4 / 2 | **8 / 0** |

**All four clear together, and the reach doubles** because the class now
compiles. That is the single-cause claim proved on the minimal case, which is
where it can be proved cleanly.

### 19.5 What it costs, and who owns it

`ioredis@5.11.1` publishes **no provenance attestation** — confirmed
independently in §11.6's candidate scan, where it is one of the 26 NOT-ATTESTED
packages. So the shortest path is **upstream, and neither ours nor zapo's**:
if `ioredis` published provenance, its types would map and the field would lay
out.

`pkgstatus-0907` records `store-mysql` and `store-postgres` with **identical
histograms** to `store-redis` and the same `Base*Store` shape, so this mechanism
is one finding covering three packages, not one.

There is a compiler-side alternative, and it is a **representation decision**,
so it is named and not argued into scope: the field here is only ever used
through a type-only import, so a class *could* in principle be laid out with an
opaque slot for a field whose type is islanded, leaving only the **uses** of
that field to refuse. That would take `store-redis` from 39 to roughly 4 — the
two `SC2013` on `createRedisStore.ts`'s genuine **value** import of `ioredis`,
which is a different and real island, plus the two `SC2011` on the package's own
config and result types. Whether an islanded type should have an opaque runtime
slot is the same class of question as `Date` and the WebRTC handles, with the
same kind of cost attached, and it belongs to whoever owns the handle kinds.

### 19.6 What was NOT done

The `store-redis` **source-lane** substitution (`pkgsrc/storeredis` against
`pkgsrc/storeredisB`) was set up and **failed preflight on both arms**, so it
produced nothing and nothing is quoted from it. The baseline arm failed on my
driver naming store methods the package does not export; the probe arm failed
with **151 further `SC0001`s from the stub itself** — replacing `ioredis`'s
precise types with a loose `...a: unknown[]` surface breaks the package's own
typechecking. That is worth recording as a method note: **substituting a rich
third-party type with a thin stub does not isolate one variable, it changes the
program**, and the minimal reproduction above is what made the same question
answerable in 26 lines instead.

`store-redis` was not built, so there is **no binary and no fence count — n/a,
not 0.** What is in front of it is the 39 above, 35 of which are this one cause.
