# `chunkcensus` — how full the arenas' chunks are, and what page decommit could ever return

Status: **the instrument is finished, self-tested and committed. It has not
yet been run against zapo-rest.** The numbers below are from the control
program only. They validate the arithmetic; they do not describe the
service, and nothing here should be quoted as if they did.

## The question, and why nothing in the tree could answer it

The cycle arena's chunk giveback (`71c3af87`) took settled working set from
163.39 to 104.50 MiB and chunks at exit from 1,053 to 160. Before it, the
arena held 1,053 × 64 KiB at **4% occupancy** — 72% of the settled heap was
empty space held open. The obvious next question is what the remaining 160
are made of, and it has no answer in this tree:

| instrument | what it sees | why it cannot answer |
|---|---|---|
| `cycstat` | chunks taken / released / held | counts, never a per-chunk `used` |
| `heapcensus` | exact-size histogram of busy blocks | a chunk is one 65,536-byte BUSY block whether it holds one live object or eight hundred |
| `cycensus` | live cycle objects by kind | sees the objects, not the chunks they sit in |
| `memmap` | every committed region, classed | resolves the chunk to class `HEAP` and stops |

So **"160 chunks at 90%, nothing to recover" and "160 chunks at 5%, 9 MiB
sitting there" are indistinguishable from every report that exists**, and
those two readings imply opposite decisions.

## What it costs to know: nothing but arithmetic

`ScrCycChunk` already carries `used`, `stride`, `bump`, `lim` and a
chunk-local free list. That is enough to place every live block to the byte.
No counter is added to any allocation path. What is added is a **registry**,
and that is a finding rather than an implementation detail.

### The cycle arena cannot enumerate its own chunks

A chunk that is neither its class's current chunk nor on `scr_cyc_ar_part[]`
is **full**, and a full chunk is on no list at all — `scr_cyc_ar_refill`:
*"It stops being the current chunk and goes on NO list."* Nothing in the
shipping runtime needs to walk chunks, so nothing keeps a list. **Any future
page-decommit pass would have to add exactly this registry first.**

### The string arena cannot free a chunk *even in principle*

This is the structural finding, and it was read off the source rather than
measured. `scr_string.c`'s `scr_str_ar_take`:

```c
unsigned char *k = (unsigned char *)malloc(SCR_STR_ARENA_CHUNK);
if (k == NULL) return NULL;
scr_str_ar_cur = k;
scr_str_ar_lim = k + SCR_STR_ARENA_CHUNK;
```

`k` is stored in two globals and **both are overwritten by the next chunk**.
The pointer `malloc` returned does not survive anywhere in the process, so
`free()` can never be called on it — not *is not*, **cannot be**. And
`scr_str_ar_give` pushes onto `scr_str_ar_free[class]`, which is **global per
size class rather than chunk-local**, so nothing could tell when a chunk had
emptied even if the pointer were kept.

`cycstat`'s counter set records the same fact by omission: the cycle arena
has `arfree`, the string arena has **no `sarfree`**, because there is no free
path to count. Every 64 KiB this arena takes is held until the process exits,
at whatever occupancy it happens to have. A third waste is counted
separately: when a request does not fit in `lim - cur` a whole new chunk is
taken and the remainder of the old one is **never carved and never
reachable** — `abandonedTailBytes`.

**The fix that was applied to the cycle arena was never applied to this one,
and on a workload whose retention is strings this is the arena that matters.**
How much it holds on zapo is not yet measured.

## The two cross-checks, which run on every snapshot of every run

Not only in an arm — an instrument whose numbers reconcile against the
allocator's own counters cannot report a confident wrong answer the way a
walk that only ever agrees with itself can.

1. `chunks × 64 KiB == scr_cyc_ar_held`. The arena maintains `held` for its
   budget check, on paths this census does not touch. A disagreement prints
   `regcheck=MISMATCH` instead of a total.
2. Per chunk, `used == carved - freeN`. `used` is the allocator's counter,
   `carved` comes from the bump pointer, `freeN` is **walked**. Three
   independent quantities, one identity. A chunk failing it is reported by
   index and excluded, so the totals are a stated floor rather than quietly
   wrong.

## The page ceiling is reported twice

