# The 1,344 is not a `ScrBytes` payload, and the 4,376 is the whole database

> **What this answers.** `HOLEMAP.md` §4 names the 1,344-byte hole class a
> freed `scr_bytes.c:52` payload and closes with *"which TS-level buffer is
> 1,328 bytes ... needs the allocation-side exact table on app182, which this
> slice did not build."* §6 calls the 4,376-byte busy class *"the obvious next
> row, and it is not mine."* This slice built that binary. Both answers came
> out of **one run**, which is the point: the instrument that makes one run
> enough did not exist until today, and its absence is why the previous
> attribution had to join two.

Measured on `h2-which-buffer` at `21facf366`, program
`tests/perf/zapo-rest/app182/zapo-rest.ts` (zapo-js 1.8.2, provenance lane),
zig 0.16.0, `x86_64-windows-gnu`. Three memrig arms, the documented workload
`CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60`, settled census
taken through the `/shutdown` route 45 s of settle and 60 s of idle after the
last write.

## 0. The instrument, and why one run is the whole finding

`census-arms.sh:21` documents the `_Exit` chain order **"prof → heapcensus"**.
That order was not a composition, it was a **compile error**: `scr_prof.h`
defines `_Exit` unconditionally with no hook of its own, `scr_heap_census.h`
has branches only for `SCR_CYCEN_ON` and for `_Exit` being undefined, and the
`#else` is `#error`. So the **allocation side and the free side had never been
measurable in the same process.** Fixed in `21facf366`, with a positive
control that plants a known population in each band and one outside both.

That is not housekeeping. It is the mechanism of the error being corrected
here, and `HOLEMAP.md` §5 retires the same shape one level up.

## 1. (a) WHICH buffer — it is not a buffer, it is SQLite

**`scr_bytes.c:52` owns none of it.** One run, both tables:

| | this run (`main`) |
|---|---:|
| `PROFEXACT` over the band **[1296, 1352]**, whole run | **60** |
| `PROFEXACT 1328` | **16** |
| `HCSIZE 1328` live at rest | **1** |
| `HCFREE 1344` | **row absent** |
| whole-run allocations | 10,473,868 |

All 60 are SQLite's, captured by the stack lane at depth 10 and resolved
against sqlite3.o's own symbol table (§4):

```
59   sqlite3MemMalloc <- dbMallocRawFinish <- sqlite3VdbeMakeReady / sqlite3VdbeMemGrow
                                              / sqlite3StrAccumEnlarge
 1   sqlite3MemRealloc <- dbReallocFinish <- sqlite3DbReallocOrFree
```

and where a frame of the compiled program is still on the stack it is
`sqlite3_step <- scr_sqlite_exec <- sv_db_exec <- sc_dfa_10` — the TS
program's `db.exec`, not a `Buffer`.

### The refutation is inside `HOLEMAP.md`'s own evidence file

`HOLEMAP.md` §4 quotes `scr_bytes.c:52  n=19091  avg=1094.4` from
`settled-census/evidence-trace1344/prof.txt` and concludes the 1,344 holes are
that site's payloads. **Two lines further down in the same file** is that
site's size histogram, which is what the `SIZEHIST` lane was built for:

```
PROFHIST ... scr_bytes.c:52   0:73 1:3235 2:11 3:1615 4:1674 5:11549 6:38
                              7:145 8:41 9:5 10:3  11:2 12:12 13:386 ...
```

**Octave 10 is 1,024–2,047 bytes and it reads `3`.** Three payloads in the
whole run. Against 15,766 holes and 4,097 live blocks. This run reproduces it
exactly — `10:3` again, out of 26,513 calls instead of 19,091, a month later
on a different build:

```
PROFHIST ... scr_bytes.c:52   0:139 1:4856 2:53 3:3275 4:3315 5:13195 6:76
                              7:153 8:52 9:13 10:3  11:2 12:8 13:775 ...
```

So the share the brief asks for — *"what share of the 19,091 does it own"* —
is **0 of the 60 in the band**, and **3 of 26,513 in the entire 1,024–2,047
octave**, 0.011%. What `scr_bytes.c:52` actually allocates is small: 13,195 of
26,513 payloads are 32–63 B, and the 92.2 MB it moves is carried by 88
payloads of ≥512 KB. **1,328 is not its mode on 1.8.2.**

