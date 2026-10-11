# The peak heap is 81.9% BUSY, and three of its four largest occupants are gone by shutdown

> **What this answers.** `pagecensus/evidence-fr2/manifest.txt` closes with
> *"The largest OCCUPANT of the stackless arm's 53.438 MiB of CRT heap is NOT
> MEASURED … the in-process census can name it, but it reports ONCE, at
> shutdown, so it measures the settled idle and not the peak — and every
> committed census arm it has is a FIBER-lane binary."* This slice measures it.
>
> **The answer: the 64 KiB arena chunk, 294 blocks, 41.5% of the peak's busy
> bytes — and it is a container of live data, not a defect.** The result that
> matters more is the one beside it: at the peak the heap is **81.9% busy**,
> and **42.6% of those busy bytes belong to three classes that do not exist at
> shutdown at all.** A shutdown census does not under-rank them. It reads them
> as zero.

Measured on `fr2-peak-occupant` at `5fa7a24f8`, program
`tests/perf/zapo-rest/app182/zapo-rest.ts` (zapo-js 1.8.2, provenance lane),
zig 0.16.0, `x86_64-windows-gnu`, **LLVM lane, STACKLESS, knob ABSENT**, sqlite
store. Load `CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60` — the
fr1 dial set, which is the one the 53.438 MiB was taken on. Four runs of one
binary, ABBA. Everything below is in `evidence-peak/`.

## 0. Why no existing census could be used, and why the stated reason was wrong

The brief disqualified every committed census on two grounds. Both hold. The
**mechanism** given for the second does not.

**Ground 1 — the instant — is confirmed, and it is worse than stated.** Not
"a shutdown ranking is a different ranking": three of the four largest peak
occupants have **no row at all** at shutdown (§2).

**Ground 2 — the lane — is confirmed by identity but NOT by its stated cause.**
The brief says the build *"inherited `SCRIPTC_STACKLESS=0` from the recipe"*.
`G:\blocks\sa2-build.sh` never sets the knob — `rg -c` reads 0 there and 4 in
`fr1-build182.sh`, which is the positive control for the same `rg`. The real
cause is that **`G:\scriptc`'s `dist/` predates the stackless lane**:
`packages/compiler/dist/ir/coro-plans.js` does not exist, `rg -l
SCRIPTC_STACKLESS packages/*/dist` reads **0 files** against **8** in a fresh
worktree, `dist/backend` is dated 2026-09-14 and the default flip `8f4100d7a`
is 2026-10-09 — and `8f4100d7a` is an ancestor of both `main` and the `sa`
build's head. Proved on an artefact, one 10-line async program, both ways:

| dist | knob | `lane.ll` | `scr_fiber` refs | lane |
|---|---|---:|---:|---|
| fresh worktree | ABSENT | 13,551 | 0 | **STACKLESS** |
| fresh worktree | `0` | 9,736 | 3 | fiber |
| `G:\scriptc` | ABSENT | 9,736 | 3 | **fiber** |
| `G:\scriptc` | `0` | 9,736 | 3 | fiber |

Both programs print `9`. **main's dist does not read the knob at all.** So a
differential run taken entirely from `G:\scriptc` sets `SCRIPTC_STACKLESS=0`
to get its fiber *reference* arm, gets fiber, and reads correct — while its
treatment arm is also fiber. It compares the lane with itself and reports
agreement. That is precisely the failure `coro-plans.ts:40-62` says the
opt-out was kept alive to prevent; the opt-out survived the flip and the stale
dist defeats it anyway. Full record in `evidence-peak/lane-dist.txt`.

**This binary's lane is proved by identity, not by argument:** its
`zapo-rest.ll` is **242,844,763 bytes, byte-identical** to `fr1-out/S-plain`,
the uninstrumented stackless subject whose peak *is* the 53.438 MiB. The fiber
arm is 229,342,757. The two lanes are 13.5 MB apart.

## 1. The instrument, and what it cost

