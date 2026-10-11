# The census that makes the 64 KiB-alignment saving REAL — pre-registered

> ## LANE BANNER — the plan names `G:\scriptc` as the build tree, and that
> ## selected the other coroutine lane
>
> **The run this plan designed came out on the FIBER lane while its baseline
> is STACKLESS.** The plan nowhere names a coroutine lane and nowhere sets
> `SCRIPTC_STACKLESS` — and that is the defect, not an omission to forgive.
> Since `8f4100d7a` (2026-10-09 19:46 −0300) the shipping default is
> stackless, but `G:\scriptc`'s `dist/` predated the lane and could not read
> the knob, so "no knob" delivered fiber. Proof by artifact and the full
> record are in `evidence-postfix/LANE.txt` and in the lane banner at the top
> of `POSTFIX-CENSUS.md`.
>
> **WHAT THIS MARKS IN THIS FILE.** Section 4's negative arm, the bullet
> *"**run it against `G:\scriptc` as well**, where it must read
> `_aligned_malloc` **>= 1** and the chunk `scr_prof_malloc` **0**"* —
> already void for a different reason recorded in `POSTFIX-CENSUS.md`
> section 1, *"A correction to the plan's C1, and it matters"*, and void a
> second time here, because `G:\scriptc` was not merely an unrepaired tree,
> it was a tree on a different lane. **Everything the plan registers about the string arena
> itself is untouched**: the chunk size, the 65,536 row, the P5 assertions
> and the ±16-per-chunk residue are all lane-independent.
>
> **Sections this banner does not name are NOT thereby in force; they are
> UNAUDITED.**

> **What this is.** `OWNER-131079.md` §5 predicts that dropping the chunk
> alignment releases **3,014,768 B = 15.94% of the instrumented CRT busy
> heap**, and both it and `DECOMP-ON.md` say in terms that the figure is
> **carved from committed evidence, not measured on a post-change binary**.
> The repair is on `strarena/drop-64k-alignment` (`41ce4373c`) and gating as
> `land/strarena` (`38f481cda`). **Green there proves it did not break; it
> proves nothing about the saving.** This file is the measurement, written
> and scored *before* the run exists, so that when the gate closes there is
> no discovery phase: one build, one run, one script.
>
> **Nothing here was built or run.** The checker beside this file,
> `postfix-check.sh`, was exercised five ways against committed text only.

## 0. The headline, decided: ONE run, not an A/B

The brief that ordered this plan asked whether an A/B of two binaries is the
right instrument, and marked that half as the most likely to be wrong. **It
is wrong, and the committed evidence says so in three independent ways.**

1. **The effect is a row that dies, not a delta.** `HCSIZE 131079` is a
   *request size*; `scr_heap_census.h:315,317` keys the table on `cbData`,
   which `OWNER-131079.md` §6 proves is the request to the byte. After the
   fix no call site in the tree can produce a 131,079-byte request — the
   only two were `scr_string.c:753` and `:763`, confirmed by `rg` over
   `packages/runtime/src` returning those two lines and nothing else. **A
   row at 131,079 is present or absent. There is no middle value to average
   over, and nothing to pair against.**
2. **The baseline is already committed, and it is triplicated.** Three arms
   at `CONVS=400` — `evidence-idle/off.heapcen.txt:223`,
   `on.heapcen.txt:221`, `long.heapcen.txt:223` — each read **46 blocks**,
   and `:269`, `:266`, `:268` each read **`HCSIZE 65536 118`**. Those two
   counts are invariant across the SQLite idle knob, which moves a
   12.9 MB row (`HCSIZE 4376 2792 12906128`, present in `off`/`long`, absent
   in `on`/`half-on`) and 13.0 MB of busy total. **The rows this measurement
   asserts on did not move at all.**
3. **The same-revision denominator is recoverable by arithmetic.** The whole
   diff is `git diff --stat main...strarena/drop-64k-alignment`: **one source
   file**, `scr_string.c`, plus two markdown files. The code change is two
   one-line function bodies and a `_Static_assert`. So the pre-fix busy total
   *for the tree being measured* is the post-fix total plus the row delta —
   there is no second program to run to obtain it.

