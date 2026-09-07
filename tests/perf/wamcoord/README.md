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
