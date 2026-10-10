# Lifetime segregation of the sync burst — design

> **ARM: the source read here is `app/`, zapo-js 1.6.2 -- retired.** The user
> has instructed that nothing be run on the old version; 1.8.2 only. The two
> line references below (`history-sync.ts:275` and the 1,344 neighbourhood)
> are 1.6.2 source, and 1.6.2 does not share 1.8.2's history-sync
> architecture, so the sites they name may not exist on the live arm. **The
> design argument is version-independent -- segregating a burst's allocations
> by lifetime is a property of the allocator, not of zapo -- but every site,
> line number and figure attributed to zapo here must be re-derived against
> `app182/` before it is acted on.**

Forward direction: can the burst's allocations be made to land together?
(`memcensus` works the residue backwards to a site; this works placement
forwards. Convergence is the cross-check.)

Evidence this builds on — `hcctl`, identical live data (24,521 busy blocks,
10.34 MB, to within 48 bytes), two placements:

| | free-in-heap | freeBlocks | **uncommitted** | runs | runMax |
|---|---:|---:|---:|---:|---:|
| stride (scattered) | 83.70 MB | 217,359 | **3.67 MB** | 23,065 | 147 KB |
| prefix (contiguous) | 13.20 MB | 1,026 | **75.59 MB** | 98 | 1.53 MB |

Contiguity pays and is settled. The question is reachability in the real
program, and the burst keeping **1.22% of 1.72 GiB** is what makes a region
shape plausible at all.

## 1. Is there a real phase boundary? Yes — and it is not a time span

**It is not synchronous.** The per-chunk decode
(`src/client/persistence/history-sync.ts`, 1.6.2) contains `await
downloadHistorySyncBlob`, `await unzipAsync(blob)`, and **eight** `await
flushPendingWrites(pendingWrites)` inside the decode loop. Anything keyed to
"between these two instants" would enclose every other task that runs during
those awaits, and freeing the region at the end would free their allocations.
That is a use-after-free, not a leak.

**But the runtime has task identity.** `scr_fiber_self()` returns the running
fiber (NULL on the main stack); `scr_on_fiber()` is the predicate. A region
keyed on *fiber* rather than on *time* is correct under interleaving by
construction: work that resumes on another fiber keys elsewhere.

So a real boundary exists — **the fiber's lifetime**, which is a program
structure and not a heuristic. Two things still stand between that and a
lowering, and both are new surface rather than unknowns:

* **Designation.** Zapo's source is read-only, so the phase cannot be marked
  in it. It would have to be named to the compiler (a build-time function
  list), not annotated.
* **Nested fibers.** If `flushPendingWrites` runs on its own fiber, the region
  must cover a fiber *tree*, which needs parent linkage the runtime does not
  currently keep.

## 2. The blocker: this runtime cannot move an object

Constraint 2 says survivors are copied out, not pinned. **For objects that is
not implementable here.** Copy-out means relocation, and relocation needs
every reference to be findable. This runtime holds raw `ScrArr *`, `ScrStr *`,
`ScrDyn *` in C locals, in array slots, in closure captures, and in
`ScrBytes` views that carry an interior pointer to an owner
(`scr_bytes.c:518`, chain depth 1). There is no handle indirection anywhere.

A moving collector is a different runtime, not a change to this one. So a
general per-phase region with object copy-out is **blocked**, and saying so
before a lowering is the point of this document.

## 3. What IS implementable, and it needs no phase at all

The relocatable thing is not an object but a **side buffer with exactly one
owner and one access path**. Such a buffer can be moved because only one
pointer names it. The runtime has exactly four:

| buffer | owner | movable? | **segregable?** | status |
|---|---|---|---|---|
| `ScrArr::data` | the `ScrArr` | yes | yes | **done** — reservation-backed above 8 KiB |
| `ScrDyn::obj.entries` | the `ScrDyn` | yes | yes | not done — this is the `3 × 2ⁿ` ladder |
| `scr_map` tables | the map | yes | yes | not done |
| `ScrBytes::data` | the `ScrBytes` | **no** — views alias it with an interior pointer | **YES** — see §3a | not done — size unknown; it is **NOT** the 1,344 class (§3b) |