> The 19,091 and the 15,766 are also not one run. `evidence-trace1344`
> recorded 2,403,045 allocations; this workload makes 10,473,868. A share
> formed across them would be the error `HOLEMAP.md` §5 retires.

### But the population was real, and it is gone

`HOLEMAP.md` §4's lockstep table was sound evidence of *a* sync-created
cohort. Today that cohort is absent — all of it, back to where **no sync** left
it on 2026-09-10:

| busy request size | 09-10 nosync | 09-10 sync | **h2 main** | **h2 nocache** |
|---:|---:|---:|---:|---:|
| **1,328** | 76 | **4,097** | **1** | **1** |
| 40 (`sizeof(ScrBytes)`) | 3,700 | **7,738** | **3,686** | 3,686 |
| 24 | 6,488 | **10,521** | **6,435** | 6,429 |
| 16 | 9,922 | 9,887 | 9,616 | 9,616 |
| 32 | 6,362 | 6,372 | 6,378 | 6,377 |
| 64 | 3,409 | 3,425 | 3,423 | 3,419 |
| 96 | 4,514 | 4,532 | 4,498 | 4,497 |
| **4,376** | 56 | **2,792** | **2,792** | **2,791** |

The CRT heap's free side went **36.51 MiB in 81,414 holes → 12.50 MiB in
12,903**, and the 1,344 row with it. `scr_bytes.c` itself has **not been
touched since 2026-09-09**; 400 commits landed in the window. What closed it
is someone else's row and is not claimed here.

**So: the cohort was real, and the name `HOLEMAP.md` gave it was never
supported by an allocation-side measurement — not by this run, and not by the
one prof file taken on that arm.** What the 09-10 census saw at 1,328 remains
unattributed; it is simply no longer there to attribute.

## 2. (b) The 4,376 — SQLite's page cache, and it IS retention

**100% of 2,792, five distinct stacks, one path:**

```
sqlite3MemMalloc <- pcache1Alloc <- pcache1FetchStage2 <- getPageNormal
                 <- btreeGetPage <- btreeGetUnusedPage <- allocateBtreePage
                 <- balance / sqlite3BtreeInsert / sqlite3BtreeCreateTable
```

The size is arithmetic, not a coincidence:

```
szAlloc = szPage + szExtra + ROUND8(sizeof(PgHdr1))   sqlite3.c:58472
        = 4096   + 216     + 56                        = 4368
malloc  = nByte + 8                                    sqlite3.c:28035
                                                       = 4376
```

Of those terms, **4,376 is measured** (the stack lane), **4,096 is measured**
(every arm's `state.sqlite` is an exact multiple of 4,096 — 11,268,096 /
4,096 = 2,751.0 — so the page size is the compiled-in
`SQLITE_DEFAULT_PAGE_SIZE`), **56 is `sizeof(PgHdr1)` read off the struct**,
and **216 is the remainder**, i.e. the pager's `szExtra`. The equation is how
4,376 arises, not an independent measurement of `szExtra`.

### Decided at rest, not at peak — and the at-rest answer is "defect"

The brief's caution is the right procedure and it is what produced the result.
Four measurements, each of which could have come out the other way:

1. **It is never freed.** `PROFEXACT 4376 = 2792` and `HCSIZE 4376 = 2792`.
   Every 4,376-byte block the process ever allocated is still live at exit, in
   a run that made 10.47 M allocations and freed 10.26 M of them. The
   population is monotonic.
2. **It survives at rest.** The census is taken 45 s of settle plus 60 s of
   idle after the last write.
3. ~~**`PRAGMA cache_size` does not bound it.**~~ **RETRACTED 2026-10-10 — that
   arm was an A/A, and both of its cap figures were wrong. See §2a.** The arm
   was armed and recorded (`ARM ZAPO_SQLITE_CACHE_KB=0` in
   `nocache.phases.csv`), and it moved the row **2,792 → 2,791**; what it did
   not do is change the cap. Original text: `app182/zapo-rest.ts:259` sets
   `ZAPO_SQLITE_CACHE_KB` to 16000 by default — `cache_size = -16000`, a cap
   of `16000·1024/4312 = 3,799` pages; setting it to **0**, which leaves
   SQLite's compiled-in `-2000` (a cap of **474** pages), moved the row by one
   block.
