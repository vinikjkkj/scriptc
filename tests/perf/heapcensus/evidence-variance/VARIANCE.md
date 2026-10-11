# The committed heap does not move the way one pair said it did — and the chunk count is not 47

Six runs, three per arm, alternated `A B B A A B`, on the two binaries the
committed manifests name. Nothing was built. The order and both predictions
were written to `PREREG.txt` at **08:08:23Z**; the first run started at
**08:09:07Z** (`v1-run/a1.manifest.txt`, `started`). Forty-four seconds, and
the file has not been touched since except to normalise its line endings —
see §7.

---

## 0. The three sentences

1. **`busy` falls by 3,020,443 B and it is not close to noise:** `|t| = 487`,
   and with the position-1 run dropped the delta lands **395 B** from the
   mechanism's exact prediction of `46 × 65,536`. This half of the brief's
   prediction is confirmed with room to spare.

2. **The committed column is not readable at this sample size, and the brief's
   `+2,330,464 B` is an artefact of reading one pair.** Arm B's *own*
   committed range, across three back-to-back runs of one binary at fixed
   knobs, is **3,803,200 B** — larger than the effect being read off the pair.
   This slice's committed delta is `-3,975,541 B` with a 95% CI of
   `[-8,990,884, +1,039,802]`, which contains zero and does **not** contain
   the brief's `+2,330,464`. Power to detect a true 2.33 MB shift here: **1.1%**.

3. **The 3.02 MB does not leave heap 0 at all.** `busy + free + uncommitted`
   differs between the arms by **74,784 B out of 66.0 MB** and is not
   separable from zero. What the repair changes is how heap 0 *partitions* its
   reservation; which side of the free/uncommitted line the released space
   lands on is precisely the quantity with ~2.0 MB of per-run jitter.

---

## 1. The instrument, named before anything was measured

The brief asked which instrument produced the `free` and `uncommitted`
columns, because `HCTOTAL` reports only `busy`, and because a column answering
a different question has already cost this front 56% of a free heap.

**It is one function and one pass:**

* `tests/perf/heapcensus/scr_heap_census.h:298` — `scr_hc_walk`. A single
  `HeapWalk` loop accumulates `busy`, `busyBlocks`, `free`, `freeBlocks`,
  `uncommitted` and `regions` from the *same* entry stream, classifying each
  entry by `wFlags` into busy / uncommitted / region / (else) committed-free.
* `tests/perf/heapcensus/scr_heap_census.h:380` — the `fprintf` that prints
  all six numbers on one line.

**Therefore the brief's subtraction is instant-consistent.** `busy` and `free`
are not from different moments; they are from the same walk of the same heap
under the same `HeapLock`. The hypothesis survived this check, which is why
the runs were worth spending.

Three further properties a reader needs:

* **When.** Once, at `_Exit`, through the macro chain at
  `scr_heap_census.h:797-822`. Exit handlers never run in these binaries
  (`process.exit` lowers to `_Exit`), which is the whole reason the chain
  exists.
* **Which heaps.** The loop walks **every** process heap from
  `GetProcessHeaps` (`scr_heap_census.h:689`) and prints one line per heap;
  `ALLHEAPS` at `:719` is their sum. The line this slice and `sb.compare.txt`
  both read is `heap 0 … CRT`, one heap.
* **Which tables.** `HCSIZE` and `HCFREE` are gated on `heaps[k] == crt`, so
  the histograms are CRT-only while `ALLHEAPS` is not. Mixing the two is
  available as a mistake; neither this slice nor `sb.compare.txt` makes it.

One caveat carried forward rather than rediscovered: `HeapWalk` reports
`cbData` as the **request** for a busy block and as the **block extent** for a
free one, so an `HCFREE` row is not comparable with a request. The correction
is at `scr_heap_census.h:335-348` and in `HOLEMAP.md`. This slice reads only
the aggregate line, so it is not exposed.

---

## 2. The mechanism, checked first because it was the cheapest kill

The brief asked whether the 47 chunks are ever `free`d, on the grounds that if
they are not, the CRT free list cannot be where the released bytes went.