For these, **no phase boundary and no copy-out are needed**: give the buffer
its own reservation and it is off the CRT heap for its whole life and returns
to the OS on free. That is strictly stronger than making its garbage
contiguous — the heap never sees it, so it never fragments from it.

**So the honest answer to "can the burst's allocations be made to land
together" is: the ones that matter need not land anywhere on the heap.** The
mechanism is per-buffer, incremental, needs no oracle, no designation, no
fiber tree, and no relocation of anything user code can hold.

### 3a. CORRECTED 2026-10-10 — "movable" and "segregable" are different questions

> **PART OF THIS SECTION WAS RETRACTED HOURS AFTER IT WAS WRITTEN. See §3b.**
> The reasoning below — that segregating a buffer needs only alloc/free
> ownership, not single-pointer ownership — **stands, and is verified against
> the code.** Every figure attached to it does **not**: the 1,344 population is
> not an `ScrBytes` payload and no longer exists. The sizing, the granularity
> table and the registered prediction are void as written. They are kept
> because the arithmetic shape (4x per doubling of the return unit) is reusable
> and because deleting a retracted claim hides how it was reached.

**The table above originally read `movable? no` for `ScrBytes::data` and that
excluded it from this section's fix. The exclusion does not follow, and it kept
the largest single line in the heap off the queue.**

Moving a buffer requires that exactly one pointer names it — views carry an
interior pointer, so `ScrBytes::data` is genuinely not movable. **Allocating it
somewhere other than the CRT heap requires only that the runtime own its alloc
and its free**, and it does, at exactly one site each:

```
scr_bytes.c:52    b->data = calloc(len ? len : 1, elem_size)   <- the only alloc
scr_bytes.c:192   free(b->data)                                 <- the only free
```

`scr_bytes_release` is explicit about why there is no second free path: a
**view** releases its `backing` and never touches `data` (`:190-192`); only the
owner frees. So the one-owner property holds for ALLOCATION even where it fails
for RELOCATION, and a buffer that never moves keeps every interior pointer
valid by construction.

~~This matters because `heapcensus/HOLEMAP.md:§4` named this population: the
1,344-byte hole class is a freed `ScrBytes` payload, **56.02% of CRT free
bytes**.~~ **RETRACTED — see §3b. The owner is SQLite, and `ScrBytes::data`'s
own retained size is unmeasured.** The argument above is therefore a correct
argument about a buffer whose size nobody has established.

#### The decisive variable is the RETURN UNIT, not the slab

The cycle arena returns a 64 KiB chunk only when the chunk is entirely empty, so
one survivor holds 64 KiB. That is a **design choice, not a law**, and over this
population it decides the whole result. With the measured live fraction — 4,097
live against 19,863 present, **20.63%**, same run — and assuming independent
placement:

| return unit | slots | P(empty) | units | empty | returned |
|---|---:|---:|---:|---:|---:|
| **4 KiB page** | 3 | **0.500** | 6,621 | 3,311 | **12.93 MiB** |
| 8 KiB | 6 | 0.250 | 3,311 | 828 | 6.47 MiB |
| 16 KiB | 12 | 0.0625 | 1,656 | 104 | 1.62 MiB |
| **64 KiB chunk** | 48 | **1.5e-05** | 414 | 0.006 | **0.00 MiB** |

It falls 4x per doubling of the unit. Inheriting the arena's 64 KiB framing
returns **zero**; a 4 KiB page returns **63.6% of the 20.33 MiB of dead bytes
assuming no correlation whatsoever between birth and death**. For 64 KiB to pay
at all the live fraction would have to fall to **1.43%** against the 20.63%
measured. `VirtualAlloc` reserves on a 64 KiB granularity but **commits by
page**, and `MEM_DECOMMIT` is per page.