4. **It is sized by the database, not by the cache setting.**

   | arm | `CONVS` | db bytes | db pages | 4,376 live | allocated | live − pages |
   |---|---:|---:|---:|---:|---:|---:|
   | `main` | 400 | 11,268,096 | 2,751 | 2,792 | 2,792 | +41 |
   | `nocache` | 400 | 11,264,000 | 2,750 | 2,791 | 2,791 | +41 |
   | `half` | 200 | 5,611,520 | 1,370 | 1,423 | 1,423 | +53 |

   Halve the workload and it halves. **The page cache holds every page of the
   database and about 1.5% more.**

So the verdict is not "a large busy row, therefore a problem" — it is: **the
process holds the entire SQLite database in RAM, the population grows one
buffer per database page**, and at 12,906,128 B it is **40.4% of all busy CRT
heap bytes** (31,919,616), the single largest busy row in the settled heap.

> **RETRACTED 2026-10-10, and this is the line that gets quoted, so it is
> marked here rather than only at §2a.** The original sentence continued
> *"nothing is ever returned, and the knob that is supposed to cap it does
> not."* Both halves are false. The cap was never reached (§2a), and the
> return mechanism exists, shipped 2026-10-03 in merge `040d22982`, and was
> simply **off by default in this run** — `SCR_SQLITE_IDLE_RELEASE_MS`
> appears in no arm record and defaults to 0 (`scr_async.c:2536`). This
> measurement is that feature's **negative control**, not a defect.

Every stack ends in `allocateBtreePage` — a page the write path **creates** —
so `pcache1FetchStage2` reached `pcache1Alloc` rather than recycling.

> **The sentence that followed was a correct `file:line` with an inverted
> description of what the code does**, which is the trap this project names
> explicitly. It read: *recycling "only [happens] when nothing in the cache is
> unpinned"*, and concluded *"why these pages stay pinned is the next
> question."* `pcache1FetchStage2`'s step 4 (`sqlite3.c:58584-58589`) is a
> **conjunction**: it recycles only when the cache is purgeable **AND** the LRU
> tail is not the anchor **AND** (`nPage+1 >= nMax` or under memory pressure).
> With `nPage+1 < nMax` the recycle is skipped **because the cache is under its
> cap** — the unpinned test is never consulted. **Allocating is the normal
> path for a cache that has not filled**, and it implies nothing about pinning.

### Which the page cache is, read from source

`bPurgeable = !memDb` (`sqlite3.c:64707`) and this is a file database, so the
cache **is** purgeable. `pcache1Unpin` (`sqlite3.c:58761-58790`) frees outright
only when `reuseUnlikely || nPurgeable > nMaxPage`; otherwise the page goes on
the LRU and `nRecyclable++`. With 2,832 pcache1 pages against a per-cache
`nMaxPage` of 3,871 (§2a), that branch never fires: **the LRU explains the
whole population with ZERO pinned pages.**

`pcache1Free` (`sqlite3.c:58064-58092`) retains only inside the
`SQLITE_CONFIG_PAGECACHE` pool, and `sqlite3_config` is called **nowhere** in
this runtime (`rg -c sqlite3_config packages/runtime/src/*.c` → 0, positive
control: 3 hits for `sqlite3_open|sqlite3_db_release_memory` in the same file).
So a freed page goes straight to `sqlite3_free` and to the CRT — SQLite is not
hoarding it either.

And the shipped release reaches all of it: `sqlite3_db_release_memory`
(`:188268`) → `sqlite3PagerShrink` (`:63238`) → `sqlite3PcacheShrink`
(`:57636`) → `pcache1Shrink` (`:58522`), which forces `nMaxPage = 0` and lets
`pcache1EnforceMaxPage` (`:58304`) **drain the entire LRU**, then frees the
bulk blocks at `:58322`. `SEMANTICS.md`'s *"frees only UNPINNED pages"* is
exactly right and is not a limitation here, because almost nothing is pinned.

### 2a. RETRACTION — the cap arithmetic, and why the `nocache` arm was an A/A