**There IS a free path, and it is reachable.** `scr_str_chunk_free` is
`packages/runtime/src/scr_string.c:822`, and `scr_str_idle_drain` calls it at
`scr_string.c:1040`. It is gated: a chunk is released only when
`h->freeseen == h->carved`, i.e. every block carved from it is sitting on a
free list in the same idle window. So "no free path" is the wrong answer.

**But the gate never opened, in any run on record.** `PROF` for
`scr_string.c:820` reads `freed = 0` in all three of this slice's POST runs and
in the committed `sa` and `sb` arms. Zero chunks were returned.

**And the deeper point makes the free list impossible as a destination
regardless.** The repair is at `scr_string.c:820`:

```c
/* post  */ static void *scr_str_chunk_alloc(void) { return malloc(SCR_STR_ARENA_CHUNK); }  /* 65,536 */
/* pre   */ return _aligned_malloc(64<<10, 64<<10);
            /* mingw forwards to malloc(size + align-1 + sizeof(void*))
               = 65536 + 65535 + 8 = 131,079  -> the HCSIZE 131079 row */
```

The missing 3.0 MB in the POST binary is **never requested**. It is not freed,
so it cannot be on a free list. A reduction in *request size* does not put
bytes anywhere; it declines to take them. The `+5,335,312 B` the brief
measured on the `free` column therefore has a different owner, and §4 shows
what that owner is.

**This refutes the stated mechanism of the brief's hypothesis while leaving
its arithmetic intact** — which is why the runs still had to happen: the
numbers could have come out any way.

---

## 3. The predictions, both registered before run 1

Quoted from `PREREG.txt`, which predates `a1` by 44 seconds.

| | prediction | verdict |
|---|---|---|
| **P1** (brief, agreed) | `busy` falls ~3.0 MB, reproducibly | **CONFIRMED.** `-3,020,443 B`, `\|t\| = 487`, arm-B sd 762 B |
| **P2** (brief) | committed is **flat or up**; the release goes to the free list | **NOT SUPPORTED.** Point estimate is the opposite sign and neither sign separates |
| **P2** (this slice) | committed is **not separable from zero** at n=3; `\|t\| < 2` predicted | **CONFIRMED on the verdict, MISSED on the number.** `\|t\| = 3.41` against `t_crit(df=2.03) = 4.303` — not separable, but by a narrower margin than predicted |
| **P3** (this slice) | per-arm sd on `free` and `uncommitted` ≥ ~1 MB; per-arm sd on `busy` a small fraction of 3.0 MB | **CONFIRMED.** Arm B: 2,012,395 B and 2,022,748 B against a `busy` sd of **762 B** |

**P2's number was predicted wrong and the prediction is left standing.** `|t|`
came out 3.41, not under 2. The verdict did not turn on it only because the
Welch degrees of freedom collapse to 2.03 under this slice's 12:1 variance
ratio, putting the bar at 4.303 rather than the 2.776 of `df = 4`. A reader
who takes the critical value at `df = 4` — the default reflex at n=3+3 — gets
"SEPARABLE" and concludes the repair returned 3.98 MB to the OS. It does not,
and the margin between the two readings is the whole result.

**The brief named its own weakest half correctly.** It flagged *"que um par
pré/pós tirado em dois dias diferentes possa carregar um delta de 2,33 MiB"*
as most likely to be wrong. It is wrong, and the within-arm range is the
proof: one arm, one binary, three consecutive runs, **3,803,200 B** of spread
on the very column the pair was being read on.

---

## 4. Where the bytes actually go

```
delta busy         = -3,020,443 B    |t| = 487.15   SEPARABLE
delta free         =   -955,099 B    |t| =   0.82   not separable
delta uncommitted  = +3,900,757 B    |t| =   3.34   not separable
                     ------------
busy+free+unc      =    -74,784 B    |t| =   0.85   NOT SEPARABLE FROM ZERO
```

Heap 0 reserves the same ~66.0 MB in both arms. The repair moves 3.02 MB out
of `busy` and heap 0 keeps it, as free-or-uncommitted, in a proportion that
varies run to run.

The split is the noise and the sum is not — but **only clearly so on arm B**:

| arm | `free` range | `uncommitted` range | **sum** range |
|---|---:|---:|---:|
| A (pre) | 331,968 | 159,744 | **294,112** |
| B (post) | 3,804,048 | 3,809,280 | **43,792** |