* **ideal** — the chunk as 16 aligned 4 KiB pages. What it *would* get from
  `VirtualAlloc`.
* **real** — pages as they actually fall. `malloc` returns 16-byte alignment,
  so a 64 KiB chunk straddles 17 pages and only those wholly inside it are
  candidates. What the code could do **as it stands**.

Neither estimates what a decommit would return. Both are hard **upper
bounds**, computed from where the live objects actually are.

## The self-test is a discrimination test

Four arms of **one binary**. `x86_64-windows-gnu`, tree zig **0.16.0**, LLVM
tier — the build emits `occupancy-control.ll` and no `.c`, read off the
artifact rather than off the absence of a message.

| arm | chunks | held | live blocks | live bytes | on free lists | occupancy | page ceiling |
|---|---|---|---|---|---|---|---|
| dense (all 40,000 kept) | 72 | 4.50 MiB | 80,004 | 4.27 MiB | 160 B | **96.3%** | 4.2% |
| sparse (every 10th kept) | **72** | **4.50 MiB** | 8,004 | 0.43 MiB | **3.85 MiB** | **9.6%** | **4.2%** |
| clustered (first 10th kept) | **11** | **0.69 MiB** | 8,004 | 0.43 MiB | 0.06 MiB | 65.9% | **33.3%** |
| null (nothing allocated) | 3 | 0.19 MiB | 4 | — | — | — | — |

**Sparse and clustered retain an identical live population** — 8,004 blocks,
448,288 bytes — and differ only in *where the survivors sit*.

* Scattered, that population pins **72 chunks and 4.50 MiB**. Clustered, the
  same data pins **11 and 0.69 MiB**: a **6.5× difference in retained memory
  for identical live data**, because whole empty chunks are already handed
  back and only contiguous garbage produces them.
* The sparse arm holds **3.85 MiB on free lists inside chunks it cannot
  release** — 85% of its held bytes are free space.
* **Its page ceiling is 4.2%.** A chunk 90% free yields almost no *whole*
  free page, because one survivor in ten lands on every page. This is the
  same mechanism `scr_async.c`'s heap-trim note records for the CRT heap:
  *"one surviving allocation in twenty pins its whole LFH subsegment."*

That last row is why the **clustered** arm exists. A ceiling that read ~4%
for every input would be indistinguishable from a ceiling that was never
computed; the clustered arm makes the same arithmetic report **33.3%**, so a
scattered ~0 is a *result* and not a dead calculation. A check that can only
say "no" needs a control that makes it say "yes", exactly as one that can
only say "yes" needs the reverse.

**Read on the control only, and not yet on zapo:** if the service's retained
population is scattered — which is what a history sync leaves — page-level
decommit inside the cycle arena has a small ceiling, and the recoverable
memory is in *whole chunks*, reachable only by not scattering the survivors.
The number that settles this for zapo does not exist yet.

The string arena's half of the walk is exercised by the same controls: the
dense arm reports **1 chunk, 64 KiB held, 80 bytes live, 65,456 bytes
abandoned tail, 15 of 16 pages free, `releasable=NEVER`, `misalignedChunks=1`**.
The program barely uses strings, so the absolute figure is trivial; it proves
the arithmetic and the `NEVER`.

## Where every number above came from, and why the cache defect does not touch it

`77735c1ad` records that the build cache could not see an instrument
header's bytes: across a header edit every key input was identical, the
build hit, and the run reported the **previous** instrument's numbers. Any
figure taken from a rebuilt instrumented binary before that fix is suspect.
Sorted, rather than asserted clean:

| number | source | at risk? |
|---|---|---|
| the four-arm control table | rebuilt instrumented binaries | **no** — every control build ran with `SCRIPTC_NO_CACHE=1`, so the cache was bypassed rather than trusted |
| LLVM tier | the emitted artifact (`occupancy-control.ll`, no `.c`) | no |
| string arena `releasable=NEVER` | `scr_string.c` source | no |
| "the arena cannot enumerate its chunks" | `scr_cycle.c` source | no |
| the `DYNCEN-*-BOX` counter | never run; syntax-checked only | no readings exist |

