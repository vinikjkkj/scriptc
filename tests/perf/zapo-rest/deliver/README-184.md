# `zapo-rest-184.exe` — the memory build, and what it is honestly worth

Same program as `zapo-rest-183-llvm.exe`: same source, same zapo-js 1.8.2,
same LLVM backend, same behaviour. What changed is in the runtime's
allocators.

**Run it on port 8791 with `start-184.cmd`.** It uses its own database file
(`zapo-state-184.sqlite`) and never opens your live `zapo-state.sqlite`.

---

## 1. What we measured

Every figure below names its **arm** — which binary produced it — because
the instrumented builds that can itemise memory are not the binary you run,
and blending the two is how a number ends up being quoted for something it
never measured.

Numbers are **private working set** unless stated. That is the column Task
Manager's Processes tab shows under "Memory", and it is the one your
complaint was phrased in. The *total* working set is 15–20 MB higher because
it also counts the executable's mapped image, which is shared and file-backed.

### The plateau, shipping arm

`zapo-rest-184.exe`, 12 runs, 19,200 messages in 8 chunks, unserialised.

| | private WS | total WS | private commit |
|---|---|---|---|
| idle (logged in, before history) | **17.72** MB | 36.08 | — |
| settled (+60 s after the sync) | **85.25** MB | 104.76 | 198.93 |
| retention | **67.53 MB** | | |

**Spreads across those 12 runs: settled ±4.53 MB, idle ±5.98 MB.** The idle
figure is the noisy one and should not be treated as precise — it is sampled
15 s after login while the service is still settling. Settled is the solid
number.

### What the 67.53 MB is made of, census arm

This breakdown comes from an **instrumented build**, because only one can
itemise a heap. Its own settled figure is 84.59 MB against the shipping
build's 85.25 — within 0.8%, which is why the shares below are meaningful
for the binary you actually run. They are shares of that arm's own 71.29 MB
of retention.

| | MB | share |
|---|---|---|
| fragmentation — free space the allocator cannot return | **36.51** | 51% |
| the messages themselves | 12.69 | 18% |
| service state | 10.32 | 14% |
| our own memory pools | 10.25 | 14% |

---

## 2. What this build changes

> **[PENDING — page return]** `pagereturn`'s mode-matched figure for cycle-arena
> page return goes here. Measured ceiling was 2.31 MB; the provisional
> unmatched reading was −2.06 MB, which is **the same size as this rig's
> measurement artifact** (see §5) and is being re-measured against a shared
> floor before it is quoted.

> **[PENDING — string arena]** The string arena currently never recycles a
> block at all and cannot free a chunk *even in principle*: the pointer
> `malloc` returned is overwritten by the next chunk and no free path exists.
> It holds 3.00 MB. Fixing it is correct and necessary regardless of yield —
> but the yield may be **much less than 3 MB**, because the cycle arena
> *already has* the chunk list that fix would add and still holds 7.25 MB at
> 61% occupancy: one live block pins a whole 64 KB chunk whatever the
> bookkeeping says. The measured figure goes here, whatever it turns out to be.

**If either converts to near zero, this file will say so.** A small true
number is worth more than a large one we have already refuted internally.

---

## 3. The single largest win is five lines, and it is in your code

`WaClientFactory` dispatches incoming stanzas fire-and-forget, so **every
history-sync chunk decodes and persists at once**. That concurrency is what
creates the fragmentation in the table above — with identical data,
processing chunks one at a time drops the fragmentation from **45.37 MB to
3.60 MB** — a matched pair on this binary with only the delivery gap changed,
live data within 7% either way. (That pair ran a slightly smaller workload
than the 36.51 MB figure above; the ratio is the point, not the difference.)

A promise gate serialising `runHistorySyncNotification` measures:

- **−62% peak working set**, **−75% peak commit**, **−48% settled**
- and the sync finishes **faster** — 11.9 s → ~5 s, because eight concurrent
  decodes thrash where one does not
- row counts identical to the byte, `PRAGMA integrity_check` clean

It also **fixes a real defect**: `history_sync_chunk` events arrive out of
order without it. In 2 of 7 unserialised runs the final reported `progress`
was 25 *after* having already reported 100; in 4 of 4 serialised runs, never.

One known cost: the `hist_sync` receipt for chunk N then waits on 1…N−1, a
measured **4.6 s** backlog at 19,200 messages.

The patch is `history-sync-serialise.patch` in the scriptc tree at
`tests/perf/zapo-rest/harness/`. **We did not apply it — you asked us not to
change zapo. It is yours to take, and it is worth more than everything on
our side combined.**

---

## 4. What we ruled out, and why

Five routes were investigated and closed. Listing them so the small number in
§2 reads as work rather than absence:

- **Returning free heap pages to the OS.** 99.7% of the free blocks are under
  8 KB and contain no whole page; returning the page a block *starts* on
  makes the process hang inside the allocator on a free list whose links read
  back as zeroes.
- **A separate heap per worker.** Every heap reserves its own region; it moved
  working set and commit slightly *worse*.
- **A wider size-class pool.** Windows already buckets allocations to 16 KB
  internally, so those blocks were never unrecycled — only unrecycled by us.
- **Copying live data out at the end of a sync.** Nothing can move: this
  runtime has no handle indirection, so a pointer held anywhere pins its block.
- **Collapsing union storage.** Measured at 0.29 MB.

---

## 5. If you benchmark this yourself, read this first

**The first run of a pair peaks about 28.7 MB higher than the second.** On our
12-run floor, position 1 landed in the high mode in **5 of 6 repetitions** —
median peak 213.14 MB first versus 184.46 MB second. It is a property of the
machine, not of the build.

**Rotate which build you run first, or the effect lands entirely on one arm
and looks like a result.** We measured the same binary against itself and, without
rotating and mode-matching, it reported **−2.59% on settled private working
set** — a difference of nothing, from nothing. Within a mode the same
comparison reads +0.75%.

So: **anything under about 1% on settled memory, or under 4% on CPU, is
inside our noise floor.** Those are the numbers to beat.

---

## 6. Two things this build will not do

**It will not return to idle after a sync.** Realistically the plateau lands
near **80 MB** without the scheduling change in §3, and near **52 MB** with
it (85.25 now, less roughly 33 MB of fragmentation that change removes).

**It does not idle at 10 MB either.** This binary's own idle floor is
**17.72 MB** private working set (36.08 MB total). The gap between those two
is the executable's mapped image: it is 29.8 MB on disk and about **18 MB of
it is resident**, shared and file-backed, which is why it shows in the total
column and not in the one you are reading. If
you remember 10 MB, that was a different program, not a regression here.

---

*Built from scriptc `e6f48fb2f` plus the memory work. Binary
`zapo-rest-184.exe`; the shipping build is not instrumented and carries no
measurement overhead.*
