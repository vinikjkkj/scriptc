# String arena chunk release — design, and the crux the brief did not name

`scr_string.c:595-604`. The defect is as briefed: `k`, the pointer `free()`
needs, is written only into `scr_str_ar_cur`, and the next carve advances past
it. Every chunk is retained for the process lifetime by construction.

Two things make the fix harder than porting `ScrCycChunk::raw`, and the second
is the one that decides the design.

## Crux 1 — the freelist is global (the brief's warning)

`scr_str_ar_free[SCR_POOL_CLASSES + 1]` is per **size class**, not per chunk.
A parked block can outlive its chunk reaching `used == 0`. The cycle arena's
soundness argument (`scr_cycle.c:337-349`) rests on the freelist being
chunk-local, so it does not transfer until the freelist does.

**Choice: make the freelist chunk-local**, as the cycle arena does, rather
than accounting for parked blocks in `used`. Accounting keeps a global list
whose entries must still be found and unlinked when a chunk goes, which is a
scan of the list per release — on the string release path, which is hot. A
chunk-local list makes the invariant structural instead of arithmetic.

## Crux 2 — blocks that were NEVER in a chunk reach the give path

This is not in the brief and it is the whole difficulty.

`scr_str_alloc` (`:616`) tries pool, then arena, then `malloc`. `scr_str_release`
(`:771-783`) offers the block to the pool and, if the pool refuses — full class,
or byte budget — hands it to `scr_str_ar_give` for any `r <= SCR_POOL_MAX`.
Nothing on that path knows where the block came from. The code's own comment
says so: *"A block that came from that fallback still reaches scr_str_ar_give
at death — it is never handed to free()"*, and calls that *"the only shape in
which the cap predicate can be wrong about where a block came from."*

Today that is harmless: `give` pushes onto a global list and no chunk is ever
freed, so a foreign block just gets recycled forever. **The moment chunks can
be freed it stops being harmless** — a foreign block would decrement some
chunk's `used`, and a chunk could be freed while live blocks are still carved
from it.

So chunk release requires a **provenance test**, exactly as the cycle arena
does. `ScrCycHdr::pad` is that test there; `ScrStr` has no equivalent — `rc`,
`len`, `cap`, then `data[]`, no spare byte, and its layout is spelled by every
compiler-emitted literal.

### Three ways to get provenance, and what each costs

| option | map cost on the hot give path | risk |
|---|---|---|
| **A. aligned chunks + mask** — allocate each chunk aligned to its own size, so `chunk = ptr & ~(CHUNK-1)` | one AND | needs a separate *membership* test, or a foreign block computes a bogus chunk base |
| **B. spare bit in `ScrStr::cap`** — top bit marks arena-carved | one test, then A's mask | touches the layout literals depend on; needs every literal and every `cap` reader audited |
| **C. chunk registry, binary search** over sorted bases | ~6 compares at 64 chunks | pure cost on a hot path, and the brief requires proving the added work is noise |

**A alone is not sound.** A malloc'd block masks to *some* 64 KiB-aligned
address; reading a chunk header there is a wild read. A magic word in the
header makes it *unlikely* to misfire, and "unlikely" is not an argument an
allocator may rest on.

**A + a membership set** is sound: mask, then probe a small open-addressed set
of live chunk bases. That is one AND, one hash, one compare in the common case,
and it is the option this design recommends — with the set sized from
`sarchunk` (55 chunks on the measured arm, so a 128-slot set never chains).

### Aligned how

Windows `VirtualAlloc` reserves on a 64 KiB granularity, so a 64 KiB chunk is
64 KiB-aligned for free, and `MEM_RELEASE` takes the base the mask already
gives us — the lost-base bug disappears rather than being fixed. POSIX needs
`mmap(2*CHUNK)` and a trim, which is the twin already written for
`ScrArr::data`.

**Side effect worth having:** it also takes the string arena's 3.00 MiB off the
CRT heap, so its chunk churn stops feeding the allocator this branch has spent
the day showing fragments.

**Constraint it imposes:** `SCR_STR_ARENA_CHUNK` can no longer be swept below
64 KiB on Windows without over-allocating, because that is the reservation
granularity. The brief does not ask for that sweep; if it is ever wanted, the
chunk must become a sub-chunk carved from a 64 KiB reservation.

## What is NOT changing

Per the brief's second warning: `scr_str_alloc`'s predicate (`cap <= 243`
reaching pool/arena) and `scr_str_release`'s `cap >= 512` spare are untouched.
The uncovered band 244-511 stays uncovered. Widening it would be a second
change wearing this one's clothes.

## Measurement plan

* `sarchunk` already counts chunks taken. A `sarfree` counter is added beside
  it, and **if it reads 0 the report says so by name** rather than letting a
  byte delta imply release happened.
* Before/after on the same arm, named on both figures, mode-matched floor.
* A cycles number: the added work is one AND plus one set probe per `give`.
* `SCR_RC_AUDIT` compiles the whole arena out (`#ifndef SCR_RC_AUDIT` at
  `:557`), so an audit-lane measurement would report a clean zero that means
  nothing. Measure on the ordinary lane.

## Recommendation on sequencing

The provenance work is the change; the chunk list is the easy half. I would
not land this as "port `raw`" — it is a provenance mechanism the string arena
does not currently have, and the fallback path is a live correctness hazard the
moment release is switched on. Worth its own review before a lowering.
