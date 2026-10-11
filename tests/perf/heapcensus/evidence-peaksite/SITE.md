# 4,376 is SQLite's page cache, NAMED. The megabyte pair is narrowed to ONE surviving site and is NOT nameable with what is committed.

> **The short answer.** Of the three unnamed peak-only classes, **one is now
> named with three independent strands** (`4,376` = `vendor/sqlite/sqlite3.c:28035`,
> `sqlite3MemMalloc`), and **two are narrowed to a single surviving candidate
> by arithmetic elimination** (`1,048,576` and `934,576` → `scr_bytes.c:52`,
> the `ScrBytes` payload `calloc`). The second result is **an elimination over
> the set PROF registers, not a naming**, and the one-line change that would
> close it is in §5.
>
> **`PEAK-OCCUPANT.md` §4 was right that naming the pair needs the stack lane
> — and wrong that the data was not already there for the 4,376.** The stack
> lane *was* armed, on `sizeband2=4376..4376`, in the build that produced
> `evidence-postfix/sb.prof.txt`. §4's own sentence "Naming the site needs the
> `scr_prof.h` stack lane, which is a second build and a second slice" was
> written before that build existed; the build landed and nobody went back.

No build and no run. Everything below re-reads bytes already committed at
`272390bd2`. `tests/perf/**` only ⇒ **green by construction**: no shipping
source, no test fixture and no build input is touched, so no gate can change
colour from this commit.

Reproduce: `node tests/perf/heapcensus/evidence-peaksite/site-attrib.mjs`
from the committed directory, no arguments, node v25.9.0. It rewrites
`RESULTS.txt` byte-identically (19,190 B, md5 stable across re-runs).

---

## 1. The finding that unblocked the rest: the census class IS the request

The briefing asked me to **derive** the allocator overhead rather than guess
it, calibrating on a known class. Doing that dissolves the question.

`scr_heap_census.h:317` calls `scr_hc_note((size_t)e.cbData, (size_t)e.cbOverhead)`;
`:161` matches the table **exactly** on `size` (`if (tbl[j].n != 0 && tbl[j].size != size) continue;`),
and `:167` does `tbl[j].bytes += size + overhead`. So the **class label is
`cbData`, the request, never banded**, and the overhead lives only in the
bytes column. A PROF request size and a census class label are therefore the
**same quantity**, and compare with no correction term at all.

The briefing's "class 1,328 measures 1,360 = 1,328 + 32" is the bytes column,
not the label. And calibrating on it would have been wrong anyway — the
overhead is **not a constant**:

| class | mean overhead/block |
|---:|---:|
| 1,048,576 | **0.00** |
| 934,576 | 16.00 |
| 4,376 | **248.00** |
| 65,536 | 18.4 – 19.7 (**non-integral** ⇒ mixed geometry) |
| 1,328 | **16 in p1/p4/p5, 32 in p2/p3/p6** ⇒ moves with population |

That the 1 MiB class alone reads 0.00, in all six runs, is an **observation
about block geometry, not an explanation**. I do not know why, and I did not
guess.

## 2. 4,376 — NAMED, three independent strands

`vendor/sqlite/sqlite3.c:28035`, in **`sqlite3MemMalloc`**:

```c
p = SQLITE_MALLOC( nByte+8 );   /* then p[0] = nByte; p++ */
```

The function is SQLite's default `xMalloc`. The `+8` is the eight-byte size
prefix SQLite stamps ahead of every block so `sqlite3MemSize` can read it
back. That is the `+ 8` in `WHICH-BUFFER.md` §2's `4096 + 216 + 56 + 8 = 4376`:
one `pcache1Alloc` buffer per database page.

Three strands, and they do not share an assumption:

1. **Site table.** It is the only surviving site in octave 12 (`[4096, 8192)`).
2. **Stack capture.** The PROF build was armed on `sizeband2=4376..4376`
   (`sb-build.sh:16`), and `PROFSTACK` holds **2,780 allocations × exactly
   4,376 B = 12,165,280 B**, exact to the byte ⇒ a pure class, not a band.
3. **Source arithmetic**, above.

**The two sites that OUTRANK sqlite in that octave are eliminated by
arithmetic, not by ranking** — this is the part a size-match would have got
wrong:

- `scr_array.c:444` (17,815 octave-12 allocations, the top row).
  `scr_arr_grow` at `scr_array.c:391-399` sets `cap = a->cap ? a->cap : 4`,
  **doubles** it, and requests `want = cap * sizeof(uint64_t)`. So
  `want = 2^(k+3)` — **always a power of two**, and 4,376 is not one. Its
  octave-12 traffic is all `want = 4096`; the next step, 8192, is
  `>= SCR_ARR_VM_MIN` (`scr_array.c:237`) and leaves the CRT heap entirely.
  The same fact removes it from octaves 19 and 20 a priori.
