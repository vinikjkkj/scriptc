# The 43 holes are mostly not committed, and the two instruments say so against each other

> **The question this file answers.** `tests/perf/heapcensus` reports, at rest,
> a free side of **17.1-21.7 MiB** in the CRT heap, of which **88.5-92.5% of
> the bytes sit in 41-55 blocks of >= 64 KiB**. A front was being designed
> against those blocks. This file measures the same thing from outside the
> process, in the same runs, and finds that the container they are supposed to
> sit in is **half the size of the claim** — and then reproduces the mechanism
> on a standalone arm with a negative control.

Nothing here is a rebuild of the subject. The subject binaries are reused, the
walker is a separate process, and the two controls are their own programs.

## 1. The contradiction, inside ONE run, with no second variable

`r3` and `r4` are the instrumented binary (`v3-out182-SL`, 7c7897307,
prof + heapcensus). Each wrote **both** its own in-process `HeapWalk` census at
shutdown **and** an external `VirtualQueryEx` series throughout. Same process,
same run, the external walk's last sample taken at process exit.

| run | kernel `PrivateUsage` at exit | external **private non-stack committed** | HeapWalk `busy` | HeapWalk `free` | `busy+free` | excess over the external total |
|---|---:|---:|---:|---:|---:|---:|
| r3 | 61.992 | **21.312** | 15.594 | 21.651 | **37.245** | **+15.933** |
| r4 | 62.789 | **22.109** | 15.175 | 17.458 | **32.632** | **+10.523** |

The external figure is not a competing estimate of the heap. It is **every
committed private page in the process** outside thread stacks — heap, arenas,
TEB/PEB, SQLite, everything. `busy+free` exceeds it by 10.5 and 15.9 MiB.
Those bytes cannot be committed, because there is nowhere for them to be.

The external walk is the one that has to close: its terms sum to the kernel's
own `PrivateUsage` to within 0.001 MiB in all 72 walks of this directory, with
`BASES DROPPED 0` in every one.

## 2. Where the instrumented binary's extra 40 MiB actually is — and it is not heap

At matched knobs (`Q`), at rest:

| term, MiB | CLEAN mean (r2,r5) | INSTR mean (r3,r4) | delta |
|---|---:|---:|---:|
| kernel `PrivateUsage` | 19.953 | 60.119 | **+40.166** |
| **CRT heap** | **17.494** | **18.961** | **+1.467** |
| STACK | 0.109 | 0.131 | +0.022 |
| private small bases | 0.156 | 0.480 | +0.324 |
| IMAGE cow-taken | 0.773 | 2.969 | **+2.196** |
| RESIDUE | 1.324 | 37.482 | **+36.158** |
| *(IMAGE still shared, not in private commit)* | 45.609 | 83.426 | *+37.817* |

**The heap is the same size in both binaries.** The instrument's whole cost is
`2.196 + 36.158 = 38.354 MiB`. The file-scope storage those two headers
declare is not estimated here — it is **compiled**, by `szprobe.c`, which
`-include`s both headers with the exact flag list `f2-build.sh:19` passes and
prints `sizeof` of each array (`szprobe.txt`):

```
sizeof scr_prof_tbl    [65536] x 88   (SCR_PROF_STACKS adds stk_want)   5,767,168 B
sizeof scr_prof_hist   [65536][40] x 8        (-DSCR_PROF_SIZEHIST)    20,971,520 B
sizeof scr_prof_exact  [1024] x 8             (-DSCR_PROF_SIZEHIST)         8,192 B
sizeof scr_prof_stk    [1<<17] x 96           (-DSCR_PROF_STACKS)      12,582,912 B
sizeof scr_hc_tbl      [16384] x 24                                       393,216 B
sizeof scr_hc_ftbl     [16384] x 24                                       393,216 B
sizeof scr_hc_runhist + scr_hc_runpg + scr_hc_pkheaps                       1,152 B
                                                        TOTAL  40,117,376 B = 38.258 MiB
```