`scr_array.c:200-202` rejects small buffers on granularity grounds, and that is
right for a **reservation per buffer**: at 1,328 bytes the address-space waste
would be 48x. **A slot packed into a shared reservation is a different design
and that objection does not reach it.**

> **VOID — the population it predicts over is misattributed and gone (§3b).**
> Original text: **REGISTERED, before measuring.** Per-4-KiB-page occupancy over
> the band [1296, 1352] returns **12.93 MiB**, correlation aside. **REFUTED if
> the measured occupancy returns less than 4 MiB** — which would mean the live
> blocks are clustered by page, and the answer is allocation ORDER rather than
> return granularity. The census artifact cannot settle it: `n1.heapcen.txt` is
> a histogram of (size, count, bytes) and carries no block address.

**The half of this most likely to be wrong is not the ceiling — it is
hysteresis.** A page that empties and refills thrashes `MEM_DECOMMIT`/recommit,
and the independence that yields 50% is exactly the condition that makes a page
oscillate about empty. That cost would appear as THROUGHPUT, which the
occupancy measurement above cannot see.

What is left on the heap after all four: `ScrStr` payloads (the object *is*
the buffer — a flexible array member, so it cannot move without moving the
object), `ScrDyn` nodes, `ScrArr` headers at 64 B, and SQLite.

> **CORRECTED 2026-10-10 — the header count here was a FLOW number in a
> sentence about RETENTION.** It read "the **1,254,966** `ScrArr` headers at
> 64 B", which at 64 B each would be **80.3 MB** and the largest term in the
> heap by a wide margin. It is a whole-run allocation count, not a live
> population, and the census refutes it arithmetically:
> `heapcensus/evidence-h2/main.heapcen.txt` reports the **entire** CRT heap
> holding **50,463 busy blocks**, so 1.25 M live 64-byte blocks is impossible by
> a factor of 25. The busy 64-byte row in that run is **3,423 blocks =
> 273,856 B = 0.27 MiB**, and not all of those need be `ScrArr` headers.
>
> This project's own rule names the class: **the allocation burst is FLOW, not
> RETENTION.** A flow count inside a list of what stays resident reads as a
> retention term, and this one survived long enough to be the last remaining
> candidate for "the next memory lever" — which it is not.

### 3b. RETRACTION 2026-10-10 — the 1,344 is SQLite, and the cohort is gone

`heapcensus/HOLEMAP.md:§4` attributed the 1,344-byte hole class to
`scr_bytes.c:52` from a lockstep argument: three busy populations move together
between the no-sync and sync arms (1,328 +4,021; 40 +4,038; 24 +4,033), and
`sizeof(ScrBytes)` is 40. **The lockstep is real and the attribution does not
follow, and the refutation is inside the evidence file HOLEMAP itself cites.**

`settled-census/evidence-trace1344/prof.txt:367` is that site's own octave
histogram:

```
PROFHIST 19d7672 0:73 1:3235 2:11 3:1615 4:1674 5:11549 6:38 7:145 8:41
                 9:5 10:3 11:2 12:12 13:386 14:260 15:8 16:10 18:16 19:8
                 <repo>/packages/runtime/src/scr_bytes.c:52
```

**Octave 10 is 1,024–2,047 bytes and it reads `3`.** Three payloads in the whole
run against 15,766 holes. Reproduced independently a month later: 3 of 26,513
calls. The site's mode is 32–63 B (13,195 of 26,513), not 1,328.

**The real owner, measured on the allocation side.** All 60 allocations in
[1296, 1352] resolve to SQLite — 59 `sqlite3MemMalloc ← dbMallocRawFinish`, one
via `MemRealloc`; where a program frame survives it is
`sqlite3_step ← scr_sqlite_exec ← sv_db_exec`, the TS `db.exec`.

