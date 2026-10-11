# The heap after the release: two rows are 72.80%, and one of them has no owner

> **What this answers.** `IDLE-RELEASE.md` §1 ends the 4,376 row with *"Not
> smaller: gone."* Every decomposition this project has was taken with the
> idle release OFF. This file re-walks the heap on the arm that ships, names
> the new largest row with its arithmetic, and reports the decomposition that
> sums. It consumes only committed evidence: `evidence-idle/` at `715408cf0`.
> **Nothing was built and nothing was re-run for this file.**

Read off `evidence-idle/{off,on,long,half-on}.{heapcen,prof,sqlidle,manifest}`,
produced on `h2-which-buffer` at `21facf366`, program
`tests/perf/zapo-rest/app182/zapo-rest.ts` (zapo-js 1.8.2, provenance lane),
zig 0.16.0, `x86_64-windows-gnu`, workload `CHUNKS=8 CONVS=400 MSGS=6
TEXTLEN=300 ROUNDS=1 IDLE_S=60`, census through `/shutdown` after 45 s of
settle and 60 s of idle.

**`WHICH-BUFFER.md` §5 forbids quoting RSS, private commit, throughput or
wall-clock from this binary**, because `RtlCaptureStackBackTrace` sits in its
allocation path. Nothing of that kind appears below. Counts, census bytes and
the heap's own committed/uncommitted totals are what this build can be asked
for.

## 0. The proxy, declared

The `on` arm runs `SCR_SQLITE_IDLE_RELEASE_MS=1000` **as an environment
variable**, on the binary built at `21facf366` — which **predates** the merge
`054c543d2` that made 1000 the compiled-in default
(`packages/runtime/src/scr_async.c:2553-2554`, `#define
SCR_SQLITE_IDLE_RELEASE_MS 1000`). The env value and the new default are
**numerically identical**, so this arm is a faithful proxy for the shipping
configuration. **It is a proxy, not the binary that ships.** Every number
below inherits that caveat and none of them is a measurement of a post-merge
build.

## 1. The new largest row: the cycle collector's arena

| | |
|---|---|
| row | `HCSIZE 65536 118 7735152` |
| share | **40.91%** of the arm's busy CRT heap bytes |
| owner | **114 of the 118 blocks** are cycle-collector arena chunks |

### That owner line does not survive the string arena's repair

**True for the evidence this file reads, and false for any binary built after
`strarena/drop-64k-alignment`.** The arms here are `21facf366`, where the
string arena took its chunks through `_aligned_malloc(65536, 65536)` and they
landed in a row of their own, `HCSIZE 131079` (section 4 here;
`OWNER-131079.md` decomposes it to the byte). That slice makes
`scr_str_chunk_alloc` a plain `malloc(SCR_STR_ARENA_CHUNK)` and releases the
3,014,768 B of alignment padding -- **and the chunks it keeps move into this
row**, because 65,536 is also the string arena's chunk size.

So on a post-change census this row reads about **164 blocks** rather than
118 -- 118 + the 46 live string chunks, a figure that is coupled to the
workload and was 33 on `half-on`.

> **MEASURED, 2026-10-11.** `POSTFIX-CENSUS.md` builds the repaired tree at
> `ddc1e373a` and runs this arm's knobs: the row reads **164 blocks /
> 10,750,688 B**, the predicted count to the block. **The split is not the one
> predicted here.** By the PROF method this section prescribes, the owners are
> **113** cycle-collector chunks (`scr_cycle.c:1546` 675 − `:1589` 562),
> **47** string-arena chunks (`scr_string.c:820` 47 − `:822` 0, the free side
> never called), and the same **4** other occupants of the 65,536 class. The
> cycle arena lost one chunk and the string arena gained one, and the two
> cancel -- so 164 is right and `118 + 46` is not. A reader who takes the
> count as confirmation of the split is wrong by one block on each side.
>
> **LANE MARKER on the block immediately above.** The run it quotes is on a
> **different coroutine lane from this file's arms**: `POSTFIX-CENSUS.md`'s
> `sa` arm emitted a 229,342,743-byte module (fiber) where this file's
> binary emitted 242,844,741 (stackless) — the figure recorded below in
> *"The three coverage holes, each with its evidence"*, item 1, and the
> discriminator `pagecensus/evidence-fr2/manifest.txt` declares. **The 164
> is unaffected**: it is a count read inside one binary, and so are the
> 113/47/4 owners. What does NOT carry across is any arithmetic that
> subtracts this file's heap from that run's. Mechanism and the test that
> would close it: `evidence-postfix/LANE.txt` and the lane banner at the top
> of `POSTFIX-CENSUS.md`. **Sections of this file not named here are
> UNAUDITED, not thereby endorsed.**

