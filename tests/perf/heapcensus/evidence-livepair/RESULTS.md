# The megabyte pair is never two-deep: one copy at a time, and the copy is removable

Three questions, in the order they decide things.

## 1. Are the three buffers alive at once? NO. The hypothesis loses its larger half.

Preregistered hypothesis (FR2, before this slice): per history-sync chunk the
same payload is resident **three times** -- the reader buffer grown to the next
power of two (1,048,576), the producer's take (934,576), and an exact copy of
it (934,576) -- ~2.9 MB per chunk x 8 = ~23 MB, matching the 24,390,400 B the
PROF bands measured.

That arithmetic adds a **flow** to a **population**. The bands count
allocations over a whole run; two 934,576 allocations per chunk is not two
934,576 blocks resident. `lp-livecount.mjs` reads the peak census instead --
`HCPKSIZE` is the busy-block histogram at the high-water instant -- and the
answer is unambiguous:

```
 run arm pos   cover   1,048,576      934,576   ratio
 p1  SL   1    99.46%      6             6       1.00
 p2  FB   2    99.86%      6             6       1.00
 p3  FB   3    99.93%      6             6       1.00
 p4  SL   4    99.97%      7             7       1.00
 p5  SL   5    99.15%      6             6       1.00
 p6  FB   6    99.86%      7             7       1.00
```

**1:1 in all six runs**, both lanes, and the reader class never outruns the
payload class in either direction. Per chunk the peak holds
`1,048,576 + 1 x 934,576 = 1,983,152 B`, not
`1,048,576 + 2 x 934,576 = 2,917,728 B`.
**The hypothesis over-predicts live bytes per chunk by 47.1%.**

Denominators, stated: the counts are of **busy blocks of that exact request
size** at the peak instant of **one run**, from `evidence-peakvar`
(tree `be8d74ddb`), six runs, three per lane, arms fixed in that slice's PREREG
before run 1. The band counts quoted above are from **`evidence-megapair`**
(`mb-out182-prof`), a different build; nothing in this file mixes a count from
one with a count from the other. Peak coverage
(`snapPrivate / kernelPeakPagefile`) is 99.15-99.97%, so every row is a
reading of the peak and not of a trough beside it.

Controls. **Positive**: the 65,536 class (string arena + cycle-collector
arena) reads 305/314/315/326/306/356 -- it varies and is two orders above
`CHUNKS=8`, so a parser returning constants or zeros would have failed here.
**Negative**: class 1,048,575, one byte off the real one, is absent in all six
-- a loose match would have invented it. Both discriminate.

Note that 6-or-7 of `CHUNKS=8` are resident at the peak, never 8. The peak is
an instant, and one or two of the eight chunk pipelines are between buffers
when it is taken.

## 2. The producer, named

`evidence-megapair/mb.symbols.txt` resolved stack A to `<unmapped>` in every
frame because its map carried only `zapo-rest.obj` and `scr_bytes.obj`. Three
more runtime TUs close it. Every map was accepted only after **every** public
inside its range agreed with the object's own COFF table (59/59, 92/92,
180/180, 238/238, 3/3, 1/1); no map was refused. Names come from COFF
symbols, never from the PDB, which misnames on this lane.

```
A  8 x 934,576     scr_bytes_alloc+488          scr_bytes.c:52
                   scr_stream_rbuf_take+550     scr_stream.c:623
                   scr_stream_settle_next+302   scr_stream.c:1369
                   scr_stream_run_tick+1385
                   scr_stream_dispatch_one+75
                   scr_loop_run+418  <-  main+1001  <-  __tmainCRTStartup

C  8 x 934,576     scr_bytes_alloc+488          scr_bytes.c:52
                   scr_bytes_copy+27            scr_bytes.c:79
                   scr_dyn_new_buffer_copy+131  scr_json.c:2171
                   scr_stream_next_fulfill+198  scr_stream.c:1290
                   scr_stream_settle_next+440   scr_stream.c:1373
                   scr_stream_run_tick+1385     (identical suffix to A)

B  8 x 1,048,576   scr_bytes_alloc+488
                   sc_tr__x25__x25_m41_ProtoStreamReader_ensure+2024
                   scr_trampoline+144
```

**A and C are the same stack frame of the same function.**
`scr_stream_settle_next` calls `scr_stream_rbuf_take` at +302 and
`scr_stream_next_fulfill` at +440 -- `scr_stream.c:1369` and `:1373`, four
lines apart. The producer is the iterator's read() taking the whole buffered
length as one Buffer; the copy is the dyn-boxing of that same Buffer on its way
into the settled promise.