- `scr_heap_census.h:707` (137 allocations) is **the instrument itself**:
  `arm[i] = malloc(SCR_HEAPCEN_ARM_SIZE)` with `SCR_HEAPCEN_ARM_SIZE 5113`
  (`:289`). Corroborated by name in both census files:
  `HCTOTAL … armCount=137 armSize=5113` against exactly 137 octave-12
  allocations at that site.

Corroboration of shape, flagged as corroboration only: every `PROFSTACK` row
in the 4,376 band shares a **9-frame common prefix** and differs only at
frame 10 — the signature of a deep library malloc shim reached from many
callers. The frames are unsymbolised RVAs, so this is a shape argument and is
not load-bearing.

**This class was already characterised** by `WHICH-BUFFER.md` §2 and
`PEAK-OCCUPANT.md` §4 (including the release mechanism: `scr_async.c:2574-2575`
defaults `SCR_SQLITE_IDLE_RELEASE_MS` to 1000, the run idles 60 s, so the
cache is gone by shutdown). What is new here is the **`file:line`** and the
elimination of the two higher-ranked sites.

## 3. The megabyte pair — one site survives, and that is not a naming

Only **two** sites in the entire run allocate in octaves 19 or 20:

| site | octave 19 | octave 20 |
|---|---:|---:|
| `scr_bytes.c:52` | 48 | 40 |
| `scr_string.c:1217` | 32 | 31 |

(plus `scr_cycle.c:2292`, one single octave-19 allocation in `sa` only — it
cannot hold 6–7 live blocks.)

**`scr_string.c:1217` is ELIMINATED by the shape of its own request.** It is
`scr_str_regrow`, whose only caller is `scr_jb_grow` (the JSON builder):

```c
ScrStr *r = realloc(s, scr_pool_bytes(sizeof(ScrStr) + newcap + 1));
```

`sizeof(ScrStr) = 12` (`scr_runtime.h:754`, three `uint32_t` + `char data[]`),
`SCR_POOL_GRAIN = 8` (`scr_runtime.h:359`), `scr_pool_bytes(n) = (n+7) & ~7`
(`scr_runtime.h:433`). The builder's buffer **doubles from 64**
(`scr_string.c:1194-1196`), so `newcap = 2^k` and the request is
**`2^k + 16`** for every `k ≥ 4`. It cannot ask for 1,048,576; it asks for
1,048,592.

That is a falsifiable prediction, and it was checked: the classes of the form
`2^k + 16` present across **all twelve census instants** (6 runs × {peak,
shutdown}) are `32, 48, 80, 144, 272, 1040, 4112, 65552` — and **stop at
65,552**. `524,304` and `1,048,592` are absent from every instant, while PROF
shows the builder *did* allocate 31 blocks in octave 20 over the run. The
builder is visible, it is real, and its big buffers are never live when the
census fires.

**Surviving candidate: `scr_bytes.c:52`**, inside `scr_bytes_alloc`:

```c
b->data = calloc(len ? len : 1, scr_bytes_elem_size(elem));
```

This is the backing store for every `Uint8Array` and every `Buffer` — the
request is `len * elemsize`, **exact**, so any class value is reachable. It is
the right *kind* of object for a decode buffer, and it is the only registered
site left.

**It is still not a naming, and I will not call it one.** An octave is a
doubling wide: "`scr_bytes.c:52` allocates somewhere in `[512K, 1M)`" is not
"`scr_bytes.c:52` allocates exactly 934,576". No stack band was armed on these
sizes, so there is no second strand — unlike the 4,376, where there are three.

## 4. The count: 6 and 7 against `CHUNKS=8`

Both classes read 6 in p1/p2/p3/p5 and 7 in p4/p6 — **same mode, same run,
every run**. Neither ever reads 8.

The explanation is **not from this slice**. It is the phase trace in
`PEAK-OCCUPANT.md` §4, from the `evidence-peak` runs:

```
abba1A  chunk-decoded-1 20.995 | 2..7 all within 6 ms at 27.68 | 8 at 28.408
abba3B  chunk-decoded-1 20.972 | 2..8 all within 5 ms at 29.27
```

All eight chunks are *sent* inside 191 ms; the client holds them and decodes
them in one burst ~7 s later. **Chunk 1 always decodes alone at ~21.0 s** and
is released long before the burst. The burst is then chunks 2..7 (six) or
2..8 (seven). The peak census samples inside that window.

So **8 chunks = 1 early + (6 or 7) concurrent**: the census never sees 8
because chunk 1 is never concurrent with the rest. **Cross-run** — that trace
is a different build and a different set of runs; it explains the *shape*
6/7-not-8 that p1..p6 show, and no number is carried across.

