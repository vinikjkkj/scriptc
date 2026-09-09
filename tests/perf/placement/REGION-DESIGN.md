# A per-phase region: preconditions before anyone writes one

`placement.c` prices the mechanism and finds it works: `copyout` — everything
in a private heap, survivors copied out at phase end, the heap destroyed
wholesale — lands within 0.01 MiB of an oracle that knows in advance which
blocks survive, and within 0.1 MiB of the clustered ideal, at every survivor
fraction from 0 to 30%.

These are the conditions under which that stays true. They are
**preconditions, not caveats**: each one is a way the mechanism is silently
wrong rather than merely slower, and the first is the kind of thing that
surfaces as a crash six weeks after it ships.

## 1. A region must enumerate VIEWS, not live blocks

**`subarray` aliases.** `scr_bytes.c:518` — *"a same-elem VIEW over the
receiver's storage"* — with a chain depth of exactly one to an owner, and
`scr_runtime.h:7732` carries the owner pointer that makes it so. Every `bytes`
field of a decoded protobuf message is such a view into the single
decompressed blob, not a copy.

So a survivor may be **32 bytes whose liveness pins megabytes**, and
copy-out's natural implementation — copy the survivor's own length, then
destroy the region — is a **use-after-free**: the 32 bytes are copied, the
owner is destroyed under the copy's backing pointer, and the view's `data`
now points into returned memory. Nothing crashes at the copy. It crashes at
the next read, arbitrarily later, with no line pointing back here.

A correct copy-out must, for each survivor, either

* **materialise the view** — copy the viewed *window* into a fresh owner and
  re-point the view (correct, and in the `nctSalt` case it also removes a
  multi-megabyte pin as a side effect), or
* **promote the owner** — copy the whole backing buffer out of the region and
  keep the view pointing into it (correct, and pays the full blob).

Choosing per survivor needs the view's window, which the runtime has. What it
must never do is treat `sizeof(survivor)` as the amount to copy.

The same applies to anything else with a borrowed interior pointer: `DataView`,
`Buffer.slice`, and the string arena's carved blocks, which are interior
pointers into a 64 KiB chunk by construction.

## 2. The survivor fraction is not a design input

Measured (`placement.c`, and the table in its header): 115 survivors in
115,000 blocks — one in a thousand, 0.08 MiB of live data — already cost
30 MiB of working set, and by one in a hundred the damage has saturated at
84.61 MiB, within 12% of what 300× as many survivors cost.

So a design must not be justified by "few things survive". Anything above
roughly one in a thousand puts the scattered arrangement at its worst case
already. The mechanism has to handle survivors; it may not hope they are rare.

The corollary is the useful half: because copy-out's cost scales with the
survivors and not with the burst (0.6 ms at 0.1%, 16.1 ms at 30%), handling
them is cheap. It is hoping that is expensive.

## 3. The oracle need not be built

`burstheap` — which knows at allocation time which blocks will survive — beats
`copyout` by at most 0.01 MiB anywhere on the curve. A compiler analysis that
could tell at an allocation site whether a value outlives the phase would buy
nothing measurable. Do not build one for this.

## 4. Destroying the region must return commit, and only one call does

`HeapDestroy` on a private heap returns **both** working set and private
commit (measured: 84.61 → 5.32 MiB working set, 84.12 → 2.29 MiB commit).
That is not true of every page-return mechanism: `DiscardVirtualMemory`
returns working set with commit unchanged, and `MEM_DECOMMIT` returns commit
but leaves the pages `MEM_RESERVE` and **not touchable** — Windows has no
auto-commit-on-fault, so a touch is an access violation and the allocator must
re-commit explicitly. The numbers are in `../pagecensus/vmprobe.c`.

Any claim that a region "gave the memory back" has to say which of the two it
returned.

## 5. The re-use cost is 78×, so a region must not be re-entered

A page that has been returned and is then touched again costs about 1.15 µs
against 15 ns for a resident one (`../pagecensus/vmprobe.c`, arms 0 and 1).
A region destroyed at the end of a phase is fine — nothing touches it again.
A region *trimmed* mid-phase and then allocated back into pays that per page.

## 6. What is still unmeasured

* Whether a history sync's allocations can be **attributed to a phase** at all.
  `placement.c` is a synthetic single-purpose process; it shows the mechanism
  recovers the memory in this shape, not that the real burst has a boundary.
  `profdiff.mjs` and the two-run split are the instrument for that.
* Whether the store driver retains bound buffers (`better-sqlite3`'s `auto`
  driver, `packages/store-sqlite/src/connection.ts`) — if it does, the
  aliasing in precondition 1 propagates past the region boundary.
* Cycle-level, mode-matched A/B on the allocation path. The seven-rep wall
  clock in `placement.c` supports **not slower** and nothing stronger.
