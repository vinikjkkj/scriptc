# media-utils — which lane reaches the source, what the island really is, and the 27 clustered by cause

Block `mediautils`, worktree `<blocks>\mediautils`, branch `block/mediautils`
off **main `83432479`**. Nothing under `packages/` in the zapo tree was touched;
three lowering changes were made in `packages/compiler/src` and are measured
here, closed and uncovered separately.

**Supersedes one row of `tests/perf/pkgstatus-0907/README.md`** — the
`media-utils` npm-lane row — and leaves the rest of that document standing. Its
numbers reproduce here exactly (§1), so this is a correction of *labelling*,
not of measurement.

---

## 0. What a reader should take away first

1. **The npm lane DOES reach `media-utils`' source — through `zapo-js`'s
   attestation, not through media-utils' own.** `pkgstatus-0907` measured a
   driver that imports `@zapo-js/media-utils` alone and correctly recorded
   **ISLANDED — UNMEASURED** (3 statements, 5 island-boundary sites, every one
   of them in the *driver* file). Add the one import line every real consumer
   must write — media-utils' own public types come from `zapo-js/media` — and
   the same lane analyses **47,141 statements** and reports **32 blocker
   sites, all 32 inside
   `<prov>/757a8071b819…/packages/media-utils/src/`**. That is the zapo
   monorepo checkout `zapo-js@1.8.2` attests, reached through the same 41-key
   alias collision §5c of `pkgstatus-0907` documents for `store-sqlite`. §3.
2. **The island is the PACKAGE ITSELF.** No published version of
   `@zapo-js/media-utils` carries a provenance attestation — **not a
   dependency, not a subpath, not a source mapping**. So the honest status is a
   **third answer, neither "unmeasured" nor a number**:

   > **measured against zapo-js's attested tree, with the package's own
   > artifact unattested.**

   Say it in those words. The objective's *"islanded is never zero"* exists
   because this distinction keeps collapsing — into a 0, or into a 5 that is
   really the driver's. Which source got compiled is a fact the compiler
   prints; which source got *published* is a fact nobody can check today. §3.2.
3. **Neither lane reaches a binary, and the reason is the same on both: piped
   child STDIN.** media-utils pipes an input stream into `ffmpeg`'s stdin in two
   of its four entry points, and piped stdin is a deliberate, documented
   architectural refusal in the compiler, not a missing table row. Six of the
   27 sites are that one refusal. §4, §6.
4. **The 27 are 11 causes, not 25 roots — and `sharp.ts` is five sites, one
   cause, with only two of them tagged as cascade.** The roots/cascade split
   says 25 + 2; 17 distinct messages; two files. Measured cause-by-cause,
   `sharp.ts`'s **5 sites are ONE cause** and `ffmpeg.ts`'s 22 are nine.
   The proof is a **substitution experiment, not an inference**: swap `sharp`
   for a statically-typed stub of the same shape and the file goes **5 → 1**,
   with `ffmpeg.ts` unmoved at 22. This is the **second package today** where
   the roots/cascade split hid a single cause behind many apparent ones — the
   `wam` shape — which is why distinct-message counts and per-file clustering
   are now reported as standard beside roots and cascade. §4, §4.1.