**(a) Both arms ran at the same `cache_size`.**
`packages/compiler/src/backend/cc.ts:1291` compiles in
`-DSQLITE_DEFAULT_CACHE_SIZE=-16000`, and `app182/zapo-rest.ts:282-284` passes
a `cache_size` pragma **only when `CACHE_KB > 0`**; with `ZAPO_SQLITE_CACHE_KB=0`
it passes **no pragma at all**, so the connection takes the compiled-in default
— which is `-16000`, not stock SQLite's `-2000`. The two arms were therefore
identical in the variable under test, and **2,792 → 2,791 is an A/A delta of
one block.** Corroboration in the same three files: the bulk row
`HCSIZE 87368 2 174752` is **byte-identical in all three arms** while the 4,376
band moves 2,792 / 2,791 / 1,423 — the only arm that moved the population is
the one that changed the workload.

The comment at `zapo-rest.ts:252-257` is what led here: it says the store does
not default `cache_size`, so the database would run on SQLite's compiled-in
2 MiB page cache. **That is true of better-sqlite3 and stock SQLite and false
of this runtime**, because `cc.ts` overrides the compiled-in value.

**(b) Even nominally, the cap was never below the population.**
`numberOfCachePages` (`sqlite3.c:57021-57036`) divides by `szPage + szExtra`
taken at the **PCache** level, not pcache1's:

| term | value | source |
|---|---:|---|
| `szPage` | 4096 | `SQLITE_DEFAULT_PAGE_SIZE`; 11,268,096 / 4096 = 2,751.0 |
| pager `nExtra` = `PCache.szExtra` = `sizeof(MemPage)` | 136 | `sqlite3.c:72458-72489`, `ROUND8` at `:64705` |
| `ROUND8(sizeof(PgHdr))` | 80 | `sqlite3.c:18206-18229` |
| `pcache1.szExtra` = 136 + 80 | 216 | `sqlite3.c:57104` |
| `ROUND8(sizeof(PgHdr1))` | 56 | `sqlite3.c:57800-57811` |
| `szAlloc` = 4096 + 216 + 56 | 4368 | `sqlite3.c:58472` |
| CRT block, +8 | **4376** | matches the measured band exactly |

So the denominator is **4,232**, not the 4,312 used above: the cap is
`16,384,000 / 4,232 = ` **3,871** pages, and stock `-2000` would have been
**483**, not 474. **It does not matter which figure you take: 2,792 < 3,799 <
3,871.** The ceiling was above the population in every arm, so no arm tested
the cap.

**The pcache1 page count, both halves from the same run** (h2 `main`,
`21facf366`): 2,792 individual blocks (`main.heapcen.txt:274`) plus 40 pages
living inside the two bulk blocks (`87,368 = 4,368·20 + 8`, `nInitPage = 20`,
`sqlite3.c:57980-58014`) = **2,832**, against `nMaxPage` 3,871 per cache.

> ***ANSWERED 2026-10-10 — see `IDLE-RELEASE.md` §1.*** The pages are **not
> pinned at rest.** Arming `SCR_SQLITE_IDLE_RELEASE_MS` drives this row from
> 2,792 to **zero**, on the same workload and the same binary — the census row
> stops existing, and `rg -c '^HCSIZE 4376 '` reads **1/1/0/0** across
> `long`/`off`/`on`/`half-on`. The verdict above therefore stands as a
> measurement of the **default**, not of the runtime's reach: *"nothing is
> ever returned"* is true at `SCR_SQLITE_IDLE_RELEASE_MS=0`, which is what
> ships, and false the moment the knob is set. What does **not** come back is
> one 87,368-byte bulk slab per cache, held by a single pinned page —
> `IDLE-RELEASE.md` §2, *"all-or-nothing: 19 of 20 pages unpinned returns
> ZERO bytes."*

## 3. The instrument map that made the stacks readable

`pdb-symbols.mjs`'s header states the PDB *"carries publics AND per-module
S_LPROC32 records, so even a `static` function in the EMITTED PROGRAM TU
resolves."* **That is false on the LLVM lane.** The emitted module's debug
stream is absent entirely (`llvm-pdbutil: "Module stream not present"`), and
**1** of the program's 27,281 `define`s — `main` — reaches Publics. Resolving
an emitted frame against Publics therefore returns the nearest preceding
*exported* symbol from some other object: `sqlite3_sourceid+504774`. A wrong
name with a right name's shape.

Two routes were tried and the first was refused by its own check:

| route | result |
|---|---|
| index-align `.pdata` against the `.ll`'s `define` order | **REFUSED** — 24,220 unwind records against 27,281 defines. x64 leaf functions carry none, so a third of the table is missing and most frames would have been named wrongly. |
| the **cached COFF object**'s symbol table + the PDB's section-contribs | **USABLE** — 18,895 function symbols; `main`'s RVA computed from the object equals the one Publics reports. |