## 3. Is the copy semantically necessary? NO -- and the ownership says so in one line.

`scr_stream.c:1279` declares the parameter `void *chunk /*moves or NULL=EOF*/`.
`scr_stream_next_fulfill` **owns** the chunk. In the `next_dyn` arm
(`scr_stream.c:1289-1291`):

```c
d = scr_dyn_new_buffer_copy((ScrBytes *)chunk);
scr_bytes_release((ScrBytes *)chunk);
```

The clone is made and the original is dropped **on the next statement**. That
is why the peak census reads 1:1: the producer's buffer and its copy coexist
for exactly the duration of one `memcpy` inside `scr_bytes_copy`
(`scr_bytes.c:78-80`), and then one of them is gone. The 1:1 reading is not a
coincidence of sampling; it is what this code forces.

And that same ownership makes the copy removable. The runtime already has the
aliasing constructor, with a header comment that states the rule
(`scr_runtime.h:5436-5443`, `scr_json.c:1892`):

> `scr_dyn_new_bytes_ref` -- "one refcounted payload, two views of it [...] the
> static->dyn BOUNDARY constructor: a typed array is the one composite whose
> static and dynamic representations are the same refcounted `ScrBytes`, so the
> crossing SHARES instead of copying [...] exactly Node, which has no copy at
> all."

`scr_dyn_new_buffer_copy` is `scr_dyn_new_bytes_copy` plus `d->buffer = true`
(`scr_json.c:2170-2174`); the aliasing twin differs only in `scr_bytes_retain`
vs `scr_bytes_copy`. Replacing copy+release with a **move** would be the same
value with one fewer 934,576-byte allocation and one fewer 934,576-byte memcpy
per chunk.

**The aliasing hazard, and why it does not bite on the measured path.**
`scr_stream_rbuf_take` has two exits (`scr_stream.c:583-640`):

* the whole-chunk fast path returns `first`, the buffered entry itself, whose
  reference was the read buffer's. A pushed Buffer *can* still be held by the
  producer, so aliasing it would publish a shared payload. Node aliases here
  too, so this is arguably more faithful rather than less -- but it is a
  behaviour change and it is not what fires in this workload.
* the concatenating path, which is what the 934,576 class **is** (one take of
  `st->r.length` spanning several pushed entries), builds `out` with
  `scr_bytes_new` -- freshly allocated, `rc = 1`, aliased by nothing. On that
  path the clone is provably a copy of a buffer whose only reference is
  released two statements later.

**Verdict: the copy is not semantically required, and the target survives --
but it is worth one 934,576 per chunk, not two.** At 6-7 chunks resident at the
peak that is **5.6-6.5 MB of the peak**, against the ~7.5 MB the three-live
hypothesis promised. Measured, per run: `6 x 934,576 = 5,607,456 B` (p1, p5)
and `7 x 934,576 = 6,542,032 B` (p4) -- removable in principle from a peak
whose `snapPrivate` is 99,692,544 B (p1), 108,261,376 B (p4) and 99,340,288 B
(p5), i.e. **5.62%, 6.04% and 5.64% of private bytes at the peak** of those
three stackless runs. Those are three single runs, not an interval.

**This slice does not make the change.** It touches `tests/perf/**` only. The
edit is in `packages/runtime/src/scr_stream.c` and needs a gate.

## 4. The ~114,000 B of slack is the doubling, and it is a default with no knob

`1,048,576 - 934,576 = 114,000`, and 1,048,576 is 2^20. The grower is
`ProtoStreamReader.reserve`, in the app's dependency and not in this repo:
`tests/perf/zapo-rest/app182/node_modules/zapo-js/dist/esm/util/proto-stream.js`,
lines 132-158, the grow arm at 147-158.

```js
let grown = this.buffer.byteLength;
while (grown < live + incomingBytes) { grown *= 2; }
```

from `PROTO_STREAM_INITIAL_BUFFER_BYTES = 64 * 1024` (line 3). 64 KiB doubled
four times is 1 MiB, and 524,288 < 934,576 <= 1,048,576, so 2^20 is the first
capacity that fits. **The slack is the doubling and nothing else** -- not a
rounding policy, not an allocator size class, not an over-reserve.

`reserve` also tries a `copyWithin` compaction first (lines 136-146) and only
grows when compaction cannot fit the incoming bytes, so the growth is not
eager. There is **no knob**: `PROTO_STREAM_INITIAL_BUFFER_BYTES` is a
module-level `const` in the published dist with no env read and no constructor
option -- nothing was "left off" or "left unset". Geometric growth with a
factor of two is the ordinary amortized-append policy, whose worst-case slack
is just under 50% by construction. **A default is not a defect**, and 912 KB of
slack across eight chunks is not called waste here.