## 5. What would close it, and it is one line

`sb-build.sh:16` already carries the mechanism:

```
-DSCR_PROF_STACK_SIZE_MIN2=4376 -DSCR_PROF_STACK_SIZE_MAX2=4376
```

One rebuild with the bands moved to

```
-DSCR_PROF_STACK_SIZE_MIN=934576   -DSCR_PROF_STACK_SIZE_MAX=934576
-DSCR_PROF_STACK_SIZE_MIN2=1048576 -DSCR_PROF_STACK_SIZE_MAX2=1048576
```

captures ten-frame stacks for both classes and turns the elimination into a
naming. That is a build and a run, which this slice was forbidden to do.

## 6. PROF coverage, measured

**POSITIVE CONTROL — it discriminates, and it passes.** The briefing named
"the allocations come from a vendored library and PROF cannot see them" as
the likeliest way this search returns a **false null**. It does not hold:
`sb.prof.txt` registers sites in `vendor/sqlite` (2) and `vendor/zlib` (1)
alongside 136 in `runtime/src`. More to the point, **the single most
load-bearing attribution in this slice — 4,376 = SQLite's page cache — rests
on a vendor site.** The feared blind spot would have destroyed exactly the
result that came out strongest.

**NEGATIVE CONTROL — it can only falsify, and it did not.** Every peak class
of p1 with `n ≥ 4` has at least one PROF site in its octave: 0 orphan classes,
100.00% of those bytes covered. **This is a weak control and says so**: an
octave is a doubling wide, so a pass is not proof that a class's *own* site is
registered.

**A CONTROL THAT DISCRIMINATED NOTHING, stated rather than buried.** I
compared PROF's outstanding allocations (`count − freed = 218,788`) against
the census's busy-block count at shutdown (`47,940`). The ratio is **4.56× in
the wrong direction** — PROF reports *more* outstanding than the heap holds
blocks — because PROF counts logical allocations that the string arena and the
pool serve by carving and recycling, which never become distinct CRT blocks.
It cannot measure a blind spot. It is reported because it was run.

## 7. What contradicts the briefing

1. **"As três com linha ausente … NENHUMA tem sítio nomeado."** The 4,376 was
   already characterised — `PEAK-OCCUPANT.md` §4 names it SQLite's page cache
   and dates its release mechanism to `scr_async.c:2574-2575`, and
   `WHICH-BUFFER.md` §2 gives the `4096+216+56+8` arithmetic. What was missing
   was the `file:line`, not the identity.
2. **The feared blind spot ("o PROF sequer enxergue esses sítios") is
   refuted**, and refuted on the strongest result rather than a side one.
3. **`PEAK-OCCUPANT.md` §4's "naming the site needs the `scr_prof.h` stack
   lane, which is a second build and a second slice" is stale.** That build
   exists and is committed (`evidence-postfix/sb.prof.txt`, armed via
   `sb-build.sh:16`). It is still *correct about the megabyte pair* — the
   bands were pointed at 1296..1352 and 4376..4376, not at the megabytes.
4. **The overhead-calibration premise is inverted.** The briefing says the
   census class "é o bloco e pode incluir overhead do alocador". It is the
   **request**; the overhead is a separate column, and it is not a constant
   (0 / 16 / 248 / non-integral / population-dependent), so a single
   calibration constant would have been wrong.
5. **The prediction's second half fails.** `934,576 = 2^4 × 58,411` with
   58,411 prime; `a − b = 114,000`, `b/a = 0.891281128`. No power-of-two
   ratio, no round difference, no shift-and-add of 1 MiB lands on it. It
   looks like a **datum** — a payload length that is what it is — not a size
   derived from a cap.

## 8. What I did not do, and why

- **No build and no run.** The brief forbade both and nothing here needed
  them. The one thing that *would* have needed a build is §5.
- **I did not symbolise the `PROFSTACK` frames.** They are unsymbolised RVAs
  and the binary that produced them is not in the tree; resolving them needs
  the PDB from that build. The stack evidence is therefore used only for
  *shape* (a 9-frame common prefix), never for identity.
- **I did not separate "one object with two allocations" from "two
  independent per-chunk buffers".** Both produce exactly the lockstep the six
  runs show. No committed column separates them. The overhead split (0 vs 16)
  is a hint that the two classes have different block geometry and therefore
  possibly different producers — **I noticed it and did not follow it up**,
  because following it means understanding a Windows heap accounting rule and
  that is not 30 minutes of work.
- **I did not re-derive the transient decomposition.** `evidence-peakdecomp`
  is taken as given; this slice only attributes its classes.