5. **Three lowering changes, measured: 27 → 24 on the source lane and
   32 → 29 on the npm lane — the same four sites on both** (build,
   `analyze()` and the compiler's own `24 errors.` line all agree). **4 closed,
   1 uncovered**, never netted. The whole async child-stdio surface — which the
   corpus proves works — was unreachable for *every* program typed by real
   `@types/node`, and that is what the changes restore. §5.
6. **A green corpus is not evidence that a subsystem is reachable — the most
   transferable finding here.** The shape of
   `tests/corpus/1565-spawn-pipe-streams.ts`, compiled verbatim against
   `@types/node` 24.13.3 instead of the shipped fallback declarations, measured
   **4 refusal sites where the corpus measures 0**. A subsystem the corpus
   certifies, that no real consumer can reach, and that nothing in the corpus
   can report. This is a known hazard in this tree and now has a named,
   reproducible instance; it is written up **for corpus-coverage auditors in
   `tests/fixtures/node-types/README.md`**, not only here. §5.1.

---

## 1. Lane, flags, host state — and the reproduction of the prior numbers

| | |
| --- | --- |
| repo | `<blocks>\mediautils`, worktree of `<repo>`, branch `block/mediautils` |
| main | `83432479` |
| compiler build | `packages/compiler` then `packages/cli`, `node node_modules/typescript5/bin/tsc -p tsconfig.json` under node **v22.18.0** (`harness/build.ps1`), `BUILD-EXIT rc=0/0` |
| measuring node | **v25.9.0**, first on `PATH`, printed by every script |
| zig | **0.16.0**, the tree's (`<zapo-work>\tools\zig`) |
| tar | **GNU tar 1.35** (`C:\Program Files\Git\usr\bin`), ahead of System32 |
| `SCRIPTC_CC` / `SCRIPTC_TEST_CC` | `zigcc` / `zig cc` |
| `SCRIPTC_TARGET` | `x86_64-windows-gnu` |
| `SCRIPTC_TEST_WORKERS` | **unset** |
| flags | `--provenance-sources`, strict, **no `--best-effort`** |
| caches | `<blocks>\mediautils-{tmp,cache,npmcache,prov,zig,zig-g}` — nothing on `C:` |
| driver tree | `napp/` copied verbatim from `<blocks>\pkgstatus3-lab\napp` (read-only source), so the installed versions are the prior survey's: `zapo-js 1.8.2`, `@zapo-js/media-utils 1.0.0`, `sharp 0.33.5`, `file-type 19.6.0`, **`@types/node 24.13.3`** |

### The lanes, named on every number below

| lane | driver | what it asks |
| --- | --- | --- |
| **A** | `drivers/media-utils.ts` — imports `@zapo-js/media-utils` **only** | what the published package's own attestation reaches on its own |
| **A′** | `drivers/_x-media-plus-zapo.ts` — imports `zapo-js` **and** `@zapo-js/media-utils` | what a real consumer's program reaches. **NEW here** |
| **G** | `drivers/src-media-utils.ts` over `napp/pkgsrcN/media-utils/` | the package source, `lib: ["ES2020"]` to match media-utils' own tsconfig |
| **P** | `probes/*.ts` | one gap per file, isolated, under real `@types/node` |

### Reproduction

Before any change, on main `83432479`:

```sh
. harness/env.sh                                     # node v25.9.0, GNU tar, all caches on G:
node sites.mjs napp/drivers/media-utils.ts        sites/media-utils.json     --provenance-sources
node sites.mjs napp/pkgsrcN/src-media-utils.ts    sites/src-media-utils.json --provenance-sources
```

| lane | statements total / failed | blocker sites | prior survey (main `3f3dd523`) |
| --- | --- | --- | --- |
| A | 3 / 3 | 5 | 3 / 3, 5 — **identical** |
| G | 228 / 26 | 27 | 228 / 26, 27 — **identical** |

Two surveys, 266+ commits apart, same answer. The instrument is the same
hardened `sites.mjs`, and its BLIND guards are unchanged.

**Counter positive control.** `build1.sh` counts a build log with
`` - error SC[0-9]{4}: `` and prints the byte size of what it scanned. Run
against the prior block's recorded log — `<blocks>\pkgstatus3-lab\out\src-media-utils.build.log`,
13,688 B, whose answer that document records as 27 — the counter reads
**`LOG-SITES total=27`** and the log's own line reads `27 errors.` The counter
is live before any number of mine is trusted.

---

## 2. Lane A — what the island actually is

```
sites=5 preflightFailed=false total=3 failed=3 island=0
provenance note: @zapo-js/media-utils@1.0.0: no provenance attestation published; island path used
```

All five sites, in full, and **every one of them is in the driver file** —
`napp/drivers/media-utils.ts`, whose entire body is three statements:

| site | code | what |
| --- | --- | --- |
| `media-utils.ts:2` | `SC2013` | importing `@zapo-js/media-utils` requires the embedded dynamic engine |
| `media-utils.ts:4` | `SC2013` | values from `@zapo-js/media-utils` run in the embedded dynamic engine |
| `media-utils.ts:4` | `SC2013` | values from `zapo-js` run in the embedded dynamic engine |
| `media-utils.ts:6` | `SC2013` | values from `zapo-js` run in the embedded dynamic engine |
| `media-utils.ts:5` | `SC2004` | uses of `p` inherit the blocker on its declaration |

Zero of the package's 228 statements were read. `pkgstatus-0907`'s **UNMEASURED**
label is exactly right for this driver, and reporting the 5 as a package number
would have made media-utils look like the healthiest subject in the survey.

**What makes it an island: no provenance attestation, at any published
version.** Not an unattested *dependency* (`sharp`, `file-type` and `argo-codec`
are separately unattested and are separately noted), not a missing source
mapping (that is `@vinikjkkj/wa-wam`'s defect, and it is narrower), not a
subpath. `@zapo-js/media-utils@1.0.0` — published 2026-06-01 — simply carries no
in-toto bundle, so `--provenance-sources` has nothing to resolve and says so
unprompted.

---

## 3. Lane A′ — the lane trap, and the row it re-labels

`pkgstatus-0907` §5c established that tsconfig `paths` is **one table per
program**: a driver that names `zapo-js` makes `zapo-js`'s attested checkout win
a 41-key alias collision, and every dependent package's `zapo-js*` specifier is
answered out of it. That took `store-sqlite` from 7 blocker sites to 0.

The same experiment on media-utils, which the prior survey did not run:

```ts
// drivers/_x-media-plus-zapo.ts
import { WaClient } from 'zapo-js'
import { createMediaProcessor } from '@zapo-js/media-utils'
```

```
sites=93 preflightFailed=false total=47141 failed=31 island=0 ms=706007
BLOCKER SITES=32   (all 32 owned by @zapo-js/media-utils)
provenance: zapo-js@1.8.2 <- 757a8071b819
provenance note: @zapo-js/media-utils@1.0.0: no provenance attestation published; island path used
```

| | lane A (media-utils alone) | lane A′ (+ `zapo-js`) |
| --- | --- | --- |
| statements analysed | **3** | **47,141** |
| blocker sites | 5 | **32** |
| sites owned by the driver | 5 | **0** |
| sites owned by media-utils' source | 0 | **32** |
| analyse state | ISLANDED — UNMEASURED | **ANALYSED** |

Every site's file resolves under
`<blocks>/mediautils-prov/757a8071b819699437b353865b17cacffe95e9fb/packages/media-utils/src/`
— `refs/tags/v1.8.2`, the commit `zapo-js`'s own attestation names. The
**island note is still printed**, and it is still true: media-utils' own
attestation reached nothing. What reached the source was zapo-js's.

### 3.1 The three lanes agree about the package, once they can see it

| | lane G (source, `pkgsrcN`) | lane A′ (npm + `zapo-js`) |
| --- | --- | --- |
| `ffmpeg.ts` sites | 22 | **22 — identical, line for line** |
| `sharp.ts` sites | 5 | 9 |
| `index.ts` sites | 0 | 1 |
| total | 27 | 32 |

`ffmpeg.ts` matching line-for-line across two independently-constructed lanes is
the cross-check that the source lane is measuring the real package.
`sharp.ts` differs because the two lanes island `sharp` at different widths —
lane G stops at the destructuring, lane A′ gets past it and refuses further in
(`new Uint8Array` with 3 arguments, `ReadableStream.pipe`) — which is the same
"closing one site uncovers the next" behaviour §5.2 measures deliberately.

### 3.2 The honest status line

> `media-utils` is **measured, against zapo-js@1.8.2's attested checkout
> (`757a8071b819`), where its source lives**. Its own published artifact
> (`@zapo-js/media-utils@1.0.0`) carries **no attestation**, so nothing binds
> that tarball to the source measured. `pkgstatus-0907` §4 established by
> `diff -r -q` that `packages/media-utils/src` is byte-identical between the
> v1.8.0 and v1.8.2 checkouts, so the source is stable across the tags the other
> packages attest — but "stable across two attested tags" is not "this is what
> was published", and only a provenance-published release closes that gap.

Never "0", never "unmeasured" without that second sentence.

---

## 4. The 27, clustered — by file, by message, and by CAUSE

Lane G, main `83432479`, before any change.

**Formal split** (what a roots/cascade report says): 25 roots + 2 cascade;
**17 distinct `(code, message)` pairs**; two files.

**Per-file:** `ffmpeg.ts` **22**, `sharp.ts` **5**.

**Per-code:** `SC2020` 17, `SC2003` 3, `SC1031` 2, `SC1090` 2, `SC2004` 2, `SC2013` 1.

**Per CAUSE — eleven, measured:**

| sites | lines (`ffmpeg.ts` unless noted) | cause | evidence | whose |
| --- | --- | --- | --- | --- |
| **5** | `sharp.ts` 1, 22, 28, 38, 43 | `sharp@0.33.5` publishes no attestation → island → the pipeline value is dyn → destructuring refuses → uses of `data` cascade | **stub arm: 5 → 1** (§4.1) | upstream + a native addon |
| **6** | 227, 306, 307, 369, 386, 387 | **piped child STDIN** — `spawn`'s stdin slot and `ChildProcess.stdin` | the compiler's own `pipeFence`; a documented refusal, not a gap | compiler, **large** |
| **3** | 289, 394, 405 | `child.on("close")` ×2 and `stream.on("close")` ×1 | probe `p-annot-close`: both fence on an already-mapped receiver; only `exit`/`error` and `data`/`end` are lowered | compiler, small–medium |
| **3** | 237, 374, 410 | child stdio read through `!` or a plain binding (`?.` works) | probe matrix: `?.` 0 sites, `!` 1, `const x =` 1 | compiler, **closed** (§5) |
| **2** | 183, 187 | `ChildProcessByStdio<…>` is not mapped to the `child` kind | annotating the receiver `ChildProcess` removes both; same source under the fallback decls: 0 | compiler, **closed** (§5) |
| **2** | 383, 391 | `ReadableStream.destroy` on child stdio | — | compiler, medium |
| **2** | 30, 96 | `child_process.execFile` callback form | the compiler's own hint says: promisify it | compiler, medium |
| **1** | 180 | `spawn option 'timeout'` | `stdio`, `detached`, `env`, `cwd`, `windowsHide` are the supported options | compiler, small |
| **1** | 25 | `Readable.from` over a `(Uint8Array \| string)[]` source | — | compiler |
| **1** | 24 | `instanceof` on a union-typed value (`input instanceof Readable`) | — | compiler |
| **1** | 135 | `writeFile(path, Uint8Array)` — `fsp.writeFile` is `[STRING, STRING]` | — | compiler, small |

17 distinct messages, **11 causes**, and the two files do not interact: the
sharp-stub arm leaves `ffmpeg.ts` at exactly 22.

### 4.1 The sharp cluster is ONE cause — proved, not asserted

`sharp.ts` imports `sharp` and destructures the result of its pipeline. With
`sharp` islanded, `createPipeline`'s value is dyn-typed, `const { data, info } =
…` refuses (`SC1031`), and each use of `data` inherits it (`SC2004`).

The arm (`probes/sharp-stub.ts`): a local module with the **same shape and the
same static types** — `sharp(input) → Sharp`, `rotate/resize/jpeg/png`, `toBuffer({resolveWithObject:true}) → Promise<{data, info}>`,
`Sharp extends Writable` so the `.pipe` target still typechecks — and one
import line repointed. Nothing else changes.

| | baseline | with the stub |
| --- | --- | --- |
| `sharp.ts` sites | **5** | **1** |
| `ffmpeg.ts` sites | 22 | **22** |
| statements analysed | 228 | 239 |

**Closed 5, uncovered 1** — the uncovered one is `sharp.ts:13`,
`'ReadableStream.pipe' is typed by @types/node but has no scriptc lowering yet`,
a site the island had hidden.

Only **2** of those 5 carry the `SC2004` cascade code. A roots/cascade split
reports this cluster as **3 roots + 2 cascade** and hides four fifths of it.
That is the `wam` shape (`pkgstatus-0907` §6a: 69 of 82 "roots", one cause) in a
second package, found the same way — by compiling the same source two ways.

---

## 5. What was changed, and what it measured

Three changes in `packages/compiler/src`. All three are in the same subsystem —
the async child-process surface as **real `@types/node`** types it.

### 5.1 The finding that motivated all three

`tests/corpus/1565-spawn-pipe-streams.ts` compiles, runs, and matches Node. It
uses `spawn(cmd, args, { stdio: ["ignore","pipe","pipe"] })` and
`child.stdout?.on("data" | "end", …)`. The corpus compiles against the **shipped
fallback declarations**, where `spawn` returns a plain `ChildProcess` and its
`stdout` is `NodeJS.ReadableStream`.

The same shape, byte for byte, in `napp/probes/` — that is, against
**`@types/node` 24.13.3**, which is what every published package compiles
against:

```
probes/p-childstream-optchain.ts   sites=4
  L7   SC2020  'ChildProcessByStdio<null, Readable, Readable>' … has no scriptc lowering yet
  L9   SC2020  'ChildProcessByStdio<null, Readable, Readable>.stdout' …
  L10  SC2020  'ChildProcessByStdio<null, Readable, Readable>.stdout' …
  L11  SC2020  'ChildProcessByStdio<null, Readable, Readable>.on' …

tests/corpus/1565-spawn-pipe-streams.ts (fallback decls)   sites=0, 73 statements
```

**0 under the fallback, 4 under `@types/node`.** A working, corpus-verified
subsystem was unreachable for every real consumer, and the corpus could not see
it because the corpus is not on that lane. This is the recorded
"fallback `.d.ts` hides failures" hazard, in its most expensive form so far.

### 5.2 The changes

1. **`frontend/types.ts` — `ChildProcessByStdio` maps to the `child` kind.**
   `spawn` with a tuple `stdio` selects an overload whose return type is
   `ChildProcessByStdio<I, O, E>`, an interface that `extends ChildProcess` and
   only *narrows* `stdin`/`stdout`/`stderr`/`stdio`. There is no second runtime
   object. `mapType` matched the name `ChildProcess` only.
2. **`frontend/lowering/lower-builtins.ts` — `child.stdout`/`child.stderr` mint
   the null arm only when the checker keeps one.** The read minted
   `childStream | null` unconditionally. Under the tuple overload the checker
   *pins* the slot non-null, and the spurious null arm sent every read into the
   `%Readable` class spoke as `Readable | null`, where it re-tag-fenced
   (`SC2003`) — on all three read forms.
3. **`frontend/lowering/lower-exprs.ts` — `x!` on a nullable-of-one narrows to
   that arm when the checker's target is not an IR arm.** `mapTypeOf(typeOf(x!))`
   for `child.stdout!` is the `%Readable` **class**, which is not an arm of
   `childStream | null`, so `narrowedArmHelper` found nothing and the union fell
   through unnarrowed. The fallback uses the **same checked helper**, so a lying
   `!` still throws the catchable `TypeError`; only the arm *lookup* changed.
   It runs strictly where the existing code had already given up.

### 5.3 Probe matrix, before and after (all under `@types/node` 24.13.3)

| probe | what it isolates | before | after |
| --- | --- | --- | --- |
| `p-child-bystdio` | tuple-stdio child: `.stdout`, `.on` | 3 | **0** |
| `p-bystdio-forms` | the three read forms (`?.`, plain, `!`) on a tuple-stdio child | 3 | **0** |
| `p-childstream-guard` | annotated `ChildProcess`, guard-narrowed read | 2 | **0** |
| `p-childstream-bang` | annotated `ChildProcess`, `!` read | 1 | **0** |
| `p-annot-optchain2` | annotated `ChildProcess`, `?.` read (control — already worked) | 0 | **0** |
| `p-nonnull-plain` | `!` on `string \| null` (control for change 3) | 0 | **0** |
| `p-annot-close` | `child.on("close")`, `stream.on("close")` | 2 | 2 — untouched, and correctly so |

### 5.4 The measured effect on media-utils — closed and uncovered, never netted

Lane G, `--provenance-sources`, no `--best-effort`:

```
BEFORE   sites=27  total=228  failed=26
AFTER    sites=24  total=228  failed=23
```

**Closed — 4:**

| site | code | what |
| --- | --- | --- |
| `ffmpeg.ts:183` | `SC2020` | `ChildProcessByStdio<null, Readable, null>.stdout` |
| `ffmpeg.ts:187` | `SC2020` | `ChildProcessByStdio<null, Readable, null>.on` |
| `ffmpeg.ts:237` | `SC2003` | `expected 'Readable', got 'Readable \| null'` |
| `ffmpeg.ts:374` | `SC2003` | `expected 'Readable', got 'Readable \| null'` |

**Uncovered — 1:**

| site | code | what |
| --- | --- | --- |
| `ffmpeg.ts:183` | `SC2003` | `expected 'Uint8Array \| Readable \| string', got 'Readable'` — the child stream, now narrowed, is handed to `generateImageThumbnail`, whose parameter is `WaMediaProcessorInput` |

`ffmpeg.ts:410` stays fenced and its message *changes* from
`got 'Readable | null'` to `got 'Readable'`: the narrowing landed, the
conversion is what is missing.

**The npm lane moves by exactly the same four sites.** Lane A' re-run with the
changes: **32 -> 29**, the same four closed, the same one uncovered, statements
unchanged at 47,141 (failed 31 -> 28). Two independently-constructed lanes,
one delta:

| | lane G (source) | lane A' (npm + `zapo-js`) |
| --- | --- | --- |
| before | 27 | 32 |
| after | **24** | **29** |
| closed | 4 | 4 — the same four |
| uncovered | 1 | 1 — the same one |

**The 24, clustered the same way as the 27** (roots and cascade, and beside
them the two numbers a roots/cascade split cannot give you):

| | before | after |
| --- | --- | --- |
| blocker sites | 27 | **24** |
| roots / cascade `SC2004` | 25 / 2 | **22 / 2** |
| **distinct `(code, message)`** | 17 | **15** |
| **per file** | `ffmpeg.ts` 22, `sharp.ts` 5 | **`ffmpeg.ts` 19, `sharp.ts` 5** |
| per code | `SC2020` 17, `SC2003` 3, `SC1031` 2, `SC1090` 2, `SC2004` 2, `SC2013` 1 | `SC2020` 15, `SC2003` 2, `SC1031` 2, `SC1090` 2, `SC2004` 2, `SC2013` 1 |
| statements total / failed | 228 / 26 | 228 / **23** |
| runtime fences / advisories / unreached | 0 / 0 / 0 | 0 / 0 / 0 |

**Cross-check, three instruments:**

```
harness/build1.sh pkgsrcN/src-media-utils.ts src-media-utils --provenance-sources
  BUILD rc=1  39s  log=12058B
  LOG-SITES total=24         (pattern [ - error SCxxxx: ] over 12058 bytes)
     15 SC2020  2 SC2004  2 SC2003  2 SC1090  2 SC1031  1 SC2013
  compiler's own totals line: 24 errors.
  BINARY: none (rc=1) -- FENCE COUNT n/a, NOT 0
```

`analyze()` 24 = build log 24 = the compiler's own `24 errors.` No binary, so
the fence count is **n/a, not 0**.

### 5.5 The regression test, on the lane that could see it

The corpus cannot pin this: it compiles against the shipped fallback
declarations, so a corpus program is on the wrong lane by construction. The
precedent is `tests/harness/stream-node-types.test.ts`, whose opening comment
describes *the same bug shape one level up* — the node:stream classes were
reachable only through the fallback, and `Readable` in particular was "claimed
by the child-stdio mapping instead".

Added, as its sibling:

* `tests/fixtures/node-types/child-stdio.ts` — the tuple-stdio spawn, read
  through **all three forms** (plain member, `!`, `?.`), each waiting for both
  `end` and `exit` before printing, with `node -e` as the child so it is
  platform-neutral (the `tests/corpus/1657` pattern).
* `tests/harness/child-stdio-node-types.test.ts` — compiles it under the
  vendored, pinned `@types/node` and compares stdout against Node.

`analyze()` on that fixture with the changes: **`sites=0`, 55 statements, 0
failed.** Its before-number is not taken by reverting mid-run; it is the probe
matrix in §5.3, which is the same three read forms in isolation and measured
3 + 1 + 2 sites before and 0 after.

---

## 6. The wall, and what it would take

**media-utils cannot reach a binary, and the blocker is not the count.** Two of
its four entry points (`computeWaveformWithFfmpeg`, `normalizeVoiceNoteWithFfmpeg`)
pipe a caller's `Readable` into ffmpeg's **stdin**:

```ts
proc.stdin!.on('error', () => stream.destroy())
stream.pipe(proc.stdin!)
```

Piped child stdin has no lowering, deliberately. `lowerSpawnCall`'s `pipeFence`
refuses `stdio[0] === "pipe"` outright, and the module's own fence hint states
the position: *"piped stdin is fenced as well, so stdio carries the child's
output only"*. That is a **subsystem** — a writable child-stdin stream with
backpressure and a close/EPIPE protocol — not a table row, and it is where a
near-miss is a silent wrong answer (a lost tail of input) rather than a failure.
**Six of the 27 are that one refusal, and no smaller fix removes them.**

Ranked by sites cleared, from the measurements above and nothing else:

| move | clears | measured, or inferred? | who |
| --- | --- | --- | --- |
| **publish `@zapo-js/media-utils` with provenance** | nothing by itself — but it is what makes the measurement *about the published artifact* instead of about zapo-js's tree | measured, in the negative (§2, §3) | zapo release |
| **piped child stdin** (a writable child-stdin stream + backpressure) | **6**, and it is the load-bearing six | measured: they are the sites, and the code that refuses them is explicit about why | compiler, **large** |
| **`sharp` reachable statically** | **5** (uncovers 1) | **measured**: the stub arm, 5 → 1 | upstream — and `sharp` is a native addon, so an attestation alone may not be enough |
| `childStream` → `%Readable` conversion | **2** (`ffmpeg.ts:183`, `:410`) plus whatever it uncovers | measured: both remaining `SC2003` are that one mismatch | compiler, **medium–large** — **specified below and DECLINED** |
| `child.on("close")` + `stream.on("close")` | **3** | measured: `p-annot-close`, on an already-mapped receiver | compiler, small–medium |
| `ReadableStream.destroy` on child stdio | 2 | — | compiler, medium |
| `execFile` callback form (or promisify it upstream) | 2 | the compiler's own hint names the lowered shape | compiler / zapo source |
| `spawn option 'timeout'` | 1 | — | compiler, small |
| `Readable.from` over a `(Uint8Array \| string)[]` | 1 | — | compiler |
| `instanceof` on a union-typed value | 1 | — | compiler |
| `fsp.writeFile(path, Uint8Array)` | 1 | — | compiler, small |

Clearing everything on that list except the first two still leaves the six
stdin sites and no binary. **The wall is piped child stdin, and it is ours to
build or to decline; the island is a release, and it is not ours at all.**

### 6.1 The `childStream` → `%Readable` bridge: specified, and not built

The two remaining `SC2003` are one cause, and it is a **representation**
question, not a table row:

* `childStream` emits as **`ScrChildStream *`**, with its own retain family
  (`scr_child_stream_retain`), minted only by the producing syntax
  `child.stdout` / `child.stderr`.
* `%Readable` is an ordinary runtime **class** (`kind: "object"`), the one
  `@types/node` names for both, and the one every `Readable`-typed slot in a
  consumer's signatures expects.

Under `@types/node` the checker calls both of them `Readable`, so any flow that
carries a child's stdout **into** a `Readable`-typed slot has no conversion to
make. In media-utils that is exactly two flows:

| site | flow |
| --- | --- |
| `ffmpeg.ts:183` | `generateImageThumbnail(proc.stdout, maxEdge)` — the parameter is `WaMediaProcessorInput = Uint8Array \| Readable \| string` |
| `ffmpeg.ts:410` | `return proc.stdout!` — the return type is `Promise<Readable \| null>` |

**What it would take:** either a real conversion (an owned `%Readable` wrapping
the `ScrChildStream` handle, with one refcount story across both families and
one answer for `destroy`/`destroyed`/`pipe` on the wrapper), or collapsing the
two kinds so a child's stdio simply *is* a `%Readable`. Both are medium-to-large
and both touch a refcount boundary, which is where a near-miss is a leak or a
double-free rather than a diagnostic.

**Decision: specify it and stop.** It closes **2** sites and leaves the package
short of a binary anyway, because the **six stdin sites** are untouched by it.
It buys a smaller number, not the objective. The whole shape — the stdin
subsystem and this bridge together — is the thing to decide on; a piece of it
is not.

---

## 7. Gates

Judged by counting lines and failure markers, never by an exit code.

| gate | command | verdict |
| --- | --- | --- |
| ts7, first run | `vitest run packages/compiler/test/ts7` | **1 failed / 90 passed (7 files)** — and the failure is not a behavior regression: `order-parity.test.ts`'s baseline accounting reported `2111 corpus entries vs 2110 recorded`, naming the one new fixture and tagging it `UNCOMMITTED`, i.e. *"record it in the same commit"* |
| ts7 baseline, recorded | `SCRIPTC_UPDATE_BASELINES=1 vitest run …/order-parity.test.ts` | `UPDATE-EXIT=0`, baseline **387,554 → 387,703 B** |
| ts7 baseline, additivity | `harness/gate-ts7-update.sh` + the flatten/compare step | **ADDED=2, CHANGED=0, REMOVED=0** over 4,220 → 4,222 entries; the two added are `.../child-stdio.ts/order` and `.../child-stdio.ts/diags`. Both files parse as JSON |
| ts7, re-verify | `vitest run …/order-parity.test.ts` (no update flag) | **38 passed, `VERIFY-EXIT=0`** |
| corpus differential, shard 1/20 | `SCRIPTC_TEST_SHARD=1/20 vitest run tests/harness/differential.test.ts` | **79 programs, 79 passed**, 253.59s |
| corpus differential, full | `harness/gate-corpus-full.sh` | **1,863 passed / 0 failed**, 2067.75s. Counted from the log rather than the exit code: over **162,355 bytes**, `PASS-MARKERS=1834`, `FAIL-MARKERS=0`, `Failed Tests` blocks **0**, `AssertionError` lines **0** |

> **1,834 printed pass lines against 1,863 tests** is a reporter artifact, not 29
> missing outcomes: vitest does not print a line for every test at this
> verbosity. The outcome numbers are the totals line (1,863 passed, 0 failed)
> and the three failure counters, all zero. Both numbers are given here so the
> gap is visible rather than quietly reconciled.
| attribution trailers | `harness/trailer-check.sh`, run as **its own step**, never chained | control arm (`ctl-trailered.txt`) reports **2** trailer lines; both commit messages report **0** |

**Blast radius, by RUNNING the corpus.** Change 3 is the one with reach beyond
child stdio: `x!` on a nullable-of-one now narrows through a checked helper
where it previously fell through, which changes CODE GENERATION, not just a
diagnostic. Grepping emitted C would read zero by construction for that. Every
corpus program was compiled and its native stdout/stderr/exit compared against
Node: **0 divergences**.

The baseline update is additive **by construction** —
`SCRIPTC_UPDATE_BASELINES=1` cannot overwrite a live divergence — but that is a
property of the tool, so the additivity is *also* checked independently, by
flattening both JSON documents and comparing every pre-existing key byte for
byte. `CHANGED=0` is the number that matters and it is measured, not assumed.

---

## 8. Reproducing

```sh
# 1. env — every step sources it; node v25.9.0, GNU tar, all caches on G:
. harness/env.sh

# 2. the compiler, node v22 (NOT pnpm)
pwsh -File harness/build.ps1          # BUILD-EXIT rc=0/0

# 3. the driver tree: napp/ copied from a prior lab, versions unchanged
#    (harness/install.ps1 is the pnpm-install + tsc path for the worktree itself)

# 4. the lanes
node sites.mjs napp/drivers/media-utils.ts         sites/media-utils.json      --provenance-sources
node sites.mjs napp/pkgsrcN/src-media-utils.ts     sites/src-media-utils.json  --provenance-sources
bash harness/ab-media.sh    # lane A' -- the +zapo-js arm, ~12 min
bash harness/build1.sh pkgsrcN/src-media-utils.ts src-media-utils --provenance-sources

# 5. the probes (seconds each)
for p in probes/*.ts; do node sites.mjs "napp/probes/$(basename $p)" "sites/$(basename $p .ts).json"; done

# 6. blast radius: RUN the corpus
bash harness/gate-corpus.sh 1/20
```

### Files

| path | what |
| --- | --- |
| `drivers/` | the three drivers: lane A, lane A′, lane G |
| `probes/` | one isolated gap per file, plus `sharp-stub.ts` (the §4.1 arm) and the tsconfig that puts them on real `@types/node` |
| `sites/` | raw `analyze()` records: lane A, lane G before and after, lane A′, the sharp-stub arm |
| `logs/*.txt` | the evidence logs. `*.log` is gitignored repo-wide and no `tests/perf` tree tracks one, so these carry the `.txt` extension the prior surveys use: `src-media-utils.build.txt` (the lane-G build, `24 errors.`, 12,058 B), `ab-media.txt` / `ab-media2.txt` (lane A′ before and after), `gate-corpus-1-20.txt`, `gate-corpus-full-excerpt.txt` (head, first/last pass lines, totals and the counted markers, verbatim), `gate-ts7-excerpt.txt` (including the baseline-accounting failure block), `gate-ts7-update.txt` |
| `harness/` | env, build, the hardened `sites.mjs`, `build1.sh`, and the corpus gate |