**Why nobody could have seen this before.** `prof` and `heapcensus` had never
run in one process: `scr_prof.h` defines `_Exit` unconditionally and heapcensus
only branches for `SCR_CYCEN_ON`, so composing them was a `#error`, not a
composition. The allocation side and the free side were never measurable
together. That is the mechanism of a month-old wrong attribution, not
housekeeping.

**And the cohort no longer exists.** Busy 1,328: 76 nosync / 4,097 sync on
09-10 → **1** now. The two lockstep rows are back at their no-sync levels
(40 B: 3,700/7,738 → 3,686; 24 B: 6,488/10,521 → 6,435). The free side went
36.51 MiB in 81,414 holes → **12.50 MiB in 12,903**. `scr_bytes.c` is untouched
since 2026-09-09 across 400 commits, so **something else closed it** and which
commit did is not yet known.

#### What replaced it as the largest line — and it is NOT a defect

The busy 4,376 row: **2,792 buffers, 12,906,128 B = 12.31 MiB, 40.4% of all busy
CRT-heap bytes** — the largest busy row, ahead of the 64 KiB arena chunks at
10.57 MiB in the same file. One path, 100% of them:

```
sqlite3MemMalloc ← pcache1Alloc ← pcache1FetchStage2 ← getPageNormal
  ← btreeGetPage ← btreeGetUnusedPage ← allocateBtreePage ← balance
```

Size is arithmetic: `szPage 4096 + szExtra 216 + ROUND8(sizeof(PgHdr1)) 56
= 4368`, plus 8 for SQLite's own prefix.

**What survives:** the population is monotonic (`PROFEXACT 4376 = 2792` and
`HCSIZE 4376 = 2792` in a run that freed 10.26 M of 10.47 M allocations), it
survives 45 s settle plus 60 s idle, and it is **sized by the database**
(400 convs: db 2,751 pages → 2,792 buffers; 200 convs: 1,370 → 1,423). The
cache holds every page of the database and ~1.5% more.

> **RETRACTED hours after it was written, same day — and the retraction is the
> second one this section has carried.** I wrote that `PRAGMA cache_size` does
> not bound it and that why the pages stay unrecyclable was the open question.
> **Both are wrong, and `heapcensus/WHICH-BUFFER.md:§2a` carries the evidence.**
>
> * The `ZAPO_SQLITE_CACHE_KB=0` arm was an **A/A**: `cc.ts:1291` compiles in
>   `-DSQLITE_DEFAULT_CACHE_SIZE=-16000`, and `zapo-rest.ts:282-284` passes a
>   pragma only when `CACHE_KB > 0`, so "no pragma" lands on the same -16000
>   rather than on stock SQLite's -2000. 2,792 → 2,791 is one block of A/A
>   noise. Corroborated in the same three census files: the bulk row
>   `HCSIZE 87368 2 174752` is byte-identical across all three arms.
> * The cap was never below the population anyway — 3,871 pages by the correct
>   denominator (4,232, not 4,312), or 3,799 by the wrong one. **2,792 is below
>   both.**
> * The pages are **not pinned**. `bPurgeable = !memDb` and this is a file
>   database; `pcache1Unpin` (`sqlite3.c:58761`) frees outright only above the
>   cap, so under it every unpinned page lands on the LRU. **Zero pinned pages
>   are needed to explain the whole population.**
> * And nothing is unrecyclable: the release shipped **2026-10-03** in merge
>   `040d22982` and reaches all of it — `pcache1Shrink` (`sqlite3.c:58522`)
>   forces `nMaxPage = 0` and drains the entire LRU, then frees the bulk blocks.
>   `SCR_SQLITE_IDLE_RELEASE_MS` was simply **absent from that run** and
>   defaults to 0 (`scr_async.c:2536`).
>
> **So this measurement is that feature's negative control, not a defect** —
> a correctly sized page cache holding an 11.0 MiB database under a 15.6 MiB
> ceiling, with the return knob at its default. `OCCUPIED IS NOT A DEFECT` is a
> rule of this front and I broke it on the largest row in the heap, twice in one
> day, by sizing my own reasoning with someone else's unverified number.

