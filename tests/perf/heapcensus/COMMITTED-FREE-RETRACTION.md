# `busy + free` is NOT committed memory — the whole-front retraction, 2026-10-11

**What is retracted is a COLUMN READING, not a measurement.** Every `busy`,
`free` and `uncommitted` number this front ever printed is still exactly what
`HeapWalk` reported. What dies is the *sum* `busy + free`, and every name this
front gave it: `committed`, `CRT committed`, `pkAllCommitted`,
`committed-free`, `committed-but-free`, `free-but-committed`, and the briefing
rule *"`busy + free` = what the process PAYS"*.

## 1. The mechanism, demonstrated and not inferred

`heapsplit.c` (branch `f2b-rest-decomposition`, `cdf1566b4`,
`tests/perf/heapcensus/evidence-rest/heapsplit.c` — **not yet on `main`**) asks
`VirtualQuery` about the pages of every free block `HeapWalk` reports:

| arm | free >= 64 KiB | `MEM_COMMIT` | `MEM_RESERVE` |
|---|---:|---:|---:|
| **nothing freed (NEGATIVE CONTROL)** | 0.961 MiB | **0.961** | **0.000** |
| 64 x 1,000,000 B, all freed | 3.832 | 0.973 | 2.859 (74.6%) |
| 400 x 200,000 B, all freed | 7.944 | 0.499 | 7.445 (93.7%) |
| half live, half freed | 27.721 | 2.030 | 25.691 (92.7%) |

**The negative control is what gives the other three meaning.** With nothing
freed the `free` column is 100% committed and `busy + free` fits inside what
the kernel charges. The detector is not biased; the heap state is different.
**The NT heap decommits pages inside a free run without splitting that run into
a `PROCESS_HEAP_UNCOMMITTED_RANGE`, so `HeapWalk` keeps reporting the whole
block.** Summing `cbData` over free entries sums **address space**, not commit.

## 2. The arithmetic contention, same run, no second variable

Same process, same instant, two instruments:

```
r3  kernel PrivateUsage 61.992 MiB
    ALL private non-stack COMMIT resolved from outside (VirtualQueryEx): 21.312
    the process's own HeapWalk in that run: busy 15.594 + free 21.651 = 37.245
    EXCESS 15.933 MiB that cannot be committed anywhere
r4  22.109 from outside against 32.632 from HeapWalk     EXCESS 10.523 MiB
```

A number that exceeds the kernel's own charge for the whole process is not a
charge. (Source: branch `f2b-rest-decomposition`, `cdf1566b4`,
`tests/perf/heapcensus/evidence-rest/`.)

## 3. What survives, column by column — the distinction that matters

| column | status |
|---|---|
| `busy` | **LIVE DATA, unaffected.** Still the user-requested bytes of live blocks. |
| `free` | **Still exactly what `HeapWalk` reported, and still a valid CEILING on free-and-committed.** It is no longer a commit figure: it mixes committed pages with pages the NT heap already returned without saying so. |
| `uncommitted` | **Unaffected.** Still reserved-and-not-paid. |
| **`busy + free`** | **RETRACTED AS COMMIT.** Still a valid ceiling, and still a correct statement about `HeapWalk`'s own output. |

**It is the SUM that broke, not the three columns.** No figure below is deleted
and no physics is withdrawn; the number stays, the interpretation goes.

Two corollaries that bite harder than they look:

* **A ratio `busy / (busy + free)` is a ratio of two different things.** The
  numerator is bytes; the denominator is address space. The ordering such a
  ratio induces between two arms may still hold — the *level* does not.
* **A delta on `busy + free` between two arms is a delta in address space.**
  It can move with zero change in what either arm pays, and it can stay flat
  while what they pay moves.

## 4. Where the shipped binary's rest commit actually stands

Measured from outside, on the shipped (uninstrumented) exe at rest: the whole
process pays **17.1-18.2 MiB** of private non-stack commit, of which
`HeapWalk` calls **15.1-16.3 MiB** `busy`. Committed hole in the shipped
binary at rest is therefore of order **1-4 MiB**, not the 15-17 MiB the `free`
column reads. The heap's **address space** is 47.62 MiB in all six runs and
only **30-42% of it is paid**.