**Therefore: one build of the repaired tree, one `CONVS=400` run, scored by
`postfix-check.sh`. No pairing, no A/A, no machine quietness requirement** —
every assertion is a count or an exact byte identity, and the counts were
stable across three arms that differed by 13 MB of heap.

### Where the brief's other half was right, and where it was off

The brief predicted *"a line at `HCSIZE 65536+hdr` appears with the right
count"*. **There is no `hdr`, and no new line appears.** `scr_prof.h:989`
passes `n` straight to the real `malloc` with no bookkeeping byte, so the key
is exactly `65536` — and `HCSIZE 65536` **already exists with 118 blocks**,
attributed by `DECOMP-ON.md` §1 (A1) as the cycle-collector arena. The
chunks **merge into a row that is already occupied**. `OWNER-131079.md` §5
condition 1 wrote this down ("After the change it would read 164 blocks")
and it is the reason P2 below is a count assertion on a shared row rather
than the appearance of a fresh one.

## 1. How the baseline was armed — the exact command

Source: the manifests, not the prose. All four arms of `evidence-idle` ran
**one binary**, `G:\blocks\h2-out182-prof\zapo-rest-182.exe`, 33,360,896 B,
built at `21facf366` (`OWNER-131079.md` §1 names the arm and the commit).

```sh
# BUILD - WHICH-BUFFER.md section 6, 11.2 min
SCRIPTC_PROF_CFLAGS="-include tests/perf/prof/scr_prof.h \
  -DSCR_PROF_ALLOC -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS \
  -DSCR_PROF_STACK_SIZE_MIN=1296 -DSCR_PROF_STACK_SIZE_MAX=1352 \
  -DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376 \
  -include tests/perf/heapcensus/scr_heap_census.h" \
node packages/cli/dist/main.js build tests/perf/zapo-rest/app182/zapo-rest.ts \
  -o <out>/zapo-rest-182.exe --provenance-sources --keep-c
```

```sh
# ENVIRONMENT - G:\blocks\h2-rig.sh, verbatim
TMP=TEMP=TMPDIR='G:\blocks\h2-tmp'        SCRIPTC_PROVENANCE_CACHE='G:\blocks\h2-prov'
SCRIPTC_TARGET=x86_64-windows-gnu          SCRIPTC_CC=zigcc
SCRIPTC_TEST_CC='zig cc'                   USERPROFILE='C:\Users\vinicius'
PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"   # zig 0.16.0; GNU tar BEFORE System32
ZAPO_FAKE_SERVER=/g/blocks/m3-zaposrc/packages/fake-server
MEMRIG_PMON=<wt>/tests/perf/zapo-rest/harness/pmon.exe   MEMRIG_OUT=/g/blocks/h2-run
```

```sh
# RUN - 2m25s..2m29s wall per arm, per the manifests' started/ended
node --import <tsx loader> tests/perf/zapo-rest/harness/memrig.mts \
  <exe> <tag> CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60 \
  SETTLE_MS=45000 PRESYNC_MS=20000 [arm knobs]
```

`memrig.mts:266-267` wires `SCR_PROF_OUT` and `SCR_HEAPCEN_OUT` into
`$MEMRIG_OUT/<tag>.{prof,heapcen}.txt` itself; the arm script sets neither.
`SETTLE_MS`/`PRESYNC_MS` in the manifests are `memrig.mts:108`'s **defaults**
restated, not overrides.

| arm | extra knobs | manifest |
|---|---|---|
| `long` | `SCR_SQLITE_IDLE_RELEASE_MS=600000 SCR_SQLITE_IDLE_STAT=1` | `long.manifest.txt` |
| `off` | *(none)* | `off.manifest.txt` |
| **`on`** | **`SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1`** | `on.manifest.txt` |
| `half-on` | the same `+ CONVS=200` | `half-on.manifest.txt` |

## 2. The arm to reproduce — and why today's knob flip did NOT void it

**The arm is `on`.** Its busy heap, `on.heapcen.txt:3`, is **18,907,440 B** —
the denominator every share figure in `OWNER-131079.md` and `DECOMP-ON.md`
names.

