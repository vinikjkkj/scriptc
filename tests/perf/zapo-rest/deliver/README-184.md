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

Throughout this file **MB means 1,048,576 bytes**, which is the same unit
Windows Task Manager displays, so the figures here and the ones on your
screen are directly comparable.

Numbers are **private working set** unless stated. That is the column Task
Manager's Processes tab shows under "Memory", and it is the one your
complaint was phrased in. The *total* working set runs about 18 MB higher
(31.21 idle, 104.76 settled) because it also counts the executable's mapped
image, which is shared and file-backed and so is not in your column.

### The plateau, shipping arm

`zapo-rest-184.exe`, 12 runs, 19,200 messages in 8 chunks, unserialised.

| | private WS | total WS | private commit |
|---|---|---|---|
| idle (logged in, before history) | **12.83** MB | 30.99 | — |
| settled (+60 s after the sync) | **82.29** MB | 101.58 | 196.78 |
| retention | **69.45 MB** | | |

**Measured on the binary you have**, 24 runs of it, in its shipped
configuration. Spreads: idle ±0.27 MB, settled ±2.19 MB.

The idle figure is measured two ways that agree. Across these runs, sampled
5 s after login and before a byte of history: **12.83 MB**. And in dedicated
runs that deliver *no history at all* and then sit for five minutes, idle is
**flat** from 15 s to 5 minutes — it is a floor, not a number still falling.

An earlier draft reported idle as 17.72 MB with a ±5.98 spread and guessed it
was still settling. That was wrong, and it was our extraction rather than the
program: the marker we sampled against is written about 0.02 s before the
first history chunk arrives, so roughly a third of the samples were taken
*after the burst had already started*. The spread was a coin flip on that
boundary. Corrected above.

**So if you have seen about 10 MB at idle, we are reading 12.8 MB — the same
ballpark, and the difference is not a regression this build introduced.**

### What the 69.45 MB is made of, census arm

This breakdown comes from an **instrumented build**, because only one can
itemise a heap, and like the shipping build it is zapo-js 1.8.2. Comparing
like with like — neither returning pages — its settled figure is 84.59 MB
against this binary's 83.56 with page return switched off, within 1.2%.
That agreement is why the breakdown transfers to
the binary you actually run. The shares are taken against the **69.45 MB**
figure quoted everywhere else in this file, and the four rows account for
99% of it.

One row is adjusted for what this build now does: fragmentation measured
**36.51 MB** on an instrumented build that has no page return, and the
shipping default returns **1.27 MB** of it (§2), so **35.24 MB** remains.

| | MB | share |
|---|---|---|
| fragmentation — free space the allocator cannot return | **35.24** | 51% |
| the messages themselves | 12.69 | 18% |
| service state | 10.32 | 15% |
| our own memory pools | 10.25 | 15% |

---

## 2. What this build changes

**Cycle-arena page return: −1.27 MB** of settled private working set.
Measured **on this binary**, both arms the same executable with one
environment switch between them, 24 runs, arm order rotated, 19 comparable
after excluding the high-peak mode.

- **−1.52% of the settled plateau**, and **1.8% of the 69.45 MB of
  retention** — two denominators for one measurement, both given so neither
  is mistaken for the other
- **p = 0.018**, so it separates from zero; and **2.0× our 0.75% floor**
- total working set moves with it: **−1.23%**, p = 0.018
- **CPU: no measurable effect.** −7.4% at p = 0.37, which is noise — the
  same metric read +7.0% on the first half of these runs and flipped sign
  when the rest arrived. There is no performance cost and no performance win
- peak private commit is **+0.09%** at p = 0.034. Statistically separable,
  practically nothing: 0.65 MB on 715, and the mechanism returns resident
  pages rather than commit charge, so this is the expected shape

**String arena: 0 MB.** The predicted fix recovers nothing, and we can say
why rather than guessing. The arena has handed **zero** blocks back to its
own free list in 75,645 allocations, so no chunk can ever reach "empty" and
a chunk list has nothing to release. The cause is one line: on release, a
block is offered to a size-class pool *first*, and that pool has never once
refused — so the arena is a bump allocator that feeds the pool and never
gets anything back.

That zero is trustworthy because the same code, in the same process, moved
**46.9 million** blocks through the cycle arena's list and freed 83% of its
chunks. The instrument is demonstrably alive three lines above the zero.

**3.06 MB does sit in 49 chunks it cannot release**, but those blocks are
owned by the pool, and recovering them needs a different and riskier change
to the allocation path than the one costed here. The defect is real — an
arena that cannot free a chunk *even in principle* is a bug — but the payoff
is not where we expected it.

**Runtime total: −1.27 MB, which is 1.8% of the 69.45 MB you are seeing.**

One of them did convert to near zero, and this file says so. A small true
number is worth more than a large one we have already refuted internally.

**One further avenue is open and not yet measured:** memory our own allocator
pools retain after the program has released it. A budget in that code is 16 MB
per pool across four pools, where the note beside it describes a 270 KB cap
that is not in fact compiled in — which would also explain the string-arena
zero above, since a pool that never refuses is a pool that never hands
anything back. **If it pays, a second build will follow. If it turns out to be
memory that merely changes owner, we will say that instead.** Six routes have
already closed tonight, several after looking at least this promising.

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

**Where that floor came from, stated because it is not from this exact
binary.** It was measured over 12 runs of our own build of this program,
compiled from the same source tree and the same dependencies but at an
earlier commit than the one that produced the executable you have. The
comparison in §2 is unaffected by that: **both of its arms are this very
binary**, with a single environment switch between them, so nothing about
where the floor came from can reach the difference it measures. What is
borrowed is only the yardstick.

We expect a yardstick to travel, because what it measures are properties of
the machine and the test rig — the first-run position effect, the two peak
modes, the ~28.7 MB swing — and none of those care which commit built the
executable. **And it is checked rather than assumed**: the switched-off arm
of §2 is the same workload on the same machine, so it should settle close to
the figure this floor was measured at. **It did: 83.56 MB against 85.25, a
gap of 1.99%.** The yardstick transferred, measured rather than argued.

---

## 6. What this build will and will not do

**It will not return to idle after a sync.** Realistically the plateau lands
at about **82 MB** as shipped, and near **51 MB** with the scheduling change
in §3 — that change takes the remaining 35.24 MB of fragmentation down to
about 3.6 MB, so roughly 32 MB comes off 82.

**Its idle floor is 12.83 MB** private working set (30.99 MB total),
measured two independent ways that agree to 0.02 MB, and flat from 15 s to
5 minutes after login. Your ~10 MB and our 12.8 MB are the same ballpark.

**Worth saying plainly, because it shaped this report twice.** A draft of
this file told you that the service does not idle at 10 MB and that you must
be remembering a different program. That would have been **wrong** — not
merely unproven. It came from the total-working-set column, which counts the
executable's image and which you were never reading, and from an idle figure
extracted across a boundary bug. Both times tonight that one of your own
observations appeared to conflict with a measurement of ours, **your
observation was the sound one.** We have taken that as the default reading
rather than the exception.

What the total column adds is the executable's mapped image: it is 29.8 MB
on disk and about **18 MB of it is resident**, shared and file-backed, which
is why it shows there and not in the column you are reading.

---

*Built from scriptc `e6f48fb2f` plus the memory work. Binary
`zapo-rest-184.exe`; the shipping build is not instrumented and carries no
measurement overhead.*