The control table also carries **positive evidence that the binaries were
genuinely rebuilt**, independent of the cache setting: the third rebuild
introduced a new environment knob, `KC_MODE`, and the clustered arm
responded to it. A stale binary cannot answer a knob it was not compiled
with. Likewise the sparse arm moved 97.7% → 9.6% across the rebuild that
unchained the nodes, and 0% → 96.3% on the dense arm across the rebuild
that moved the exit inside the timer. Three rebuilds, three behaviour
changes that follow the source edits. A cache hit would have produced none
of them.

**The fix does not cover this lane completely.** `profFlavor()` folds the
contents of every `-include`d file, so `scr_chunk_census.h` is in the key.
The two **walk** headers are not: they arrive by `#include` from
`scr_cycle.c` and `scr_string.c`, are named nowhere on the command line,
and live under `tests/perf/` which the runtime fingerprint does not cover.
Editing a runtime `.c` invalidates the key, so wiring the hooks is safe; a
later walk-header-only edit is not. Until `profFlavor()` also covers the
`-I` directories an instrument names, the arena arm keeps `SCRIPTC_NO_CACHE=1`.

## What this composes with, from the other blocks

* The page-return route's ceiling has been independently bounded at
  **≤ 9.44 MiB, ≤ 9.0% of settled** — 161 chunks held at exit is 10.06 MiB
  and one page per chunk is an unreturnable header. That agrees exactly
  with this instrument's structure: the `ideal` map pins page 0 of every
  chunk for the `ScrCycChunk` header in the first 256 bytes.
* That bound is taken **before subtracting live blocks**. The controls here
  say the subtraction is the whole story: the sparse arm's naive bound is
  15 of 16 pages free, and its measured ceiling is **4.2%**, because
  scattered survivors touch every page. So the true ceiling on zapo should
  be expected *well below* 9.44 MiB — a prediction this lane can settle in
  one run, not a measurement.
* **A retained box pins two representations, not one.** `scr_dyn_origin_mark`
  holds the source struct at +1 for the box's whole life and keeps a
  side-table slot besides, so a retained `unknown` crossing costs the dyn
  tree *plus* the original tree *plus* a hash slot. The `DYNCEN-*-BOX`
  counter added here measures **only the dyn half** and says so in its own
  comment; reporting it alone would understate the cost. Counting the
  origin table is the remaining work on that question.

## Two controls that were wrong, and what caught them

Both were caught by the self-test requiring the arms to **differ**, and a
weaker self-test would have passed and certified the instrument against a
case it never exercised.

1. The first control chained the nodes (`next = prev`), copying
   `tests/fixtures/cycle-arena/churn.ts`. Holding every tenth node
   transitively retained its whole prefix, so `KC_KEEP=10` retained all
   40,000 and the sparse arm read **97.7%** — identical to dense.
2. The second returned from `main` instead of exiting inside the timer, so
   the loop reached teardown, freed everything, and took one more seam
   sample. That sample being last in the file, the reader picked it and the
   **dense** arm read **0%**.

The census was right all three times.

## Usage

```sh
sh tests/perf/chunkcensus/run.sh all      # build, four arms, self-test
```

| knob | |
|---|---|
| `SCR_CHUNKCEN_MS` | snapshot period at the loop seam. **0 (default)** is the negative control: one integer compare and nothing walked. |
| `SCR_CHUNKCEN_OUT` | report path (default stderr). Holds a **series**; the settled reading is the last snapshot before shutdown, joinable to `memrig`'s `phases.csv` on the `epoch=` column. |
| `SCR_CHUNKCEN_CHUNKS=0` | suppress per-chunk rows, keep the totals. |

Sampled at `scr_loop_run`'s sleep seam — the one `scr_heap_trim` and
`scr_fiber_pool_decay` already use — and **not** from a thread: the arenas
are mutated by the main thread under no lock, so a walk from elsewhere could
land inside a free-list push. `memmap` can use a thread because
`VirtualQuery` and `HeapWalk` are serialised by the kernel and the heap lock;
this cannot.

The reader refuses rather than renders on: a missing `CHUNKCEN-ARMED` line
(the build never carried the instrument — `u16census`'s failure), a walk
reporting `ABSENT` (the header was force-included but the runtime `.c` that
owns the walk was not compiled with the hook), `regcheck=MISMATCH`, or any
`CHUNKCEN-CYCBAD` row.