`scr_heap_census.h` reported once, at `_Exit`, with no repeat mechanism of any
kind. The brief guessed it might already know how to fire more than once; it
does not — `scr_hc_reported` is a one-shot latch. But the brief's own third
option was the right one, and the reason is a property of the file rather than
a claim about care: **this census does not instrument the allocation path.**
No malloc interposition, no per-allocation table, no site key. Its entire
run-time cost is `.data` nothing touches until a walk. So a walk at the peak
can be made to allocate **nothing**, and it is:

* the walk itself is `scr_hc_walk`, **factored out so the peak snapshot and
  the shutdown report are the same code**, not two transcriptions;
* the heap-handle array is static, never `malloc`'d;
* the 137-block arm is **not** planted on a peak walk;
* nothing is formatted or written at trigger time — one set of tables serves
  both readings, the peak printed before the settled walk zeroes them.

**That the peak walk allocates nothing is a measured control, not a design
claim:** `HCSIZE 5113 137` is present and **`HCPKSIZE 5113` is absent** in
every armed run. The shutdown arm is in the shutdown table and in no peak
table.

The trigger is a poller thread reading `PrivateUsage` every 5 ms and
re-walking when the process sets a new high-water more than `STEP` above the
last snapshot. `PrivateUsage` is a **proxy** for the heap and the report
refuses to let that pass: `HCPKCOVER` prints the snapshot's own
`PrivateUsage` against the kernel's `PeakPagefileUsage`.

| | abba1A | abba4A |
|---|---:|---:|
| snapshot `PrivateUsage` | 58.422 MiB | 65.578 MiB |
| kernel `PeakPagefileUsage` | 58.688 MiB | 65.855 MiB |
| **coverage of the peak** | **99.55%** | **99.58%** |
| walks / polls | 50 / 9,036 | 51 / 9,100 |
| walk ms total / max | 110.0 / 4.38 | 118.8 / 5.32 |

110 ms of held `HeapLock` across a 143 s run is 0.077% of wall clock.
vmcensus's committed runs cover 99.85–99.96%; this is 0.3 points behind and in
the same class. **A 250 ms sampler would have missed it** — pmon's best sample
on abba1A reads 58.410 MiB against the kernel's 58.688.

### Footprint, measured off the PE against the uninstrumented subject

`fr1-out/S-plain` has the **same `packages/compiler/src` and
`packages/runtime/src` tree hashes** (`231efb466` / `6a19e80ea`) as this build
and differs only by `SCRIPTC_PROF_CFLAGS`, so the section diff is the
instrument and nothing else:

```
.text   +922,464   .rdata  +532,580   .data  +785,600   SizeOfImage  +2,256,896
```

`.data` **+785,600 B** against **786,944 B** predicted from the header's own
declarations (two 16,384-row tables plus the heap array) — 99.83%.
**None of it is a CRT heap block**, which is why the tables are not measuring
themselves: vmcensus charges `.data` to IMAGE cow-taken, not to the CRT HEAP
term being ranked.

### Did the instrument move the peak it measures

Four runs of ONE binary, ABBA, armed vs `SCR_HEAPCEN_PEAK_OFF=1`:

```
abba1A  ARMED  peakPagefile 58.688      abba3B  OFF    peakPagefile 65.730
abba2B  OFF    peakPagefile 57.387      abba4A  ARMED  peakPagefile 65.855
```

Arm contrast **+0.713 MiB (+1.2%)**, same sign in both adjacent pairs. But the
**position step is 7.76 MiB — nearly eleven times the arm effect** — and it is a step,
not a drift, so ABBA does not cancel it. **n=2 per arm cannot resolve 0.7 MiB
against that, and this is reported as a bound, not as a measurement.**

The stronger statement available is a distributional one: this instrumented
binary peaks over **57.39–65.86 MiB** (n=4) and the clean `S-plain` binary
peaks over **56.68–65.02 MiB** (n=3, vmcensus v1/v2/v3). The instrument did
not move the process into a different regime — and §3 shows the two modes are
the same two modes, for a reason.

## 2. The ranking