And the owner sentence in the table above,

*"114 of the 118 blocks are cycle-collector arena chunks"*

**becomes false as written**. The 114 is still right; the denominator it is
quoted against is not.

**Two arenas now share one chunk size** -- `scr_cyc_ar_new` at
`scr_cycle.c:1546` and `scr_str_chunk_alloc` in `scr_string.c` -- so the
census row alone can no longer tell them apart, and a reader who splits it by
eye will mis-assign up to 46 blocks. Split it by the PROF counts of the two
sites instead: the cycle side is `scr_cycle.c:1546` minus `scr_cycle.c:1589`,
which is the arithmetic this section already uses, and the string side
becomes visible in PROF for the first time by the same change -- a plain
`malloc` is interposed by `scr_prof.h` where `_aligned_malloc` never was
(`OWNER-131079.md` section 2).

**Nothing in this file is retracted.** Every number here is correct for the
arms it names. The attribution simply does not travel forward past that
commit, and this is the word that says so.

The size is arithmetic, in the shape `WHICH-BUFFER.md` §2 used for the 4,376:

```
SCR_CYC_ARENA_CHUNK = (size_t)64 << 10          = 65,536   scr_cycle.c:288-289
scr_cyc_ar_new():   raw = malloc(SCR_CYC_ARENA_CHUNK)       scr_cycle.c:1546
scr_cyc_ar_release(): free(c->raw)                          scr_cycle.c:1589
CRT block = 65,536 request + 16 overhead = 65,552
            (census: 7,735,152 / 118 = 65,552.1)
live      = 614 allocated - 500 freed = 114                 on.prof.txt
114 x 65,552 = 7,472,928 B = 39.52% of 18,907,440
```

### 114 is invariant under half the workload, and the row is not

The allocation side resolves to **exactly 114 live chunks in all four arms**,
including the one that halves the conversation count:

| arm | alloc `scr_cycle.c:1546` | free `scr_cycle.c:1589` | live | `HCSIZE 65536` |
|---|---:|---:|---:|---:|
| `long` | 616 | 502 | **114** | 118 |
| `off` | 616 | 502 | **114** | 118 |
| `on` | 614 | 500 | **114** | 118 |
| `half-on` (`CONVS=200`) | 388 | 274 | **114** | 116 |

**`half-on` moves the census row 118 -> 116 and does not move the arena.**
The four remaining blocks (two on `half-on`) have no owner; no instrumented
site has a count that can explain them.

### This is object storage, and its occupancy IS measured — corrected 2026-10-10 22:55

> **CORRECTION. The heading below used to read "its occupancy is NOT measured",
> and the summary table in §5, heading *"The ceiling, declared"*, carried the
> cell `internal occupancy unmeasured (§1)`.**
> The body of this section was always correctly scoped — it says *"not measured
> **in this evidence**"* — but the heading and the table cell dropped the
> qualifier and read as a global unknown. **They were wrong by the time they
> were written.**
>
> **MEASURED, same dial set, same chunk count (114):**
> `tests/perf/pagecensus/README.md`, the block under *"slots carved=97501"* —
> **`occupancy 0.6293`**, `livebytes=4701520`, `held=7.12 MiB`, and
> `CEILING aligned freepages=564 = 2.20 MiB of 7.12 MiB held (30.9%)`.
> Independently in `tests/perf/lifecensus/README.md`, the block headed
> *"arena, at exit"* — *"73,113 live blocks = 4,701,520 B = 62.9% occupancy"*.
>
> **This file was written at 21:37; those two were written at 15:39 and 17:04
> the same day.** The newest document in the tree declared unknown a number two
> sibling documents had measured six hours earlier. **That is the defect worth
> recording here — not the arena.**
>
> **Sections of this file not named in this banner are NOT thereby current.
> They are unaudited.**

Both halves have to be said, because each alone is misleading:

* The 7,472,928 B are where cycle-collectable objects **live**. A chunk that
  is 100% occupied is not slack, and nothing here says these are not.