## 5. THE INVENTORY — every carrier of the figure in `tests/perf/`

Found by a normalised, wrap-collapsing sweep of all 2,896 text files under
`tests/perf/`. The sweep was positive-controlled against `DECOMP-ON.md:320`, a
known carrier, before any null was trusted.

### 5a. Banded by this slice (append-only band at end of file)

| file | the line that carries it |
|---|---|
| `heapcensus/evidence-peak/abba1A.score.txt:28,67` | `AT THE PEAK.  CRT committed (busy+free, all heaps) = 54.093 MiB` |
| `heapcensus/evidence-peak/abba4A.score.txt:28,67` | `AT THE PEAK.  CRT committed (busy+free, all heaps) = 61.183 MiB` |
| `heapcensus/evidence-peakvar/RESULTS.txt:146,197` | `pkAllCommitted = HCPKHEAPS busy + free`; `DENOMINATOR, NAMED: busy+free of the SAME walk` |
| `heapcensus/evidence-peakvar/PEAK-VARIANCE.md:69,93` | `peak committed ... -28,972,293`; `That is CRT heap committed at the peak` |
| `heapcensus/evidence-postfix/sb.compare.txt:48,51` | `a committed total (busy + free) of -8.244 MiB`; `8 MiB more free-but-committed heap` |
| `heapcensus/evidence-postfix/LANE.txt:267,329` | `-7.9 MiB of free-but-committed heap` |
| `heapcensus/evidence-lane/RESULTS.txt:57,90,115` | the `committed` column; `committed  ... -12932763 ... YES` |
| `heapcensus/evidence-lane/LANE-VARIANCE.md:101,124` | `columns that do cross 4.303 — free, committed, busyBlocks, freeBlocks` |
| `heapcensus/evidence-variance/RESULTS.txt:37,123` | the `committed` column and `busy+free+unc` |
| `heapcensus/evidence-variance/VARIANCE.md:1,19,46,121` | title `The committed heap does not move the way one pair said it did` |
| `heapcensus/evidence-variance/PREREG.txt:29` | `P2  committed (busy + free) of the POST arm is FLAT OR HIGHER` |
| `heapcensus/evidence-chunkref/RESULTS.txt:125,131,140,146` | the `pkAllCommitted` and `committed` rows |
| `heapcensus/PEAK-OCCUPANT.md:166` | `54.09 MiB committed` |
| `placement/RESULTS.md:331` | `share of committed-free bytes` |
| `boxanat/README.md:430,446` | `not of the 72.84 MiB committed-but-free`; `settled committed-free` |

### 5b. Code that MANUFACTURES the figure — banded with a trailing comment

| file:line | the expression |
|---|---|
| `heapcensus/evidence-variance/stats.mjs:42,138` | `committed:+m[1]+ +m[3]` |
| `heapcensus/evidence-lane/lane-stats.mjs:48,221` | `committed:+m[1]+ +m[3]` |
| `heapcensus/evidence-peakvar/peak-stats.mjs:66,69` | `pkAllCommitted: +ph[2] + +ph[4]`, `committed: +m[1] + +m[3]` |
| `heapcensus/evidence-chunkref/chunkref-stats.mjs:49,55` | `pkAllCommitted: +ph[2] + +ph[4]`, `committed: +m[1] + +m[3]` |
| `settled-census/plateau.mjs:86,101` | `['CRT heap committed-FREE', M.crtFree, ...]`, summed into a commit itemisation |
| `settled-census/reconcile.mjs:460,482` | `the heap holds MORE committed-free than busy` |
| `pagecensus/vmheap.c:7,142` | `a heap that is 95% committed-but-free`; `(busy + freeb)` |
| `placement/placement.c:46,362` | `COMMITTED-FREE blocks and bytes` |

### 5c. Carriers this slice deliberately did NOT band, with the reason

* **`heapcensus/scr_heap_census.h:7,177,258,310,728`** (`72.84 MiB ... committed-but-free`,
  `contiguous committed free bytes`). **NOT EDITED ON PURPOSE.** Seven
  `*.build-env.txt` across this front record `hdr-sha` as the SHA of this
  header; any byte appended to it invalidates every one of those provenance
  records, and a later edit cannot undo that. The figure it carries is
  retracted by *this* file, which is the band for it. **Editing this header is
  a separate, provenance-aware decision and is not one a document-repair slice
  may take.**