**DENOMINATOR, said once and then on every line: `HCPKTOTAL bytes` — the CRT
heap's BUSY bytes in THIS INSTRUMENTED BINARY at the snapshot instant.** It is
**not** 53.438 MiB and no figure here is that figure. `WHICH-BUFFER.md` §5
forbids quoting a commit or RSS number from an instrumented binary and that is
kept: what is quoted here are **counts, exact sizes and shares**.

### abba1A — denominator 46,433,872 B = 44.283 MiB of CRT busy

| size | blocks | bytes | share of busy | at shutdown |
|---:|---:|---:|---:|---|
| **65,536** | **294** | 19,273,136 | **41.51%** | 164 blocks |
| 4,376 | 1,702 | 7,870,048 | 16.95% | **row absent** |
| 1,048,576 | 6 | 6,291,456 | 13.55% | **row absent** |
| 934,576 | 6 | 5,607,552 | 12.08% | **row absent** |
| 128 | 6,389 | 920,016 | 1.98% | |
| 8,192 | 79 | 648,432 | 1.40% | |

`abba4A`, a run in the other mode, reproduces it: 65,536 at **40.09%**, 4,376
at 15.56%, 1,048,576 at 13.64%, 934,576 at 12.16% — same four, same order,
shares within 1.4 points, with block counts 329 / 1,810 / **7** / **7**.

**The peak heap is 81.90% BUSY** (46.45 MiB busy against 10.27 MiB free, of
54.09 MiB committed). At shutdown the same heap is **46.2% busy** (15.19 MiB
against 17.70 MiB free). **The settled fragmentation is the residue of the
decline, not the cause of the peak.** `MEMORY`'s line that retention is
CRT-heap fragmentation remains true *of the settled state* and must not be
carried to the peak.

## 3. The largest occupant, with mechanism

**`HCPKSIZE 65536` is the two arenas' chunks, and nothing else of consequence.**

* `packages/runtime/src/scr_cycle.c:1546`, inside `scr_cyc_ar_new`
  (`:1528`): `raw = (unsigned char *)malloc(SCR_CYC_ARENA_CHUNK)` with
  `SCR_CYC_ARENA_CHUNK` = `(size_t)64 << 10` at `:289`. Reading the function
  matters: the `malloc` is the **fallback**, taken only when
  `SCR_CYC_VM_ON()` is false — and `SCR_CYC_ARENA_VM_DEFAULT` is 0
  (`scr_cycle.c:411-413`), so on the shipping arm every chunk is a CRT heap
  block of exactly 65,536 bytes. That is why `HeapWalk` can see them at all.
* `packages/runtime/src/scr_string.c:820`, `scr_str_chunk_alloc`:
  `malloc(SCR_STR_ARENA_CHUNK)`, also `64 << 10` (`:643`).

**Corroborated by an independent counter.** `cycstat` counts chunks in the
arenas themselves, never through the heap:

| | cycstat | heapcensus | |
|---|---:|---:|---|
| at shutdown | `held=114` + `strarena held=46` = **160** | `HCSIZE 65536` = **164** | 4 apart |
| high-water | `peakheld=274` + 46 = **320** | `HCPKSIZE 65536` = **294** | see below |

The shutdown pair agrees to 4 blocks — the heap also holds a handful of
65,536-byte blocks that are not arena chunks. The peak pair differs by 26 **in
the expected direction**: `peakheld` is the cycle arena's own *continuous*
high-water, while the snapshot is one instant chosen by a *process-wide*
commit proxy, and the two high-waters need not coincide. The snapshot cannot
exceed the continuous counter, and it does not.

**THIS IS A NULL AND THE NULL IS THE RESULT.** The 64 KiB row is a
**container**, not an object class: its bytes are the arenas' backing store
and what is inside them is collected objects and interned strings.
`pagecensus` already measured the occupancy of exactly these chunks at
**0.6293 live**, and the ceiling on anything a per-page reclaimer could return
from them is **2.2–2.3 MiB**. The largest occupant of the peak heap is mostly
live data in a container that already returns its free pages. *Occupied is not
a defect* and no target is being forced here.