**38.354 measured against 38.258 declared: 0.096 MiB apart, 0.25%.**

> **A CORRECTION TO THE NAMED CAUSE, and the compiler is the witness.** The
> previous reading of this delta named `scr_prof_ptbl[1<<21] x 24 = 48 MiB`.
> That array is inside `#ifdef SCR_PROF_LIVE` (`scr_prof.h:353-497`) and
> **`SCR_PROF_LIVE` is not defined by the build that produced these
> binaries**. This is not read off a flag list: `szprobe.c`'s first version
> asked for `sizeof(ScrProfPtr)` and the compile FAILED with
> `use of undeclared identifier 'ScrProfPtr'`. The type does not exist in that
> translation unit, so the array is not in the image. The kind was right —
> BSS, image-backed, nearly constant between peak and rest — and the member
> was wrong; the corrected arithmetic closes to 0.25% where the original was
> 25% high.

### Why it lands in RESIDUE: `ctl-bss.txt`, four runs, one knob

A 40 MiB file-scope array, nothing else in the program:

| touched | kernel `PrivateUsage` | working set | IMAGE cow-taken | RESIDUE |
|---:|---:|---:|---:|---:|
| 0 MiB | 40.617 | 3.82 | 0.246 | **40.125** |
| 10 MiB | 40.629 | 13.79 | 10.211 | 30.164 |
| 20 MiB | 40.617 | 23.75 | 20.172 | 20.195 |
| 40 MiB | 40.621 | 43.67 | 40.094 | 0.273 |

**The charge is identical in all four, including the one that never writes a
byte.** It is taken when the image is mapped. `vmcensus`'s copy-on-write rule —
`PAGE_WRITECOPY` means *not yet taken, still shared* — is correct about what is
PRIVATE and blind to what is CHARGED, so untouched BSS lands in the residue.
Touching it moves it into `IMAGE cow-taken` one page at a time, 1:1.

This also means the residue is **not** page tables in every arm.
`evidence-fr2`'s reading of a 40.867 MiB residue as page-table charge was about
a binary with 20,207 fiber stacks and no large BSS, and it is untouched by
this; but "RESIDUE = page tables" is not a general rule, and this directory is
where that is written down.

## 3. The mechanism: `HeapWalk`'s FREE column counts MEM_RESERVE

`heapsplit.c` asks the memory manager about the very blocks `HeapWalk` just
reported. One process, no subject, no inference. `ctl-heapsplit.txt`:

| arm | free >= 64 KiB | MEM_COMMIT | MEM_RESERVE | reserve share | `busy+free` vs `PrivateUsage` |
|---|---:|---:|---:|---:|---|
| 64 x 1,000,000 B, free **all** | 3.832 | 0.973 | 2.859 | **74.6%** | EXCEEDS by 2.343 |
| 400 x 200,000 B, free **all** | 7.944 | 0.499 | 7.445 | **93.7%** | EXCEEDS by 6.957 |
| 64 x 1,000,000 B, free **none** | 0.961 | **0.961** | **0.000** | **0.0%** | within, by 0.590 |
| 64 x 1,000,000 B, free **every 2nd** | 27.721 | 2.030 | 25.691 | **92.7%** | EXCEEDS by 25.113 |

> **The third row is the negative control and it is the one that makes the
> other three mean something.** When nothing has been freed, every byte
> `HeapWalk` calls free really is committed and `busy+free` fits inside the
> kernel's charge. The detector is not biased; the heap state is different.

The fourth arm is the subject's shape — half the blocks live, half freed,
interleaved, `busy` ~30 MiB and `free` ~27.7 MiB in 29 large blocks — and
**92.7% of that free is address space the process has already given back**.

The NT heap decommits pages inside a free run without splitting the run into a
`PROCESS_HEAP_UNCOMMITTED_RANGE` entry, so `HeapWalk` keeps reporting one large
free block at its full extent. A census that sums `cbData` over free entries
is summing address space, not commit.