* **The internal occupancy of those chunks is not measured in this evidence.**
  These arms carry no `cycstat`, so the free-list-inside-the-arena share is
  unknown *here*. ~~**Without that number A1 can be called neither a lever nor
  a non-lever.**~~ **It is measured elsewhere, and A1 is a NON-LEVER.**
  `pagecensus` reads **62.93% live** (4,701,520 B of 7,472,928 B) and
  `lifecensus` reaches 62.9% independently. The residue decomposes:
  **2.20 MiB of whole free pages already returned to the OS** by
  `SCR_CYCLE_PAGERETURN`, which is **ON by default** (`scr_cycle.c:596-598`),
  leaving **0.44 MiB** of resident slack that is header pages plus free-list
  blocks sharing pages with live ones — unrecoverable without moving an
  object, and moving is out (`placement/SEGREGATION.md` §2, *"There is no
  handle indirection anywhere"*).

> A knob exists, and it is spelled out here because the wrong spelling has
> already cost a positive control. The real one is
> **`SCR_CYCLE_ARENA_BUDGET`**, read at `scr_cycle.c:1433` and enforced at
> `scr_cycle.c:1534` — *"if (bud != 0 && scr_cyc_ar_held +
> SCR_CYC_ARENA_CHUNK > bud) return NULL;"*. It also occurs in
> `tests/harness/cycle-arena.test.ts`, `memrig.mts` and both `zapo-rest`
> READMEs. The spelling `SCRIPTC_` + `CYCLE_ARENA_BUDGET` occurs in the tree
> **nowhere but this paragraph** — which is the whole point, and is why it is
> written apart here rather than as one token: a document that names a dead
> symbol becomes the symbol's only hit and refutes its own sentence. Default 0
> means no ceiling. At 114 chunks the arena holds 7.13 MiB, so a 16 MiB budget
> — the figure in `scr_cycle.c:288-347`'s own table, which reads
> *"no budget    SCR_CYCLE_ARENA_BUDGET=16 MiB"* — **does not bind.**

## 2. The decompositions that sum, with residue ZERO

Classes are disjoint by construction: every block has exactly one request
size, and every `HCSIZE` row lands in exactly one class. The denominator is
printed in the table's own header, which is the rule `HOLEMAP.md` §5 states as
*"Denominator stated on every line"*.

### Arm `on` — the shipping configuration — 18,907,440 B / 47,624 blocks

| class | bytes | share | blocks |
|---|---:|---:|---:|
| **A1** row 65,536 — cycle arena chunks (114 of 118 owned, §1) | 7,735,152 | **40.91%** | 118 |
| **A2** row 131,079 — **NO OWNER** (§4) | 6,030,160 | **31.89%** | 46 |
| **D** <= 256 B — the small-object ladder | 2,222,864 | 11.76% | 46,715 |
| **A3** other >= 64 KiB (65,552 / 87,368 / 114,688 / 131,072 / 262,144) | 923,056 | 4.88% | 6 |
| **B** 16 KiB .. 64 KiB | 709,536 | 3.75% | 20 |
| **C1** the instrument's own arm (5,113) | 703,632 | 3.72% | 137 |
| **C2** other 257 B .. 16 KiB | 583,040 | 3.08% | 582 |
| **SUM** | **18,907,440** | **100.00%** | **47,624** |

**Residue 0 B, 0 blocks.**

### Arm `off` — the negative control — 31,900,272 B / 50,411 blocks

| class | bytes | share | blocks |
|---|---:|---:|---:|
| **C0** row 4,376 — SQLite pcache page | 12,906,128 | 40.46% | 2,792 |
| A1 row 65,536 — cycle arena chunks | 7,735,200 | 24.25% | 118 |
| A2 row 131,079 — no owner | 6,030,160 | 18.90% | 46 |
| D <= 256 B | 2,221,824 | 6.96% | 46,708 |
| A3 other >= 64 KiB | 1,010,448 | 3.17% | 7 |
| B 16 KiB .. 64 KiB | 709,328 | 2.22% | 20 |
| C1 the instrument's own arm | 703,632 | 2.21% | 137 |
| C2 other 257 B .. 16 KiB | 583,552 | 1.83% | 583 |
| **SUM** | **31,900,272** | **100.00%** | **50,411** |

**Residue 0 B, 0 blocks.**

### The sentence that matters more than the tables

**The whole `off` -> `on` difference is TWO rows. The deltas of the other 250
rows sum to +672 bytes.**