Arm B swings 3.8 MB on `free`, has it absorbed to within 43.8 KB, and is the
clean demonstration. Arm A compensates only partly. **A Pearson `r` pooled
over all six runs would read `-0.80` and would be measuring the repair, not
the jitter**, because `busy` differs by 3.02 MB between the arms and the three
columns sum to a near-constant. It is not quoted here for that reason, and at
n=3 a per-arm `r` is three points.

**Consequence for the headline.** "Did the repair give memory back to the OS?"
is a question about the *committed* column, and this slice cannot answer it:
the CI spans `-8.99 MB` to `+1.04 MB`. What it can say is that the brief's
`+2.33 MB` is not evidence for the "no" answer, and that the total extent of
heap 0 is unchanged.

---

## 5. The correction that falls out: the chunk count is not 47

| observation | chunks | source |
|---|---:|---|
| `evidence-idle/on` (pre) | 46 | `HCSIZE 131079 46 6030160` |
| this slice `a1`, `a2`, `a3` (pre) | 46, 46, 46 | `HCSIZE 131079` |
| this slice `b1`, `b2`, `b3` (post) | 46, 46, 46 | `PROF … scr_string.c:820` |
| `evidence-postfix/sa` (post, FIBER) | 47 | `PROF … scr_string.c:820` |
| `evidence-postfix/sb` (post, STACKLESS) | 47 | `PROF … scr_string.c:820` |

**46 in six of eight; 47 in two, both of them the 2026-10-11 post-fix pair.**
The live chunk population moves by a whole 64 KiB chunk between runs of a
fixed binary at fixed knobs.

So the realized release is **not** a constant `47 × 65,536 = 3,080,192 B`. At
the modal 46 it is `3,014,656 B`, and the measured `busy` delta agrees:

```
busy delta, all six runs      = 3,020,443 B   (residual vs 46 x 65,536:  +5,787 B)
busy delta, position 1 dropped = 3,014,261 B  (residual vs 46 x 65,536:    -395 B)
```

**With their denominators named, in this slice's own runs:**

* **Route B — 15.940%** = `3,014,656 / 18,912,757`, denominator = mean heap-0
  `busy` of this slice's **three PRE runs**.
* **Route A — 15.945%** = `3,014,656 / 18,906,971`, denominator = mean heap-0
  `busy` of this slice's **three POST runs plus the release**.

The record raised this headline from **15.940%** to **16.226%** on the strength
of `sb`'s 47 chunks. At the modal 46 it reads 15.94% again. **The raise rests
on a single draw of a quantity that moves by 65,536 B.**

### `sb` is an outlier on more than the chunk count

Against this slice's three POST runs, the committed `sb` row sits at
`z = +13.5` on `busy` and `z = +150` on `busyBlocks` (47,940 against
47,625 / 47,626 / 47,629, sd = 2). The committed `on` row, by contrast, sits
comfortably inside this slice's PRE arm (`z = -0.50` on `busy`, `z = -0.61` on
`busyBlocks`). **Whatever made `sb` heavy is specific to that run**; this
slice does not identify it and does not speculate. It is named so that the
next reader does not treat `sb` as the POST arm's centre.

---

## 6. The position-1 effect is visible in the settled census too

The host's known first-run anomaly is documented for *peak RSS*. It shows up
here in the **settled** census as well, which is why `ABBAAB` was chosen over
`ABABAB` and why the leave-one-out was promised in advance:

```
a1 (position 1)  busy 18,925,120   busyBlocks 47,674
a2 (position 4)  busy 18,906,928   busyBlocks 47,626
a3 (position 5)  busy 18,906,224   busyBlocks 47,624
```

`a1` is ~18,600 B and ~50 blocks heavier than its own arm-mates. Dropping it
*tightens* the result rather than changing its sign: arm A's `busy` sd falls
from 10,712 B to 498 B and the delta lands 395 B from the mechanism's exact
figure. **Nothing in §0–§5 depends on including or excluding it**; both tables
are in `RESULTS.txt`.

---

## 7. What contradicts the brief