## 4. The answer, with the denominator

The shipped binary (`3c462de14`, 32,034,304 B), at rest, q-knobs, **pays
17.1-18.2 MiB** across *all* private non-stack memory (`DECOMP-REST.txt` §2;
a-knobs 19.6-19.9 MiB). Against that container:

* the claim is **15.17 MiB of committed free in 43 blocks** (q1), reproduced
  here as 15.29 MiB in 41 blocks (r4) and 19.71 MiB in 48 blocks (r3);
* the same instrument reads **`busy` = 15.1-16.3 MiB** in the same heap, and
  the busy column is the half that has to be committed, because the program
  writes to those blocks;
* `15.17 + 15.11 = 30.28 MiB` **does not fit in 18.18 MiB.**

So an upper bound on committed free in the shipped binary at rest is
`container - busy`, and two independent routes agree on its size:

```
route 1, from the container   18.180 - 15.114  =  3.07 MiB   (r2 vs q1 busy)
                              17.117 - 15.175  =  1.94 MiB   (r5 vs r4 busy)
route 2, from the reserve share measured in heapsplit's matched arm
                              15.17 x (1 - 0.927) =  1.11 MiB
                              15.17 x (1 - 0.746) =  3.85 MiB  (weakest arm)
```

**Committed free in the shipped binary at rest is of order 1-4 MiB, not 15-17.
The 43 large holes are four to fifteen times smaller than priced, and most of
what was priced is address space the OS already has back.**

The front's `A1` design (`tests/perf/placement`, `ScrBytes::data` out of the
CRT heap) was aimed at exactly those blocks. **Its target is 1-4 MiB of a
17-18 MiB process, not 15 MiB** — and the part the heap has already returned
cannot be returned twice.

### The heap has already given back more than it holds

Same walks, same instant, summed over the heap's own allocation bases:

| run | arm | heap committed | heap reserved-not-committed | address space | committed share |
|---|---|---:|---:|---:|---:|
| r1 | CLEAN a | 19.461 | 28.164 | 47.625 | 40.9% |
| r2 | CLEAN q | 18.070 | 29.554 | 47.624 | 37.9% |
| r5 | CLEAN q | 16.917 | 30.707 | 47.624 | 35.5% |
| r3 | INSTR q | 18.003 | 29.621 | 47.624 | 37.8% |
| r4 | INSTR q | 19.918 | 27.708 | 47.626 | 41.8% |

The heap's address space is **47.62 MiB in every run to within 0.002 MiB**, and
only a third of it is paid for. That 29-31 MiB is what the in-process census
splits into `free` and `uncommitted` — and it puts far too much of it on the
`free` side.

## 5. What would actually settle the split, and what it costs

Not a heapcensus-only build. Its statics are cheap — **787,584 B of arrays,
0.751 MiB**, compiled not estimated (`szprobe.txt`) — so the arm is
affordable, but it would
reproduce the same `free` column this file refutes, on a different revision,
with its own 0.671 MiB self-test arm inside the busy figure.

The instrument that settles it is `heapsplit.c`'s `classify()` folded into
`scr_heap_census.h`: for each free entry, one `VirtualQuery` on its own
address, and report free as **committed / reserved** instead of as one number.
It costs one `VirtualQuery` per free block (14,000-16,000 of them, sub-ms
total) and one rebuild of the subject. Until that exists, **the free column of
every heapcensus artifact in this repo is an upper bound on committed free and
not a measurement of it.**

## 6. Against the design that ordered this file

1. The brief predicted the instrumented binary's heap would be ~15 MiB larger
   and that the clean one would therefore have no room for the holes. **The
   heap is the same size in both** (17.494 vs 18.961 at matched knobs). The
   conclusion survives and the stated reason for it was wrong: the holes are
   absent from the *instrumented* binary too.
