# Attributing peak RSS by asking the kernel

`scr_memmap.h` answers "what is resident at the moment the process is
largest, and which subsystem owns it" without any cooperation from the
allocator. Every resident page lies in exactly one region `VirtualQuery` can
class, so the sum over classified regions IS the working set. That is the
difference from `scr_prof.h`'s residency lane, which accounts completely for
bytes passing through the runtime's own `malloc` and says itself that it
cannot see an allocation inside libc or inside a vendored archive. On the
zapo messaging bench that blind remainder is about a quarter of peak RSS.

Nothing here is on any gate's path.

## Running it

Compile the target with the header forced in, then run normally:

```
SCRIPTC_PROF_CFLAGS="-include /abs/path/to/scr_memmap.h -DSCR_MM_HDRREV=0x<md5>"
SCR_MEMMAP_OUT=/abs/path/out.mm.txt SCR_MEMMAP_TAG=myrun ./bench.exe
```

| variable | default | what it does |
|---|---|---|
| `SCR_MEMMAP_MS` | 4 | sampler poll interval, ms |
| `SCR_MEMMAP_DELTA` | 4 MiB | how close to the kernel peak counts as "at the peak" |
| `SCR_MEMMAP_MAXTRIES` | 12 | walks spent chasing one peak level |
| `SCR_MEMMAP_HEAP` | 1 | `0` disables `HeapWalk` (also a self-test negative control) |
| `SCR_MEMMAP_REGMIN_RES` | 65536 | itemise a STACK/PRIVATE region at or above this resident |
| `SCR_MEMMAP_REGMIN_SIZE` | 262144 | ...or at or above this size; either bound suffices |
| `SCR_MEMMAP_SELFTEST` | 0 | MiB to prove the instrument can see; verdict to `<out>.self` |

A fiber census is `SCR_MEMMAP_REGMIN_RES=1 SCR_MEMMAP_REGMIN_SIZE=1`, which
itemises every stack region so `STACKSUM` can be checked against the regions
it was derived from rather than trusted.

## Arm it before you quote it

An instrument that cannot tell "found none" from "there are none" reports
zero and is believed. `SCR_MEMMAP_SELFTEST=64` allocates a known 64 MiB and
requires the PRIVATE class to grow by exactly that, and mallocs a known 8 MiB
and requires `HeapWalk` to see it. Failure writes the diagnosis to
`<out>.fail` and exits 93.

A self-test that has only ever passed proves nothing. `SCR_MEMMAP_HEAP=0`
blinds the heap walk and must make the run fail; if it passes, the self-test
is not wired to anything. Both directions were exercised on 2026-09-04:
`privateDelta=67108864 want=67108864`, and the blinded run exited 93.

## Caveats that change how the numbers read

**The 94 MiB of guard pages is commit charge with ZERO residency.** Each
fiber stack is a 12 KiB `PAGE_GUARD` region plus a 16 KiB usable region.
Across 8,019 fibers the guard is 94.0 MiB *committed* and **0 bytes
resident**. It is a large, inviting line item that cannot be optimised for
RSS, because it was never in RSS. Cutting the guard from three pages to one
would return about 62.7 MiB of commit charge and move peak working set by
nothing at all. If the objective is RSS, this is not the lever.

**Instrumented builds carry the instrument inside every peak quoted.** The
INSTRUMENT class ran 3.5-6.6 MiB across the runs below, and it is inside the
`wsPeak` figures, not subtracted from them. Do not compare an instrumented
peak against an uninstrumented one.

**Single-run class values are draws, not values.** `wsPeak` across three runs
of an identical configuration spanned 186-196 MiB, inside the measured 6.76%
RSS noise floor. Any one class figure below is one sample.

**Memory store only.** Every number here is `ZAPO_BENCH_STORE=memory`. The
sqlite store is a different memory profile and was not measured.

**The region array clips silently.** `SCR_MM_MAXREG` is 32,768 and the runs
below used 17,406, so they are clean with 47% headroom. But a workload that
exceeds it drops regions with no notice, unlike the report buffer, which
flags overflow with `TRUNCATED`. Check `regions=` against 32,768 before
trusting a larger workload's totals.

## What the bench looked like, 2026-09-04

Peak working set, zapo messaging bench, memory store, resident MiB by class:

| run | wsPeak | HEAP | STACK | IMAGE | INSTR | PRIVATE | MAPPED |
|---|---|---|---|---|---|---|---|
| a | 195.7 | 112.37 | 54.22 | 17.01 | 3.51 | 7.75 | 0.36 |
| b | 186.5 | 111.55 | 53.67 | 16.49 | 3.77 | 0.10 | 0.34 |
| census | 191.2 | 113.39 | 53.75 | 16.49 | 6.57 | 0.12 | 0.34 |

`COVERAGE pct=99` on all three, at one walk per peak.

The fiber census, cross-checked against the itemised dump: **8,019 concurrent
fiber stacks**, 8,019 distinct allocation bases counted and 8,019 itemised,
exactly two regions each. Per fiber, 16 MiB of address space reserved, 28,672
bytes committed (12,288 guard + 16,384 usable), and a median of **one touched
page**. Resident per base: p50 4,096, p90 12,288, max 73,728.

So the stack term is driven by fiber COUNT, not by per-fiber waste; at this
concurrency 8,019 x 4 KiB is about 31 MiB that no per-stack change can
reclaim. HEAP at ~112 MiB is 58% of peak and is the dominant term.

## The trap that cost a cycle

`profFlavor()` in `packages/compiler/src/backend/cc.ts` used to hash the
`SCRIPTC_PROF_CFLAGS` *string*. Editing this header leaves that string
identical, so every cache hit and the build silently linked a binary carrying
the PREVIOUS instrument -- three runs were reported as successful that had
measured the old header. That is fixed: the flavor now folds the contents of
every `-include`d file.

`-DSCR_MM_HDRREV=0x<md5>` remains worth passing anyway, because it puts the
header's identity in the report where a reader can check it against the file.
Confirm a rebuild really happened by diffing the binary hash, never by its
mtime: a cached artifact's mtime is an LRU bump, not a build time.