One thing worth recording about `reserve` that no census class names: during
growth the old buffer and `next` are both live for one `set` (line 152), so a
grow from 524,288 to 1,048,576 transiently holds 1.5 MiB. That is a flow
observation, it was not measured here, and it is not claimed as retention.

## What this slice did NOT do

* **No build and no run.** Everything above reads committed evidence plus the
  objects and binary of `mb-out182-prof` already on this host.
* **The 65,536 class (28.7% of the transient) and the 4,376 SQLite page cache
  (22.3%) were not touched.** Only the megabyte pair was in scope.
* **Stack D's five `<unmapped>` frames (214402, 20c1d9, 214f0e, 21081e,
  221871) are still unnamed.** D is the singleton 1,048,576 on the websocket
  send path; it is 1 of 25 allocations and does not bear on the pair.
* **The removal was not implemented or measured.** The 5.6-6.5 MB figure is
  what the census says is resident, not a measured saving. Nothing proves the
  heap returns it -- this frontend's retention has already been shown to be
  placement-dependent, and a freed block in the middle of a busy region does
  not shrink the commit.

## What contradicts the briefing that commissioned this slice

* The briefing's headline hypothesis -- three resident copies per chunk -- is
  **refuted**, in the direction the briefing itself flagged as most likely
  wrong. Its fallback test ("if 934,576 reads 6-7, there is one copy live at a
  time and the hypothesis falls by half") is exactly what happened: 6, 6, 6, 7,
  6, 7.
* The briefing said the 934,576 class would read "12-14 (two per chunk)" if the
  hypothesis held. No run reads above 7.
* The briefing describes stack A's frames as being "in an unmapped runtime TU".
  They are in `scr_stream.obj` and `scr_async.obj`, both of which map cleanly
  with 92/92 and 180/180 publics agreeing. Nothing refused.
* The briefing framed the slack as possibly "a policy other than doubling".
  It is the doubling, verifiable in four lines of the dependency's source.

---

> ## MEASURED AND DEAD, 2026-10-11 (later the same day) - THE PEAK SAVING IS ZERO
>
> **The sentences this band answers.** In section *"3. Is the copy semantically
> necessary? NO -- and the ownership says so in one line."*:
>
> > "At 6-7 chunks resident at the peak that is **5.6-6.5 MB of the peak**"
>
> > "i.e. **5.62%, 6.04% and 5.64% of private bytes at the peak** of those
> > three stackless runs."
>
> and in section *"What this slice did NOT do"*:
>
> > "The 5.6-6.5 MB figure is what the census says is resident, not a measured
> > saving."
>
> **The change was made and the figure was measured. It is zero.** The patch is
> `16d91996f` (`scr_stream.c`, the share on the one `scr_stream_rbuf_take_f`
> path that owns its buffer); the measurement is `58bb43ffc`,
> `tests/perf/heapcensus/evidence-chunkref/`, 3 runs per arm alternated.
>
> **The refutation, by section and sentence.**
> `evidence-chunkref/VERDICT.md`, section *"The deciding item, and it is a
> COUNT, not a t"*:
>
> > "**PRE reads 6, 7, 6. POS reads 6, 7, 6.**"
>
> The 934,576 class reads 6, 7, 6 blocks live at the peak on the PRE arm and
> 6, 7, 6 on the POS arm, run for run, 1:1 with its 1,048,576 partner in all
> six. **This file counted the copy as an EXTRA resident buffer. It never was
> one** - the original dies one instruction after the copy, so the live
> population per chunk was already one in both arms.
>
> **What killed it is the count, not a t test.** `VERDICT.md` section *"The
> peak aggregate, and an honest statement of its weakness"* records that the
> aggregate null has 12.2% power against this very figure and an MDE of
> 10.67 MiB, so the t columns prove nothing here. The per-class count, which
> has no spread, is what settles it.
>
> **What survives, and it is not nothing.** The copy is still removable and the
> patch still removes real work: `VERDICT.md` section *"The patch does work. It
> removes 7.48 MB of FLOW per run"* measures 48 -> 40 copies at
> `scr_bytes.c:52` (exactly `CHUNKS=8` fewer) and 7,475,028 B less turnover per
> run. **Sections 1, 2 and 4 of this file, the producer naming, the 1:1
> ownership argument and the 114,000 B doubling, are untouched.** The
> distinction this band enforces is FLOW against RETENTION: the patch removes
> flow and moves resident peak bytes by nothing.
>
> **Sections of this file not named above are NOT thereby in force; they are
> merely UNAUDITED by this band.**