2. The brief expected the instrument's cost to show up as `IMAGE cow-taken`.
   **It shows up as RESIDUE** — 36.158 of 38.354 MiB — because the pages are
   charged and untaken, and `ctl-bss.txt` is the arm that makes that visible.
3. The brief priced the SQLite idle-release knob at ~11.6 MiB of rest commit.
   **It is worth 2.15 MiB** on this column at this instant.

   > ***RETRACTED 2026-10-11 — item 3 is an A/A.*** The a-knob and q-knob arms
   > are the **same configuration of the same binary**. `f2b-run.sh:39-40`
   > differ only by `SETTLE_MS`/`PRESYNC_MS` — whose `memrig.mts:108` defaults
   > are the identical **45000 / 20000**, so arm `A` takes them anyway — and by
   > `SCR_SQLITE_IDLE_RELEASE_MS=1000`, which `scr_async.c:2574-2575`
   > **compiles in at 1000**, `:2603-2615` overriding it only when the env var
   > exists (`:2609`); passing `=1000` writes the value already held. There is
   > no `-DSCR_SQLITE_IDLE_RELEASE_MS` anywhere in the tree (swept with a
   > positive control). `SCR_SQLITE_IDLE_STAT=1` gates nothing but the two
   > `fprintf(stderr,…)` at `scr_sqlite.c:434,442`. And `054c543d2` — *"the
   > SQLite idle page-cache release ships ON"* — is an **ancestor** of
   > `3c462de14`, the clean binary's commit, so the seam was armed in both
   > arms before either ran.
   >
   > **The −2.15 MiB is the within-cell spread of one n=4 population**:
   > 19.461 / 18.070 / 16.917 / 19.835 MiB, amplitude **2.918 MiB**, cut into
   > two pairs and differenced. **The brief's ~11.6 MiB is not restored
   > either** — the **commit** value of this seam at rest is **UNMEASURED**,
   > because the seam's only genuine A/B (`IDLE-RELEASE.md`) reads the `busy`
   > column and `busy+free` was revoked as the bridge to commit (`31c413ccf`,
   > merged `f6641b533`). Full band, and the second carrier of the same family
   > — `WHICH-BUFFER.md:224-241`, the `nocache` arm that was an A/A because
   > `ZAPO_SQLITE_CACHE_KB=0` falls through to the compiled-in
   > `-DSQLITE_DEFAULT_CACHE_SIZE=-16000` — in `DECOMP-REST.txt` §2.
   >
   > **One adjacent figure, named because the sweep for this one found it.**
   > `:42`'s row *"| **CRT heap** | **17.494** | **18.961** | **+1.467** |"* and
   > item 1's *"17.494 vs 18.961 at matched knobs"* take `17.494` as the mean of
   > the two q draws. That is a **clean-vs-instrumented** contrast across two
   > different binaries, so it is a genuine A/B and is **not** retracted here.
   > But the `+1.467` delta is **smaller than the 2.918 MiB amplitude** of the
   > clean arm's own four draws, so it is not resolved at this n and must not be
   > quoted as the instrument's measured rest-heap cost. Item 1's *conclusion* —
   > that the heap is the same size in both — is untouched, and if anything that
   > is what noise exceeding the delta supports.
   >
   > **Items 1, 2 and 4 of this section are UNAUDITED, not thereby valid**;
   > this band read item 3 only. All of it is the **Win32 instrument** — there
   > is no allocator-accounting surface outside `#ifdef _WIN32` to carry the
   > same defect, which is not a claim that the figure holds on macOS or Linux.
4. The brief's own named doubt — *"several of those 43 holes exceed the NT
   heap's ~508 KiB `VirtualMemoryThreshold`, so in the clean binary they may
   already be going back to the OS by themselves"* — is **right in outcome and
   wrong in binary**: they are going back in both, and the threshold is not the
   route. The route is segment decommit that `HeapWalk` does not report.