One thing the arenas *do* hand over, and it is already known: `cycstat`
reports `strarena NO CHUNK EVER FREED` — **46 chunks, 3,014,656 B = 2.875
MiB, held for the life of the process**, with the reclamation path inert.
That is `OWNER-131079.md`'s territory, not new here, and it is 6.5% of the
peak's busy bytes.

## 4. The three classes a shutdown census reads as zero

This is the part no previous instrument could reach.

**4,376 — SQLite's page cache. 1,702 blocks, 16.95% of peak busy, ABSENT at
shutdown.** `WHICH-BUFFER.md` §2 established the class completely
(`pcache1Alloc`, `4096 + 216 + 56 + 8`, one buffer per database page) and
concluded *"It is never freed … the population is monotonic."* **That is now
false on main, and the mechanism is dated and named:**
`scr_async.c:2574-2575` defaults `SCR_SQLITE_IDLE_RELEASE_MS` to **1000**, so
the cache is released after one second of idle and the run idles 60 s before
shutdown. The §2 reading was taken before that default landed. The class is
not retention at rest any more; **it is a peak occupant**, and only a peak
census can see it.

**1,048,576 × 6 and 934,576 × 6 — 25.6% of peak busy, both ABSENT at
shutdown.** The counts are not incidental, and the run's own phase trace
identifies them:

```
abba1A  chunk-decoded-1 20.995 | 2..7 all within 6 ms at 27.68 | 8 at 28.408
abba2B  chunk-decoded-1 20.979 | 2..7 all within 4 ms at 27.54 | 8 at 28.230
abba3B  chunk-decoded-1 20.972 | 2..8 all within 5 ms at 29.27
abba4A  chunk-decoded-1 20.989 | 2..8 all within 4 ms at 29.31
```

All eight chunks are *sent* inside 191 ms; the client holds them and decodes
them in one burst. **In the low-mode runs six chunks decode together and the
armed census reads 6 and 6; in the high-mode runs seven decode together and the
armed census reads 7 and 7.** (`abba3B` is an OFF arm and has no peak table,
so the seven-chunk burst is read there from the trace alone.) The peak sits at **t = +25.95 s** on abba1A, inside
that window.

So **the bimodal peak on this workload is the number of history-sync chunks
held concurrently — six or seven** — and the difference is worth 1.98 MB in
this pair alone, plus 35 more arena chunks and 108 more cached database pages.
`MEMORY`'s "peak RSS is bimodal and the mode is POSITION" recorded the
phenomenon as a host property; on *this* load it has a mechanism in the
program. (The direction here is the opposite of that note's — the later runs
peaked higher — so this is a mechanism for these four runs, not a refutation
of that note.)

**WHAT IS NOT ESTABLISHED: the allocation SITE of the megabyte pair.** It is
not the array store — `scr_array.c:234-237` sets `SCR_ARR_VM 1` and
`SCR_ARR_VM_MIN 8192`, so **every array store of 8 KiB or more is VM-backed
and never reaches the CRT heap** (and the `reserved=15.992 MiB` bases in
vmcensus v3 are those 16 MiB reservations, `SCR_ARR_VM_RESERVE`). Naming the
site needs the `scr_prof.h` stack lane, which is a second build and a second
slice. **A size and a count and a timing is what this run can be asked for.**

## 5. Reproduce

```sh
sh tests/perf/heapcensus/run.sh check      # 5 arms, seconds, incl. the negative
SCRIPTC_PROF_CFLAGS="-include <repo>/tests/perf/cycstat/scr_cyc_stat.h \
  -DSCR_CYCSTAT_ON \
  -include <repo>/tests/perf/heapcensus/scr_heap_census.h -DSCR_HEAPCEN_PEAK" \
node packages/cli/dist/main.js build tests/perf/zapo-rest/app182/zapo-rest.ts \
  -o <out>/zapo-rest-182.exe --provenance-sources --keep-c     # 530 s
# then memrig with SCR_HEAPCEN_PEAK_STEP_KB=512; SCR_HEAPCEN_PEAK_OFF=1 is the
# null arm and lives in the SAME binary.
```