The 250 is the union of the two censuses — 247 distinct request sizes on each
arm, 5 present only on `on` and 5 only on `off`, so 252 in the union — minus
the two rows named below.

```
row 4,376   12,906,128 -> 0           delta -12,906,128
row 87,368     174,752 -> 87,376      delta     -87,376
the other 250 rows, summed             delta       +672
                                       -----------------
                                              -12,992,832   = 31,900,272 - 18,907,440
```

**This reproduces, by an independent path, the 672 that `IDLE-RELEASE.md` §2
registered** — that section derives it as the gap between a prediction and a
measurement (*"672 bytes. Two separately-registered misses are one named
cause: the retained slab, and nothing else."*). This file derives it as the
residue of a full row-by-row diff of the census. Two derivations landing on
the same number is a confirmation this corpus rarely gets.

### Two denominators, and they are two quantities

The instrument is **703,632 B of occupied heap** in the tables above and
**700,481 B of requested bytes** (137 x 5,113) in `HCTOTAL`'s `armCount` /
`armSize`. `IDLE-RELEASE.md` §6's correction *"The heapcensus arm is 700,481 B,
not 703,632"* is about the **request** figure; the column here is
`cbData + cbOverhead` (`scr_heap_census.h:142`, `scr_hc_tbl[j].bytes += size +
overhead`), so 703,632 is the right number for this denominator. **Two
quantities, not a correction ignored.**

An uninstrumented build's busy heap would be **18,203,808 B**. Every share in
the `on` table is therefore inflated by about **3.9%** relative to what ships.
Against that denominator A1 — the whole 65,536 row — is **42.49%**, the 114
arena chunks inside it are **41.05%**, A2 is **33.13%**, and the retained slab
is **0.48%**. A1 and A2 together are **75.62%** there against 72.80% here;
**the two denominators must not be mixed inside one ratio.**

## 3. What the release did not reach

**One row survives, and it is 87,376 B = 0.46% of the arm's busy heap.**

`HCSIZE 87368` goes **2 -> 1**. The slab is
`szAlloc * nInitPage + 8 = 4,368 * 20 + 8 = 87,368`, the arithmetic
`WHICH-BUFFER.md` §2a states as *"2,792 individual blocks ... plus 40 pages
living inside the two bulk blocks"*.

The mechanism `IDLE-RELEASE.md` §2 names is verified against the vendored
source as committed:

* `sqlite3PcacheRelease` — `sqlite3.c:57294-57305` — unpins only under
  `if( p->flags&PGHDR_CLEAN ){ pcacheUnpin(p); }`; otherwise the page goes to
  the dirty list and stays held.
* the bulk free — `sqlite3.c:58316-58319` — is gated on
  `if( pCache->nPage==0 && pCache->pBulk )`.

So it is *"all-or-nothing: 19 of 20 pages unpinned returns ZERO bytes"*
(`IDLE-RELEASE.md` §2). `on.sqlidle.txt` carries **130 windows, 2 `IN-USE,
kept` and 128 `RELEASED`, over a single distinct `db=`** — one connection, two
pcache1 caches, one purged entirely and one holding a page. The structural
ceiling is *(number of pcache1 caches holding a dirty page) x 87,376 B*, which
is 1 slab here.

### No other row carries that signature

Every other row that moved between `off` and `on` is a **size shift**, not a
retention: the request moves between neighbouring sizes and the block count is
preserved.

| family | `off` blocks | `on` blocks | family bytes `off` -> `on` |
|---|---:|---:|---|
| ~47 KB (47,200 / 47,216 / 47,232 / 47,264 / 47,280 / 47,296) | 8 | **8** | 378,032 -> 378,144 |
| ~17 KB (17,216 / 17,640 / 17,732) | 5 | **5** | count unchanged |
| 984 / 1,000 | 3 | **3** | count unchanged |

### Sixty percent of what was freed left the committed heap

The release empties the busy table in full; the CRT heap returns only part of
it to the OS.

```
committed = busy + free
off:  31,900,272 + 12,290,848 = 44,191,120
on:   18,907,440 + 17,493,520 = 36,400,960      delta -7,790,160  (-17.6%)
uncommitted: 21,524,480 -> 29,888,512           delta +8,364,032

of the 12,992,832 B freed:  7,790,160 B (60.0%) left the committed heap
                            5,202,672 B (40.0%) stayed as free-but-committed holes
```

The split is the project's standing result that retention is placement rather
than volume, measured here on the one change whose freed volume is known
exactly.

## 4. `HCSIZE 131079` — 6.03 MiB that no document has ever named

**46 blocks, 6,030,160 B, 31.89% of the arm's busy heap.** Byte-identical in
`off` and `on` — **the release does not touch it** — and **33 blocks on
`half-on`**, so it is coupled to the workload. It is present in **seven
committed census files**: `evidence-idle/` x4 and `evidence-h2/` x3.

**It is named in no document in this repository.** `rg 131079` over the tree
returns the seven census files and **one false positive**: a float in
`packages/runtime/test/number-cases.txt:11415` (`-1.1310798142544112e-38`) —
the same substring trap that once inflated a `72.12` from three files to four.
A 6 MiB row that has never been named is a finding on its own.

### The exclusion chain

**(a) The coverage violation is in octave 17 and only there.** `WHICH-BUFFER.md`
§4 runs the control *"For every busy size below 8 KiB, folded to `PROFEXACT`'s
8-byte key, live must not exceed ever-allocated"*. Extended to every octave,
using `PROFHIST` (whose bucket `b` covers `[2^b, 2^(b+1))`, `scr_prof.h:570-583`):

| octave | range | live blocks | whole-run allocations | |
|---:|---|---:|---:|---|
| 15 | 32,768 .. 65,535 | 14 | 91 | |
| 16 | 65,536 .. 131,071 | 121 | 5,869,527 | |
| **17** | **131,072 .. 262,143** | **47** | **36** | **live exceeds ever-allocated by 11** |
| 18 | 262,144 .. 524,287 | 2 | 34 | |

**Positive control: the octave-17 counter reads 36, not zero**, and its
neighbours read 91 and 5,869,527. The bucket is alive; the violation is a
reading, not a dead counter. Octave 17 is the only one of 22 that violates.

**(b) `scr_string.c:1162` is dead by arithmetic.** It is the one instrumented
site with a real presence in octave 17 (32 of the 36). Every `ScrStr` request
goes through `scr_pool_bytes()` (`scr_runtime.h:433-435`), which rounds up to
`SCR_POOL_GRAIN`, and `SCR_POOL_GRAIN` is **8** (`scr_runtime.h:359`).
**131,079 mod 8 = 7.** No `scr_pool_bytes()` result can be odd. The same
argument kills `scr_cycle.c:1727`.

**(c) Four singletons remain.** `scr_websocket.c:338`, `scr_cycle.c:2292`,
`scr_cycle.c:2108` and `scr_map.c:468` each recorded exactly **one**
allocation in octave 17 for the whole run. At most four of the 46 blocks can
come from an instrumented site, so **at least 42 of 46 are outside the prof
lane entirely.**

### The three coverage holes, each with its evidence

1. **The emitted program's own translation unit.** The measured artifact is on
   disk: `/g/blocks/h2-out182-prof/zapo-rest.ll`, 242,844,741 B, recorded as
   `EMITTED zapo-rest.ll=242844741` in that directory's `env.txt`. The lane is
   LLVM, and `-include scr_prof.h` has no effect on a `.ll` input. The file
   declares `@calloc` (`:3087`) and `@malloc` (`:3093`) and makes **4 malloc
   and 831 calloc calls** of its own, emitted by
   `packages/compiler/src/backend/llvm/emitter.ts:3143,3236,3319,3422` and
   `llvm/classes.ts:511,514` / `llvm/shapes.ts:781,784`. None of them appears
   in `PROF`. **But the string `131072` does not occur once in those 242 MB**,
   and every one of those sites carries a `ptrtoint getelementptr` struct
   size. So this hole is **real and probably not this owner.**
2. **libc.** `scr_prof.h:60-63` says so by name: *"What it does NOT cover is an
   allocation inside libc or inside a vendored archive compiled without this
   header."*
3. **The operating system.** `processHeaps=3`; heap 1 has `busy=0
   busyBlocks=0` and heap 2 has `busy=18400 busyBlocks=10`. A process holding
   live sockets does not keep a ten-block process heap, so heap 0 — the CRT
   heap the census walks — is almost certainly also the process heap, and
   allocations made by Windows DLLs land in the census without passing the
   profiler.

### A control limitation that has to be written down

`busyband.c` is what established that the busy table is exact
(`WHICH-BUFFER.md` §4, *"thirteen distinct `HCSIZE` rows of exactly 100"*). It
plants sizes **1,288 through 4,384 and nothing else** — every one of them
inside the LFH. **The two rows that dominate the `on` arm, 65,536 and 131,079,
are backend blocks and were never covered by that control.**

What supports reading 131,079 as an exact request is therefore **indirect**:
131,072 and 131,079 appear as **separate rows** in the same census, so
`HeapWalk`'s busy `cbData` is not rounding to a bucket in this range. That is
good evidence and it is not the planted control. Written here because, left
unwritten, it becomes a verdict in three weeks.

## 5. The ceiling, declared

**Denominator, named: the `on` arm of `evidence-idle`, binary
`h2-out182-prof/zapo-rest-182.exe` at `21facf366`, `CONVS=400`, busy CRT heap
= 18,907,440 B.** No ratio below crosses runs.

| candidate lever | ceiling | state |
|---|---:|---|
| cycle arena (A1, 114 chunks) | **39.52%** — 7,472,928 B = **7.13 MiB** | **NOT A LEVER — settled 2026-10-10.** Occupancy **62.93%** measured (`pagecensus`, `lifecensus`); of the rest, 2.20 MiB is already returned to the OS and 0.44 MiB is unrecoverable without moving. Ceiling ≤ **0.59%** of settled privateCommit (§1) |
| row 131,079 (A2) | **31.89%** — 6,030,160 B | **no owner** — no lever until attributed (§4) |
| retained pcache bulk slab | **0.46%** — 87,376 B | mechanism known, fix known, value small (§3) |
| largest row after those: `HCSIZE 262144 2` | **2.77%** — 524,320 B | 2 blocks |
| largest small-object row: `HCSIZE 96 4497` | **2.66%** — 503,744 B | 4,497 blocks |
| the whole 16–64 KiB band | **3.75%** — 709,536 B | 20 blocks, 12 sizes |

**Declared: outside the two large rows, no row in the settled heap is worth
more than 2.77%, and the largest whole band below 64 KiB is worth 3.75%.**

## 6. What this changes, and the queue

The brief that ordered this slice registered as its most-likely-wrong half
that *the heap might be over — that what remains are terms under 1 MiB and
none of them worth a slice*. **That is refuted: 72.80% of the busy heap sits
in two rows.**

But the correction is to the *shape*, not to the pattern: it is not that every
candidate dies when measured. It is that **the two largest remaining terms are
neither defect nor target.** One is the collector's own object storage,
invariant at 114 chunks under half the workload, with a knob that exists and
does not bind. The other has no owner at all.

**So the next slice on this front is ATTRIBUTION, not repair:**

1. **An owner for `HCSIZE 131079`.** It must come from the **HeapWalk side** —
   reading the contents of a live 131,079-byte block and identifying the
   structure. **A `PROFSTACK` band will not work**: the stack lane hangs off
   `scr_prof_malloc`, and §4 establishes that at least 42 of these 46 blocks
   never pass through it. Spending a build on
   `-DSCR_PROF_STACK_SIZE_MIN=131079` would return an empty table and read as
   an absence.
2. **An occupancy number for the cycle arena.** A `cycstat` arm on the same
   workload, so that A1 can be called a lever or ruled out as one.

Only after those two does a repair slice have a target worth the effort.

## 7. Reproduce

Nothing is built. The whole file is arithmetic over committed artifacts:

```sh
# the four censuses and the four prof tables
tests/perf/heapcensus/evidence-idle/{off,on,long,half-on}.heapcen.txt
tests/perf/heapcensus/evidence-idle/{off,on,long,half-on}.prof.txt
tests/perf/heapcensus/evidence-idle/on.sqlidle.txt

# the decomposition: partition every HCSIZE row by request size, assert the
# class sums equal HCTOTAL's bytes and blocks, and print the residue.
# The arena figure: PROF scr_cycle.c:1546 count minus PROF scr_cycle.c:1589 freed.
# The octave table: PROFHIST bucket b against census rows with
#   floor(log2(requestSize)) == b.
```

Every assertion in that reader is a stop, not a warning: the class sums are
checked against `HCTOTAL` before any share is printed, and all four arms carry
`lost=0`.

---

**Gate status: green by construction.** `tests/perf` is outside the gate's
glob (`vitest.config.ts:49-53` includes only `tests/harness/**` and
`packages/*/{src,test}/**`), so this document and the evidence beside it are
not gated. That is a statement about reach, not about having passed anything.