#### The lesson that outlives both numbers

The retracted claim was not sloppy: it had a measured lockstep, a matching
`sizeof`, and a named site. **What it never had was the allocation side and the
free side in one process**, and the one line that would have refuted it was two
lines below the table it quoted, in the same file. *Check the site's own size
histogram before accepting any attribution drawn from population deltas.*

> ***CONFIRMED 2026-10-10 — the SQLite term is returnable on demand; see
> `heapcensus/IDLE-RELEASE.md` §1.*** SQLite is named just above as one of
> the things *"left on the heap after all four"*, and that is right at the
> shipped default. But it is not a fifth relocation problem: its 12,906,128 B
> at rest go to **zero** when `SCR_SQLITE_IDLE_RELEASE_MS` is armed — no phase
> boundary, no copy-out, no reservation. It belongs with this section's
> *"the ones that matter need not land anywhere on the heap"* result rather
> than with the residue, by a different mechanism: the page cache hands the
> pages back itself. The one exception is a single 87,368-byte bulk slab per
> cache held by one pinned page (`IDLE-RELEASE.md` §2).

## 4. Cross-check with `memcensus` — a registered negative

**Nothing in the sync allocates 1,344 bytes.** From this branch's own
allocation-side exact table (8-byte buckets, `-DSCR_PROF_SIZEHIST`, arm `app/`
1.6.2), the whole neighbourhood of 1,344:

| bucket | control | burst |
|---|---:|---:|
| 1320 | 6 | 6 |
| 1328 | 16 | 16 |
| 1344 | **absent** | **absent** |
| 1352 | 10 | 10 |

Two things follow, and the second is the useful one:

1. There is no 1,344-byte request anywhere in the run — 15,766 of them would
   be impossible to miss.
2. **The near buckets are identical in both arms**, so those 32 allocations
   are not sync-created either.

> **REGISTERED.** The 15,766 sync-created 1,344-byte holes were **not
> allocated at 1,344 bytes**. They are either coalesced from smaller adjacent
> free blocks, or reported at a heap *block* size that differs from the
> request. Refuted if an allocation site is found requesting ~1,344 bytes
> ~15,766 times.

If segregation is right, the 1,344 population lands off-heap too — **but only
if it comes from one of the four side buffers.** If it is an `ScrStr` payload
or a `ScrDyn` node, segregation does not reach it, and that is the fact the
two investigations should converge on.

## 5. What I recommend, in order

1. **`ScrDyn::obj.entries`** — the same change as `ScrArr::data`, same shape,
   same one-owner argument. 241,519 reallocs and 20.24 MiB per sync, and it is
   the `3 × 2ⁿ` ladder whose residue share is 0.1% — so this is a throughput
   change like the array one, priced honestly as such, not a retention fix.
2. ~~**Nothing else until the 1,344 has a name.**~~ **ANSWERED 2026-10-10, but
   NOT by the answer first written here.** This item was marked SATISFIED at
   18:20 on the strength of `heapcensus/HOLEMAP.md` naming a freed `ScrBytes`
   payload, and **that naming was retracted hours later in §3b of this same
   file**: the owner is SQLite, and the population no longer exists. So the
   gate is closed — the 1,344 *does* have a name — and **the successor this
   item pointed at (§3a) is void as written, by §3a's own banner.** There is no
   successor item from this line; the live question moved to whether the
   release that ships in `040d22982` is enabled, which is not an allocator
   change at all.

   *The stale half above is left visible on purpose: this is the third instance
   today of a REPAIR emitting a fresh unverified assertion — the retraction in
   §3b never came back to the queue entry that cited it.* Original text: If it turns out to be an
   `ScrStr` payload, the fix is in the string allocator's uncovered band
   (244–511, `cap + 13`), which is a different change from any of the above
   and would be the first one aimed at the residue rather than the stream.