The brief's worry was that `SCR_SQLITE_IDLE_RELEASE_MS` moving from 0 to 1000
today destroys that denominator. **It does the opposite.** The default is at
`packages/runtime/src/scr_async.c:2575`:

```c
#ifndef SCR_SQLITE_IDLE_RELEASE_MS
#define SCR_SQLITE_IDLE_RELEASE_MS 1000
```

and the `on` arm ran with `SCR_SQLITE_IDLE_RELEASE_MS=1000` explicitly. **The
`on` arm *is* the shipping arm; it was the treatment arm yesterday and it is
the default today.** The arms that are now stale are `off` and `long`, whose
31.9 MB busy totals describe a configuration that no longer ships.

The knob is still set **explicitly** in the plan below. A default can move
again, and an arm pinned by a default is an arm that re-defines itself
silently. `SCR_SQLITE_IDLE_STAT=1` is set too: `on` had it, `off` did not,
and it opens a report file whose stdio buffer is a CRT heap block.

### The revision drift between the baseline binary and the repaired tree

Measured, not assumed. Between `21facf366` (the baseline exe) and
`b22985aa2` (the repair's base):

* **26 commits**, of which **0** touch `packages/compiler` or `packages/cli`
  — the emitted C for app182 is produced by the identical compiler, and both
  trees' `packages/cli/dist/main.js` are 18,610 B;
* **exactly one** runtime source file differs: `scr_async.c`, in 3 commits,
  and `git diff 21facf366 b22985aa2 -- packages/runtime/src/scr_async.c`
  filtered for `malloc|calloc|realloc|free` call lines returns **nothing** —
  the drift adds and removes **no allocation site**;
* that one file's drift *is* the SQLite idle default, i.e. §2's point.

So the drift is named, bounded, and allocation-neutral. It is still a
confound for the **grand total** (P4 below, informational), and it is **not**
a confound for P1, P2, P5 or P7, which is why those carry the verdict.

## 3. The prediction, registered here BEFORE the run

Arm `sa`: the `on` arm's knobs exactly. `CHUNKS=8 CONVS=400 MSGS=6
TEXTLEN=300 ROUNDS=1 IDLE_S=60 SETTLE_MS=45000 PRESYNC_MS=20000
SCR_SQLITE_IDLE_RELEASE_MS=1000 SCR_SQLITE_IDLE_STAT=1`, `SCR_STRING_ARENA`
**unset**.

| id | assertion | from |
|---|---|---|
| **P1** | `HCSIZE 131079` **absent** | the only two producers were `scr_string.c:753`/`:763` |
| **P2a** | `HCSIZE 65536` reads **164** blocks | 118 (`on.heapcen.txt:266`) + 46 (`:221`) |
| **P2b** | its bytes in **[10,750,528 , 10,750,624]** | 164 x 65,536 + 164 x 16, + up to six extra granules |
| **P5a** | a `PROF` row at `scr_string.c:820` exists | `scr_prof.h:1060` now interposes this site for the first time |
| **P5b** | that row's `bytes == count x 65,536` | every chunk request is one size |
| **P5c** | a `PROF` row at `scr_string.c:822` with `freed > 0` | `scr_prof.h:1044` charges `freed` to the FREEING line |
| **P5d** | `count(:820) - freed(:822) == 164 - 118` | **the only legal join of the two lanes** |
| **P7** | that difference is **>= 33** | `half-on.heapcen.txt:220`; below it the arena was DISABLED |
| P3 | `busyBlocks` ~ 47,624 | informational — same block count, different size |
| P4 | busy total ~ **15,892,672** | informational, drift-exposed; see §5 |

### The arithmetic, shown

```
granule = round16(request + 8)                   OWNER-131079.md:247
  old:  round16(131,079 + 8) = 131,088
  new:  round16( 65,536 + 8) =  65,552
  per chunk:   131,088 - 65,552 = 65,536 EXACTLY, with no overhead term left over
46 chunks   ->  3,014,656 B
```

**Named denominators, both:**

* `3,014,656 / 18,907,440` = **15.944%** of the **instrumented** CRT busy
  heap, arm `on` (`on.heapcen.txt:3`).
* `3,014,656 / 18,203,808` = **16.56%** of the **uninstrumented** CRT busy
  heap (`DECOMP-ON.md` §2). The two are never mixed inside one ratio.
* As a share of the **process**: *not available.* The only committed
  heap-to-process ratio, `estado-vmwalk.md` §3's 10.9%, sits under that
  section's own **"PRE-FIX BASELINE — THE WHOLE OF THIS SECTION"** banner and
  its table cell now reads `n%`. Converting across to the shipped
  538.51 MiB peak gives **2.875 MiB / 538.51 MiB = 0.534%**, which is
  *arithmetic between two documents, not a measurement*, and must be labelled
  that way or not quoted.

### A 112-byte correction to `OWNER-131079.md:217`

That table prints **3,014,768**. The exact arithmetic above gives
**3,014,656**. The gap is that the line subtracts a *modelled* new overhead
(46 x 16 = 736) from an *observed* old one (526 — `OWNER-131079.md:253`, 39
blocks at 9 plus 7 at 25). Both are defensible endpoints of the same
quantity: 3,014,656 if the seven extra-granule blocks keep their extra
granule, 3,014,768 if they lose it. **The realized saving is therefore
knowable only to within `16 x chunks` = +-736 B, 0.024% of itself**, because
the new contribution is not separately observable once the chunks merge into
a row that already holds 118 others. `postfix-check.sh` prints the band and
names the gap rather than picking a side.

## 4. The two controls

### Positive — is this the NEW binary? (an exe hash is not an identity check)

The PE embeds its `-o`-derived PDB name, and `SCR_PROF_SITE`
(`scr_prof.h:201`) bakes `__FILE__` — the **absolute worktree path** — into
`.rdata`; `on.prof.txt` shows `G:\blocks\h2-wt\packages\runtime\src\...`. So
a different `-o` or a different worktree changes the bytes without changing
the code, and the baseline's 33,360,896 B is meaningless as a reference.

**C1 — the preprocessed TU, both directions.** With the same `-target` and
the same two `-include`s, no link:

```sh
zig cc -E -target x86_64-windows-gnu \
  -include tests/perf/prof/scr_prof.h -DSCR_PROF_ALLOC \
  -include tests/perf/heapcensus/scr_heap_census.h \
  packages/runtime/src/scr_string.c -o <scratch>/scr_string.i
```
* repaired tree: `_aligned_malloc` occurrences **0**, and
  `scr_prof_malloc` applied to the chunk constant **>= 1** — one grep proves
  *both* that the fix is in the TU *and* that the prof macro reached it;
* **run it against `G:\scriptc` as well**, where it must read `_aligned_malloc`
  **>= 1** and the chunk `scr_prof_malloc` **0**. A control proven in one
  direction only is the shape this corpus keeps paying for.

**C2 — the site string in the exe.** `scr_string.c:820` must appear in the
new binary's bytes and must **not** appear in
`G:\blocks\h2-out182-prof\zapo-rest-182.exe`. Verified available: line 820 of
`main`'s `scr_string.c` is the middle of a comment, and `on.prof.txt` carries
no `scr_string.c:8xx` row at all. **This is a measured negative control
against a file that exists on disk right now.**

**C3 — end to end.** P5a is C2 observed through the instrument.

### Null — is the instrument dead?

`N1` the `[heapcen] ARMED` banner on line 1 (`scr_heap_census.h:278`);
`N2` the census's own arm, `HCSIZE 5113` (its 137 blocks / 703,632 B are in
every committed arm); `N3a` **count** the rows — 247 in `on` — because a
scanner that died mid-file here once reported 54 where the truth was 346;
`N3b` the last line is a whole record; `N4` `PROF-TOTAL` is present, which is
the only evidence the prof half of the `_Exit` chain fired.

**`_Exit`, not `atexit`.** `process.exit` lowers to `_Exit` and skips every
`atexit` handler; `scr_heap_census.h:478-480` is the branch that chains
`scr_hc_report` and `scr_prof_report` onto it when `SCR_PROF_H` is defined.
A **missing** `.heapcen.txt` or `.prof.txt` is a dead instrument, **not a
zero** — `postfix-check.sh` exits 2 on that, deliberately not 1.

### The checker is itself controlled

`postfix-check.sh` was run five ways over committed and synthesised text —
no build, no binary:

| case | input | result |
|---|---|---|
| A | the committed `on` arm | **5 P assertions FAIL, all 5 N pass** |
| B | `on` with the row surgically moved to 164 | **all 13 pass**, prints `SAVED 3014656 B` |
| C | a truncated census | N2 + N3a fire |
| D | a missing file | `DEAD`, exit **2** |
| E | `131079` deleted but `65536` left at 118 — **the arena-disabled fake pass** | P1 passes, **P2a/P5a catch it** |

Case E is the single most dangerous failure in this design and it is the
reason P2 and P5 exist: with `SCR_STRING_ARENA` cleared there are no chunks,
`HCSIZE 131079` is absent **for the wrong reason**, and P1 alone would
publish a saving that was never made.

## 5. What can invalidate this — the list, before the run

1. **Early cache hit.** `SCRIPTC_PROF_CFLAGS` is in the build cache key and
   it is **byte-identical** to the baseline's, so an unchanged key over a
   changed runtime source is precisely the hazard. `SCRIPTC_NO_CACHE=1`, and
   grep the build log for `early cache hit` — it must be zero. **C1 is the
   authority if they disagree.**
2. **A worktree whose `node_modules` is a symlink into main.**
   `/g/blocks/h2-wt/node_modules -> /g/scriptc/node_modules`, measured.
   pnpm's workspace link is absolute, so `@scriptc/runtime` can resolve to
   **main's** sources — which still carry `_aligned_malloc` at
   `scr_string.c:753`. The build would compile the *unfixed* file out of a
   *fixed* worktree and still produce a new exe. **C1 is the only check that
   catches this.**
3. **The wrong tree.** `sa-wt` is `41ce4373c`, whose base is an older main.
   `gate-wt` is `38f481cda` = `b22985aa2` + the fix: that is the tree that
   will land. After the merge, build from a fresh worktree at the merge
   commit.
4. **Touching `gate-wt` while its gate runs.** Editing a gated worktree
   mid-run contaminated shards 4-6 once and the log still printed a clean
   `head=`. Wait for the gate; then claim the tree before its block purges
   the rig.
5. **Stale `packages/cli/dist`.** Benign here (0 compiler commits in the
   drift range) but assert it anyway — a `dist` predating the checkout
   silently builds the old knob state.
6. **`SCR_STRING_ARENA` set.** Turns off the code under test; fakes P1. The
   gate wrapper already clears it. Caught by P2a/P5a/P7.
7. **Any dial other than the `on` arm's.** `CONVS=200` alone takes the chunk
   count 46 -> 33 (`half-on.heapcen.txt:220`) and voids P2 outright.
8. **`SCRIPTC_PROF_CFLAGS` drift.** The six `-D`s are load-bearing: the two
   stack bands (1296..1352, 4376..4376) exclude 65,536, so the newly
   interposed chunk site takes **no** `RtlCaptureStackBackTrace`. Widening a
   band would put a stack walk on the chunk path and change timing.
9. **`#include <windows.h>` in anything on `PROF_CFLAGS`** kills the app182
   link — `fd_set` redefined in `scr_fetch_dispatch.c`.
   `scr_heap_census.h` already avoids it with an `__asm__`-name declaration
   for `HeapWalk`; do not "improve" that.
10. **A third `_Exit` interposer.** `scr_heap_census.h:484` `#error`s on it,
    which is the good case. The bad case is a build where `SCR_PROF_H` is
    *not* defined first: the `#elif !defined(_Exit)` branch is taken and the
    prof table is **never written**. N4 catches it.
11. **System32's `tar` ahead of GNU tar.** `bsdtar` rejects `--force-local`,
    provenance falls back to the island, and the build reports 64 refusals
    inside zapo-js that belong to the fallback, not the lane.
12. **The other zig.** Two on this host; they build the size class 20 KB
    apart. Pin `/g/tools/zig` (0.16.0) at the front of `PATH`.
13. **Caches defaulting to `C:`,** which has 1.1 GB free. Set
    `ZIG_LOCAL_CACHE_DIR`, `ZIG_GLOBAL_CACHE_DIR` and
    `SCRIPTC_PROVENANCE_CACHE` to `G:` paths. `SCRIPTC_ZIG_LOCAL` is read by
    nothing.
14. **`TMP` inside the worktree** reddens the fetch dispatcher. Keep it at
    `G:\blocks\*-tmp`.
15. **`USERPROFILE` lost by a detached shell** — `scr_os_homedir` traps.
16. **Reading the exe's mtime as a build time.** A cached artifact's mtime is
    an LRU bump.
17. **Flux read as retention.** `PROF`/`PROFHIST` count the whole run;
    `HCSIZE` counts what is live at `_Exit`. P5d is the **only** sanctioned
    join, and it joins them by *difference*, which is a retention.
18. **Quoting P4.** The busy total is exposed to all 26 commits of drift.
    The verdict rests on P1/P2/P5/P7, which are counts on rows that three
    committed arms agree on.
19. **Node versions.** v22.18.0 to build, v25.9.0 to test; the `PATH` node at
    `C:\Program Files\nodejs` is v14 and the rig spawns bare `node`.
20. **A bogus `SCRIPTC_TARGET`** lowers a different program entirely. Pin
    `x86_64-windows-gnu`.
21. **Disk.** `G:` measured at 30 GB free against a 20 GB floor. Budget
    ~400 MB: the out dir is ~270 MB (`h2-out182-prof`), the provenance cache
    ~28 MB, the run artefacts ~103 MB (`h2-run`).

## 6. The debt this run must pay off in the same slice

`DECOMP-ON.md` §1's A1 reads *"114 of the 118 blocks are cycle-collector
arena chunks"*. After this change **two arenas share one row** and that
sentence is wrong without a word — `OWNER-131079.md` §5 condition 1 said so.
The disambiguator now exists and costs nothing: the `PROF` sites
`scr_string.c:820` and the cycle arena's own allocation line split the row
by owner. **Land the A1 edit with the census, not after it.**

## 7. Cost

| | |
|---|---|
| build | ~11.2 min (`WHICH-BUFFER.md` §6), one binary |
| run | ~2.5 min, one arm (manifests: 2m25s..2m29s) |
| scoring | seconds; `postfix-check.sh` plus the two C1 preprocessor runs |
| **machine total** | **~15 min, single-threaded for the run** |
| disk | ~400 MB |
| quietness required | **none** — every assertion is a count or an exact identity |

## 8. The recipe

```sh
WT=<a worktree at the merge commit>          # NOT one with a symlinked node_modules
OUT=/g/blocks/sa2-out182-prof ; RUN=/g/blocks/sa2-run ; mkdir -p "$OUT" "$RUN"
export TMP='G:\blocks\sa2-tmp' TEMP="$TMP" TMPDIR="$TMP"
export SCRIPTC_PROVENANCE_CACHE='G:\blocks\sa2-prov'
export ZIG_LOCAL_CACHE_DIR='G:\blocks\sa2-zig' ZIG_GLOBAL_CACHE_DIR='G:\blocks\sa2-zigg'
export SCRIPTC_TARGET=x86_64-windows-gnu SCRIPTC_CC=zigcc SCRIPTC_TEST_CC='zig cc'
export USERPROFILE='C:\Users\vinicius' SCRIPTC_NO_CACHE=1
export PATH="/g/tools/zig:/c/Program Files/Git/usr/bin:$PATH"
unset SCR_STRING_ARENA

# C1 FIRST, both directions. Do not build if either direction disagrees.
# then the build of section 1, with -o "$OUT/zapo-rest-182.exe"
# then C2 against both exes
# then one run with the `on` arm's knobs, writing "$RUN/sa.{heapcen,prof}.txt"
sh tests/perf/heapcensus/postfix-check.sh "$RUN/sa.heapcen.txt" "$RUN/sa.prof.txt"
```

Write a manifest in the shape of `evidence-idle/*.manifest.txt` — tag, exe,
exe-bytes, knobs, started/ended, rc, free-G-GB — and commit the three
artefacts under `evidence-postfix/`. **The manifest is the source; the prose
is not.**