**BUILD FROM A WORKTREE WHOSE `dist/` IS FRESH.** §0 is not a footnote: built
from `G:\scriptc` this recipe silently produces a fiber-lane binary.

**AND THE RECIPE ABOVE DID NOT COMPILE UNTIL THIS SLICE.** `scr_cyc_stat.h`
interposes `_Exit` (`:274-281`); `scr_heap_census.h` asserted it *"registers
an atexit handler only"* and had chain branches for `SCR_CYCEN_ON` and
`SCR_PROF_H` and none for `SCR_CYCSTAT_ON`, so its own **HOW TO USE IT** block
hit `#error "another header already interposes _Exit"` on the first mbedtls
vendor unit — four minutes into a build, on the stock tree at `5fa7a24f8`. It
is the **second** time the documented chain order here was a compile error
rather than a composition (`WHICH-BUFFER.md` §0 is the first, and its repair
added the two branches that are present and not the one this file's own usage
block names). The branch is added, the false sentence is corrected in place,
and `run.sh check` now compiles the documented composition **and** a negative
arm proving an unknown interposer is still refused by name — five arms in
seconds instead of four minutes.

---

> ## RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY
>
> **The line this band answers.** In section *"abba1A — denominator 46,433,872
> B = 44.283 MiB of CRT busy"*:
>
> > "54.09 MiB committed). At shutdown the same heap is **46.2% busy** (15.19
> > MiB"
>
> **The 54.09 MiB is `busy + free` of all heaps at the peak** — it is read
> straight off `abba1A.score.txt`'s line *"AT THE PEAK.  CRT committed
> (busy+free, all heaps) = 54.093 MiB"*, which this retraction bands in that
> file too. It is heap ADDRESS SPACE, so **81.9% busy** and **46.2% busy** are
> ratios of bytes to address space, not occupancy of paid memory. The ordering
> peak-vs-shutdown may survive; the two levels are not occupancies.
>
> **What this band does NOT disturb, and it is the file's spine.** Section *"2.
> The ranking"* states its denominator once and then on every line:
>
> > "**DENOMINATOR, said once and then on every line: `HCPKTOTAL bytes` — the
> > CRT"
>
> `HCPKTOTAL bytes` is **CRT busy**. Every ranked share in this file is
> busy-over-busy and is untouched by this retraction.
>
>   THE REFUTATION, by section and quoted sentence.
>   tests/perf/heapcensus/COMMITTED-FREE-RETRACTION.md, section
>   "1. The mechanism, demonstrated and not inferred":
>
>       "The NT heap decommits pages inside a free run without splitting that
>        run into a `PROCESS_HEAP_UNCOMMITTED_RANGE`, so `HeapWalk` keeps
>        reporting the whole block."
>
>   with a NEGATIVE CONTROL in the same table -- the arm that frees nothing
>   reads free >= 64 KiB as 0.961 MiB, 100% MEM_COMMIT, 0.000 MEM_RESERVE --
>   and section "2. The arithmetic contention, same run, no second variable":
>
>       "the process's own HeapWalk in that run: busy 15.594 + free 21.651 =
>        37.245 / EXCESS 15.933 MiB that cannot be committed anywhere"
>
>   WHAT SURVIVES, AND IT IS MOST OF IT. The numbers above are still exactly
>   what HeapWalk reported, and `busy + free` is still a valid CEILING. `busy`
>   is unaffected -- it is live data. `uncommitted` is unaffected -- it is
>   reserved and not paid. IT IS THE SUM THAT BROKE, and only as a statement
>   about COMMIT. Nothing here is deleted and no physics is withdrawn.
>
>   SCOPE OF THIS BAND. It audits ONE figure. EVERY SECTION OF THIS FILE THAT
>   IT DOES NOT NAME IS UNAUDITED BY IT -- it is NOT thereby in force.
