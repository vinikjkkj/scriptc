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

This is structural: it does not depend on any particular caller, and it is
stated here without one, because the example it was first written with turned
out not to hold.

**Views exist and they alias.** `scr_bytes.c:457` separates the two operations
by name — *"slice (copy) / subarray (view)"* — and the two implementations are
explicit: `scr_bytes_slice` (`:469`) allocates and `memcpy`s, while
`scr_bytes_subarray` (`:524`) is *"a same-elem VIEW over the receiver's
storage"*, with a chain depth of exactly one to an owner and the owner pointer
at `scr_runtime.h:7732`. `DataView` and `Buffer.slice` take the same view
branch; the header comment names the JS subtlety exactly — *"only the plain
typed arrays' slice() copies"*.

**So a live object can be N bytes whose liveness pins far more than N.** The
consequence for a region is not a slowdown, it is a use-after-free:

> copy the survivor's own length, then destroy the region -> the bytes are
> copied, the owner is freed under the copy's backing pointer, and the view's
> `data` now points into returned memory.

Nothing fails at the copy. It fails at the next read, arbitrarily later, with
no line pointing back here.

A correct copy-out must, per survivor, either **materialise the view** — copy
the viewed *window* into a fresh owner and re-point the view — or **promote
the owner** — copy the whole backing buffer and leave the view pointing into
it. Choosing needs the view's window, which the runtime has. What it must
never do is treat `sizeof(survivor)` as the amount to copy.

The same holds for the string arena's carved blocks, which are interior
pointers into a 64 KiB chunk by construction (`scr_string.c:595`) and whose
release goes to the arena's own free list rather than to `free()`. An address
inside a region is not necessarily an address the region may reclaim.

### 1a. Store-dependent retention (the user's observation)

A decoded protobuf's `bytes` fields are views: the vendored protobufjs sets
`_slice = Array.prototype.subarray` for the base reader and
`Buffer.prototype.slice` for the buffer reader, and both alias. So **a store
that retains a decoded object retains the blob it was decoded from**, however
small the field it kept.

That makes retention a property of the *store*, not only of the code that
decodes. A store which serialises on write (SQLite) drops the view at the
write boundary; an in-memory store which keeps the object holds the whole
decompressed chunk behind it. Same program, same decode path, different
retention.

**Unmeasured.** Every figure this objective rests on was taken on the SQLite
store. Running the same rig against the memory store would size this class,
and it is worth doing one day — but nothing here should be read as having
measured it.

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
* The size of the store-dependent retention class in 1a: the same rig against
  the memory store rather than SQLite.
* Cycle-level, mode-matched A/B on the allocation path. The seven-rep wall
  clock in `placement.c` supports **not slower** and nothing stronger.