* **`heapcensus/DECOMP-ON.md:320` (`committed = busy + free`) and
  `heapcensus/HOLEMAP.md`.** A sibling slice banded both on branch
  `f2b-rest-decomposition` (`cdf1566b4`). **They are NOT banded on `main`.**
  Banding them here too would put two independent bands on one file and turn a
  merge into a conflict in exactly the file that most needs to read cleanly.
  **Whoever merges these two branches must confirm the sibling's band landed;
  until that merge, `main`'s `DECOMP-ON.md:320` carries the figure with no
  marker at all.** Note also that `DECOMP-ON.md:110` reads *"Nothing in this
  file is retracted"*, which is now false for its section *"Sixty percent of
  what was freed left the committed heap"*.
* **`heapcensus/holemap.c:4`, `heapcensus/fragment-control.ts:4`.** Both quote
  the 72.84 MiB from `scr_heap_census.h` as a motivating header comment, not as
  an output of their own. They are covered by the header entry above; a band of
  their own would duplicate it without adding a pointer.
* **`memmap/scr_memmap.h:400`, `memmap/mmreport.mjs:115`.** `memmap`'s
  `committed` column is `PROCESS_HEAP_REGION.dwCommittedSize`, an
  **independent** column, not `busy + free`; its slack arithmetic
  (`committed - busy - overhead`) therefore does not rest on the retracted sum.
  Only the label `free, committed` at `mmreport.mjs:115` repeats the reading,
  and `dwCommittedSize` has not been measured against `VirtualQuery` here.
  **Asserting that `memmap` is wrong would be a figure this slice did not
  measure.** Recorded as UNMEASURED, not as sound.
* **`heapcensus/evidence-lane/_append-bands.py:141`.** This is an earlier
  slice's band writer, and the phrase `-7.9 MiB of free-but-committed heap`
  appears in it only as a **quotation** inside a band it writes into
  `evidence-postfix/LANE.txt` — under that band's own heading *"The lines this
  band answers"*. The claim it quotes is banded at its source, in `LANE.txt`.
  **Banding the quoting mechanism instead of the claim is the "wrong file"
  failure, and this is its mirror image;** re-running that script re-emits a
  quote that is already marked where it lives.
* **`heapcensus/HOLEMAP.md`.** The phrase sweep does **not** flag this file: it
  states its denominator as `heap 0 CRT free`, never sums `busy + free`, and
  never calls the free column committed. Its exposure is the inherited
  `72.84 MiB` it divides by, which originates in `scr_heap_census.h:177`. The
  sibling slice banded it anyway on `f2b-rest-decomposition`; **this slice
  neither re-bands it nor claims it was owed one.**
* **Every `*.heapcen.txt`, `*.census.txt` and `*.manifest.txt`.** These are raw
  instrument output. They print `busy=`, `free=` and `uncommitted=` as three
  separate fields and never sum them. **Nothing in them is retracted** — they
  are the evidence the retraction itself rests on.

## 6. The method rule that must not survive this file

A recurring briefing template states, textually, **"`busy + free` = what the
process PAYS"**. **That rule is refuted and must not be carried into another
slice.** The replacement, stated positively:

> **At rest and at peak, the only sound commit figure for this front is
> `PrivateUsage` / `privateCommit` read from OUTSIDE the process, decomposed by
> `VirtualQueryEx` per allocation base.** `HeapWalk` answers *what the heap's
> own bookkeeping believes*, which is a different question, and on the `free`
> column the two answers differ by 10-16 MiB in a 60 MiB process.
>
> A criterion that names `busy + free` is measuring address space. Say so, or
> change the criterion.

## 7. Scope of this file

This file audits **one figure**: the reading of `busy + free` as committed
memory. **Every other claim in every file listed above is UNAUDITED by this
slice — it is not thereby in force.** In particular this file makes no
statement about any `busy`-only figure, any t statistic, any power
calculation, any block count, or any conclusion those documents draw from
columns other than the sum.
