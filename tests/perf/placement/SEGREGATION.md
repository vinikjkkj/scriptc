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

| buffer | owner | movable? | status |
|---|---|---|---|
| `ScrArr::data` | the `ScrArr` | yes | **done** — reservation-backed above 8 KiB |
| `ScrDyn::obj.entries` | the `ScrDyn` | yes | not done — this is the `3 × 2ⁿ` ladder |
| `scr_map` tables | the map | yes | not done |
| `ScrBytes::data` | the `ScrBytes` | **no** | views alias it with an interior pointer |

For these, **no phase boundary and no copy-out are needed**: give the buffer
its own reservation and it is off the CRT heap for its whole life and returns
to the OS on free. That is strictly stronger than making its garbage
contiguous — the heap never sees it, so it never fragments from it.

**So the honest answer to "can the burst's allocations be made to land
together" is: the ones that matter need not land anywhere on the heap.** The
mechanism is per-buffer, incremental, needs no oracle, no designation, no
fiber tree, and no relocation of anything user code can hold.

What is left on the heap after all four: `ScrStr` payloads (the object *is*
the buffer — a flexible array member, so it cannot move without moving the
object), `ScrDyn` nodes, the 1,254,966 `ScrArr` headers at 64 B, and SQLite.

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
2. **Nothing else until the 1,344 has a name.** If it turns out to be an
   `ScrStr` payload, the fix is in the string allocator's uncovered band
   (244–511, `cap + 13`), which is a different change from any of the above
   and would be the first one aimed at the residue rather than the stream.