1. **"todo arquivo em `tests/perf/heapcensus/` é CRLF puro na main."** False.
   Audited over the whole directory: **60 LF-only, 27 CRLF, 2 mixed, 2 with no
   newline.** The real rule is narrower and mechanical: **CRLF is exactly the
   set of files the instrumented C binary writes** — `*.heapcen.txt`,
   `*.prof.txt`, `*.cycstat.txt`, `footprint.txt` — because Windows text-mode
   `fopen` turns `\n` into `\r\n`. Every hand-written file in the directory,
   including `sb-run.sh`, `sb-rig.sh`, `sb.manifest.txt` and `LANE.txt`, is
   LF-only. This slice follows the real rule: prose and scripts LF, copied
   `*.heapcen.txt` byte-for-byte as the binary wrote them. `PREREG.txt` was
   written CRLF under the brief's rule and then normalised to LF; the content
   is unchanged and the mtime proof in the header still stands.

2. **"reproduzido byte a byte em dois binários" (3,080,192 B / 47 chunks).**
   The two binaries that agreed are `sa` and `sb`, both run on 2026-10-11.
   Three fresh runs of `sb`'s own binary read 46 chunks each. The *per-chunk*
   delta of 65,536 B is exact and does reproduce; the *count* does not.

3. **"Cada corrida ~2,5 min."** Measured 2.33 min across six manifests. The
   full six-run sequence cost 14.0 min of wall clock.

4. Confirmed as stated, for the record: both `.ll` sizes
   (242,844,741 / 242,844,729), `HCSIZE 131079` present pre / absent post, the
   `scr_string.c:820` string present in the POST exe and absent in the PRE,
   and `census-arms.sh:132`'s bare `tsx` specifier — avoided by using the
   absolute `file://` URL, as instructed.

---

## 8. What this slice did NOT do, and why

* **Did not rebuild anything.** Both exes were verified in place. A build is
  ~9 min and changes the question.
* **Did not take `n = 10` per arm**, which is what the committed column would
  need: pooled sd 1,427,496 B puts the 80%-power MDE at **5.72 MiB** at n=3,
  and 10 per arm would bring it to 2.31 MiB — **46.6 min of wall clock**. The
  brief asked for three each; the shortfall is quantified rather than
  silently absorbed.
* **Did not quote RSS, private commit, throughput or wall-clock** from these
  binaries. They carry `RtlCaptureStackBackTrace` in the allocation path and
  `WHICH-BUFFER.md` §5 forbids it.
* **Did not touch `evidence-postfix/sb.compare.txt`.** It is generated by
  `sb-compare.sh` and cannot be regenerated without re-running `sb`. The
  amendment is appended to `POSTFIX-CENSUS.md` instead, quoting the sentence
  it corrects.
* **Did not re-measure the FIBER arm (`sa`).** Both arms here are STACKLESS,
  so the lane figure in `POSTFIX-CENSUS.md`'s `RESOLVED` banner — settled CRT
  busy `-340,480 B` — is **untouched by this slice**, neither corroborated nor
  disturbed. It remains what that banner calls it: one pair, no variance
  estimate, read as a ceiling. Note only that it is a 340,480 B claim and this
  slice measures a 3,803,200 B within-arm range on neighbouring columns, so
  the same question applies to it and is still open.
* **Did not explain why `sb` ran heavy.** Named in §5, not diagnosed.

---

## 8b. The analysis recipe runs from the tree

`stats.mjs` reproduces every number in `RESULTS.txt` when run from this
directory **with no arguments**, against the six committed `*.heapcen.txt` and
`chunkrows.txt`. Verified by running it and diffing: identical. It also takes a
live memrig output root as `argv[2]` and gives byte-identical output there.

This is deliberate. `census-arms.sh:132` is a committed recipe that dies before
a line of memrig runs, and this front has repeatedly criticised recipes nobody
executed. The check cost one command.

One trap it is armed against, because it was hit while building
`chunkrows.txt`: the `*.heapcen.txt` and `*.prof.txt` are **CRLF**, so a
regex anchored with a bare `$` matches nothing in them and returns a clean,
silent empty result. Every anchor in `stats.mjs` is `\r?$`.

---

## 9. Landing

Branch `perf/heapcen-committed-variance` from `ff33bac69`, worktree
`G:\blocks\v1-wt`. The diff is **`tests/perf/**` only**, so it is **green by
construction — no gate runs `tests/perf`**. Not merged and not pushed.