`nsyms=0` is true of the linked PE and false of the object the linker ate.
The same trick applied to `sqlite3.o` names 2,363 static functions, checked
against **277 of 277** publics falling inside that module's range — which is
what turned `sqlite3_sourceid+576283` into `pcache1Alloc+140`.
`fnmap.mjs` / `objmap.mjs` / `modmap.mjs` refuse rather than return a map that
fails its check.

## 4. Controls

* **The chain control.** 300 × `malloc(1328)` with every other one freed, 170
  × `malloc(4376)`, 500 × `malloc(2000)` outside both bands, exiting through
  `_Exit`. Read back: `HCSIZE 1328 = 150`, `HCFREE 1344 = 158`,
  `HCSIZE 4376 = 170`, `PROFEXACT 1328=300 4376=170 2000=500`,
  `PROF-STACKS-TOTAL rows=2 count=470 lost=0 tablefull=0 skipped=639`.
  470 = 300 + 170.
* **Is the BUSY table banded like the free one?** `HOLEMAP.md` §2 proves the
  *free* table bands [1296,1352] onto 1,344, then reads the *busy* row at
  1,328 as an exact request — a separate claim about a separate table that was
  never tested. Tested here: 100 live blocks planted at each of 1288, 1296,
  1304, 1312, 1320, 1328, 1336, 1344, 1352, 1353, 4368, 4376, 4384 give
  **thirteen distinct `HCSIZE` rows of exactly 100.** The busy table is exact.
  HOLEMAP's reading of it stands.
* **Can the prof lane see what the heap sees?** For every busy size below
  8 KiB, folded to `PROFEXACT`'s 8-byte key, *live must not exceed
  ever-allocated*. 115 buckets, 15 violations, largest excess 14 blocks at
  1,192 B — libc-internal allocations the header says by name it cannot see.
  The census's own arm reads **137 allocated / 137 live**, and 4,376 reads
  **2,792 / 2,792**. `PROFEXACT 1328 = 16` is not a blind spot.

## 5. The instrument's footprint, stated

Measured off the PE, not predicted: against the uninstrumented build of the
same program, `.data` goes **1.41 → 39.67 MiB** (`scr_prof_hist` is
65,536×40×8 = 20.97 MiB, `scr_prof_stk` 131,072×96 = 12.0 MiB, plus the row
and pointer tables), `.text` +0.81 MiB, `.rdata` +0.44 MiB; total image vsize
**31.16 → 70.68 MiB**. None of it is a CRT heap block, which is why the two
census tables are unaffected and the coverage gate above closes.

Its one heap-side cost is heapcensus's own arm, **137 blocks of 5,113 B =
703,632 B**, 2.2% of the 31.9 MiB busy total, and the census prints it.

**No RSS, private-commit, throughput or wall-clock figure is quoted from this
binary.** The stack lane runs `RtlCaptureStackBackTrace` on the allocation
path and the host carried 26 processes over 300 MB throughout. Counts and
exact tables are what this build can be asked for.

## 6. Reproduce

```sh
# build (11.2 min): prof ALLOC+SIZEHIST+STACKS over two disjoint bands,
# chained into heapcensus so one process writes both tables
SCRIPTC_PROF_CFLAGS="-include tests/perf/prof/scr_prof.h \
  -DSCR_PROF_ALLOC -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS \
  -DSCR_PROF_STACK_SIZE_MIN=1296 -DSCR_PROF_STACK_SIZE_MAX=1352 \
  -DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376 \
  -include tests/perf/heapcensus/scr_heap_census.h" \
node packages/cli/dist/main.js build tests/perf/zapo-rest/app182/zapo-rest.ts \
  -o <out>/zapo-rest-182.exe --provenance-sources --keep-c

# three arms, ~3.5 min each
h2-rig.sh main
h2-rig.sh nocache ZAPO_SQLITE_CACHE_KB=0
h2-rig.sh half    CONVS=200
```

**GNU tar must precede System32's on `PATH`.** `bsdtar` rejects
`--force-local`, the provenance lane falls back to the island, and the build
reports 64 refusals inside zapo-js that are the fallback's and not the lane's.
That failure cost 8 seconds here because it is loud; it is in the recipe so it
costs nobody else more.
