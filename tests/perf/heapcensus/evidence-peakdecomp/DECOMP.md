# The stackless peak's 32 MB transient is FOUR classes, and the 1,328 row is the fiber lane's whole bill

> **What this answers.** `5cd3e3475` left one column undecomposed: on the
> stackless arm, the arm that ships, `pkCrtBusy / settled busy` reads
> **3.034 / 3.231 / 3.051** across `p1 / p4 / p5` — **~32 to 36 MB of CRT heap
> that exists at the peak and is gone at shutdown**. This slice decomposes it by
> size class from the `HCPKSIZE` rows of the six already-committed runs.
>
> **The answer: four classes are 88.2% of it, and three of those four have no
> shutdown row at all.** The fourth, the 64 KiB arena chunk, is half transient
> and half retained. Eight classes reach **99.0%**.

**NOTHING WAS BUILT AND NOTHING WAS RUN.** Every byte read is a committed
`../evidence-peakvar/*.heapcen.txt` written by the two instrumented binaries of
`5cd3e3475`. `peak-decomp.mjs` runs from this directory with no arguments and
reproduces `RESULTS.txt` exactly.

## 0. The denominators, before any share

| | |
|---|---|
| `pkCrtBusy` | `[heapcen] HCPKTOTAL bytes` — the **CRT heap only**, busy bytes, at the peak snapshot, **of this instrumented binary**. Sum of the `HCPKSIZE` rows and of nothing else. **Not** `HCPKHEAPS busy=`, which is all three process heaps. |
| `stCrtBusy` | `[heapcen] HCTOTAL bytes` — the same heap, the same tables, at `_Exit`. |
| `transient` | `pkCrtBusy − stCrtBusy`, **per run**. Every "% of transient" below divides by **that run's own** transient, never by an arm mean. |

```
run   lane         pkCrtBusy      stCrtBusy      transient    pk/st   mode
p1    STACKLESS    48,281,280     15,913,168     32,368,112    3.034   LOW
p4    STACKLESS    52,558,208     16,269,072     36,289,136    3.231   HIGH
p5    STACKLESS    48,498,880     15,894,496     32,604,384    3.051   LOW
p2    FIBER        79,182,560     15,867,008     63,315,552    4.990   LOW
p3    FIBER        78,773,632     15,915,296     62,858,336    4.950   LOW
p6    FIBER        91,949,168     16,289,872     75,659,296    5.645   HIGH
```

Stackless transient mean **33,753,877 B = 32.190 MiB**, sd 2,198,774 B.
Fiber transient mean **67,277,728 B = 64.161 MiB**, sd 7,262,250 B.

**The instant itself is controlled, and the control discriminates.** The
137-block 5,113 B arm is planted *after* the peak table is emitted
(`scr_heap_census.h:703-713`), so it must be absent at the peak and present at
shutdown. All six runs read `HCPKSIZE 5113` absent and `HCSIZE 5113` = 137. One
side is non-zero by construction and the other zero by construction, so a dead
reader could not produce both.

## 1. The stackless peak, ranked — and the concordance before any "largest"

Shares are of **that run's own `pkCrtBusy`** (`p1` 48,281,280 · `p4` 52,558,208
· `p5` 48,498,880), then averaged.

| size | p1 blocks | p4 blocks | p5 blocks | mean %pk | rel.range | verdict |
|---:|---:|---:|---:|---:|---:|---|
| **65,536** | 305 | 326 | 306 | **41.14%** | 6.7% | concordant |
| **4,376** | 1,570 | 1,845 | 1,470 | **15.09%** | 23.0% | concordant |
| **1,048,576** | 6 | 7 | 6 | **13.32%** | 15.8% | concordant |
| **934,576** | 6 | 7 | 6 | **11.87%** | 15.8% | concordant |
| 152 | 6,946 | 6,508 | 9,196 | 2.44% | 35.6% | loose |
| 8,192 | 168 | 93 | 168 | 2.38% | 52.4% | loose |
| 128 | 6,389 | 7,417 | 6,388 | 1.94% | 15.3% | concordant |
| 32 | 13,009 | 12,573 | 15,258 | 1.32% | 19.7% | concordant |

`rel.range` is `(max − min) / mean` of the three peak byte figures. **The top
four are concordant across all three runs**; the fifth and sixth are not, and
`262,144` (0.89% mean) moves 60% between runs on a population of 1–2 blocks and
is a draw, not an occupant.

## 2. Which of them are the transient — the column that answers the question

| size | mean peak B | mean settled B | survives | mean transient B | % of transient |
|---:|---:|---:|---|---:|---:|
| 65,536 | 20,474,901 | 10,772,635 | **52.6%** | 9,702,267 | **28.73%** |
| 4,376 | 7,529,413 | 0 | **ROW ABSENT** | 7,529,413 | **22.26%** |
| 1,048,576 | 6,640,981 | 0 | **ROW ABSENT** | 6,640,981 | **19.65%** |
| 934,576 | 5,919,083 | 0 | **ROW ABSENT** | 5,919,083 | **17.52%** |
| 152 | 1,208,021 | 13,941 | 1.2% | 1,194,080 | 3.56% |
| 8,192 | 1,173,744 | 24,624 | 2.1% | 1,149,120 | 3.46% |
| 128 | 969,312 | 36,000 | 3.7% | 933,312 | 2.76% |
| 32 | 653,472 | 306,176 | 46.9% | 347,296 | 1.04% |

**`ROW ABSENT` means no `HCSIZE` row at all, in any of the three runs.** A
shutdown census does not under-rank these three classes. It reads them as zero.

**Cumulative, each cell over that run's own transient** (`p1` 32,368,112 · `p4`
36,289,136 · `p5` 32,604,384):

| N | classes | p1 | p4 | p5 | mean |
|---:|---|---:|---:|---:|---:|
| 1 | 65,536 | 28.6% | 29.1% | 28.6% | **28.7%** |
| 2 | + 4,376 | 51.0% | 52.6% | 49.4% | **51.0%** |
| 3 | + 1,048,576 | 70.4% | 72.8% | 68.7% | **70.6%** |
| 4 | + 934,576 | 87.7% | 90.8% | 85.9% | **88.2%** |
| 6 | + 152, 8,192 | 95.3% | 95.7% | 94.5% | 95.2% |
| 8 | + 128, 32 | 99.0% | 99.4% | 98.5% | **99.0%** |

**The spread between runs never exceeds 4.9 points at any N** (widest at N=4), so the
decomposition is a property of the arm and not of a run.

## 3. The burst mode reproduces, on six fresh runs, across both lanes

`PEAK-OCCUPANT.md` §4 established that this workload peaks in two modes and that
the mode is the number of history-sync chunks held and decoded concurrently —
six or seven — readable off the `1,048,576` and `934,576` rows. **The two rows
agree on the mode in all six runs here, and in BOTH arms the HIGH-mode run is
the run with the largest transient** (`p4` on stackless, `p6` on fiber). The mode
is not a lane property.

## 4. The fiber arm — contrast only

| size | mean %pk | survives | % of fiber transient |
|---:|---:|---|---:|
| **1,328** | **35.15%** | 0.1% | **43.53%** |
| 65,536 | 25.86% | 49.9% | 15.98% |
| 1,048,576 | 7.97% | ROW ABSENT | 9.88% |
| 934,576 | 7.11% | ROW ABSENT | 8.81% |
| 4,376 | 6.76% | ROW ABSENT | 8.39% |

The fiber transient is **twice** the stackless one (64.161 vs 32.190 MiB) and
**43.5% of it is a class that the stackless arm does not have.** The four classes
that *are* the stackless transient are all present on the fiber arm too. Three
of them land within a few percent (65,536: 20.47 vs 21.52 MB; 1,048,576 and
934,576: identical to the byte, because both are block-count-by-mode); 4,376 is
25% LOWER on the fiber arm, which is not explained here. The lane adds a class;
it does not replace the four.

## 5. The 1,328 class, and the hypothesis on the record

```
run   lane      mode    peak blocks     peak bytes   settled blocks  settled bytes
p1    STACKLESS LOW               13         17,472               1          1,344
p4    STACKLESS HIGH              15         20,160               1          1,344
p5    STACKLESS LOW               13         17,472               1          1,344
p2    FIBER     LOW           20,203     27,476,064              14         19,024
p3    FIBER     LOW           20,203     27,476,064              14         19,024
p6    FIBER     HIGH          24,242     32,969,104              14         19,024
```

Per block: **1,360 B exactly** in all three fiber runs = 1,328 request + 32
overhead.

### The byte half is CIRCULAR and cannot be affirmed

`tests/perf/pagecensus/evidence-fr2/PERTASK.txt` line 2-3 and line 10, by `rg`:

```
Denominator: 20207 stacks on f1 minus 17 on v3 = 20190 tasks, both LOW mode.
This is a DIFFERENCE per task, not a measurement of one task in isolation:
  CRT heap                     26.390         1371     6.8%
```

So **1,371 = 26.390 MiB / 20,190**: category **(b) derived by division** *and*
**(c) an average that includes other classes**, taken on a different instrument
(the pagecensus `VirtualQuery` walk), a different pair of binaries and a
different tree. It is not a measurement of the 1,328 class.

And the 1,328 class, measured here, **is essentially that whole lane term**:

| N of D | value |
|---|---:|
| 1,328 class, fiber peak mean − stackless peak mean = **29,288,709** of **33,522,331** = the `pkCrtBusy` lane delta of **these six runs** (the −33,522,331 B of `5cd3e3475`, to the sign) | **87.37%** |
| the same 29,288,709 of **27,671,921** = `PERTASK.txt`'s "CRT heap 26.390 MiB" row — **another tree, another pair of binaries, another instrument** | **105.84%** |

The second ratio **overshoots 100%**, which is itself the proof that the two are
not the same measurement. What survives the mismatch is all that is needed: on
either denominator, **this one class is essentially the whole CRT-heap lane
term.** And if one class is essentially the whole sum, the sum divided by a
count **must** land near that class's block size. **1,328 against 1,371 is
arithmetically forced, not independent. The byte half of the hypothesis is
circular and is NOT a second route to anything.**

### The count half is NOT circular, and it holds in LOW mode

`tests/perf/pagecensus/evidence-fr2/manifest.txt` line 37, by `rg`:

```
  f1   fiber      low      446.844          446.164    99.85%    61403   20207
```

**20,207 stack regions**, fiber, LOW mode, counted by a `VirtualQuery` walk that
never touches the heap. The two LOW-mode fiber runs here read **20,203** blocks
of 1,328 at the heap peak — **4 apart, 0.020%**, from a different instrument on
a different tree. That is a genuine independent corroboration, and it is a
**count**: it borrows no byte figure from anywhere.

**I do not read `p6` as a refutation.** `p6` is the HIGH-mode run, and the
population that matters is tasks *suspended at the peak instant*, which is not a
dial constant — one more history-sync chunk is in flight, worth **+4,039
blocks**. `manifest.txt` commits no HIGH-mode **fiber** row (`v1` is high-mode
*stackless*), so there is nothing to check `p6` against. **Untested, not
refuted.**

### Verdict

* **"one 1,328 B block per parked task": SUPPORTED by a count**, to 0.020%,
  against an independent instrument, in LOW mode, n = 2 LOW-mode runs — both of
  which read the *identical* 20,203, which is reported and not explained.
* **"1,371 B is the same figure by another route": CIRCULAR.** 1,371 is this
  class's block size recomputed the long way. The 11 B between 1,360 measured
  and 1,371 derived is a property of the two denominators, not a finding about
  the program.

### And on the arm that ships, the class is noise

13 / 15 / 13 blocks, **0.036% of each run's own `pkCrtBusy`**. Four orders of
magnitude below the fiber reading. It is archaeology of a lane that stopped
being the default at `8f4100d7a`, and **it is not where the stackless 32 MB
lives.**

## 6. `PEAK-OCCUPANT.md` tried this once at n=1. It was RIGHT.

`../PEAK-OCCUPANT.md` §2 ranks the peak of one stackless binary from a different
tree (`5fa7a24f8`), built with `SCR_CYCSTAT_ON` as well, denominator "abba1A —
46,433,872 B of CRT busy".

| size | PEAK-OCCUPANT abba1A | blocks | here, SL mean | blocks p1/p4/p5 |
|---:|---:|---:|---:|---|
| 65,536 | 41.51% | 294 | 41.14% | 305/326/306 |
| 4,376 | 16.95% | 1,702 | 15.09% | 1,570/1,845/1,470 |
| 1,048,576 | 13.55% | 6 | 13.32% | 6/7/6 |
| 934,576 | 12.08% | 6 | 11.87% | 6/7/6 |

**Same four classes, same order, every share within 1.9 points**, on three runs
of a different binary from a different tree in a different session. Its "three of
the four largest are gone by shutdown" reproduces exactly. Its 65,536 shutdown
count of 164 reproduces: **164 / 165 / 164** here.

**What is new here and is not in it:** the transient column with a per-run named
denominator, the concordance across runs, the fiber contrast (it had no fiber
arm), and the burst mode read on both lanes. **Nothing is inherited from it** —
the four numbers in the left column above are quoted only to be compared.

**Mechanism for 4,376 is inherited and not re-derived here:**
`WHICH-BUFFER.md` §2 names it SQLite's page cache (`pcache1Alloc`,
`4096 + 216 + 56 + 8`), and `PEAK-OCCUPANT.md` §4 dates its disappearance to
`scr_async.c:2574-2575` defaulting `SCR_SQLITE_IDLE_RELEASE_MS` to 1000. The
manifests here carry `SCR_SQLITE_IDLE_RELEASE_MS=1000` and `IDLE_S=60`, so its
absence at shutdown is expected and is not news.

## 7. What this cannot say

* **The allocation SITE of the 1,048,576 / 934,576 pair is still unnamed.**
  `PEAK-OCCUPANT.md` §4 says so and nothing here changes it. A size, a count and
  a mode is what a `HeapWalk` can be asked for.
* **Flow and retention are not separated.** The megabyte pair is a decode burst
  the walk caught in the air; the 4,376 class is a cache that is *held* and then
  released on an idle timer. Both read as "transient" in §2 and that column
  cannot tell them apart.
* **n = 3 per arm. Nothing here is a t-test.** No separation is claimed; the
  concordance column is a range over three runs, not an inference. The
  permutation floor of `2/20 = 0.10` at 3 v 3 has not moved.
* **These are instrumented binaries.** Every figure above is a count, an exact
  size, or a share whose denominator comes from the same binary. No commit or
  RSS number is quoted, per `WHICH-BUFFER.md` §5.

## 8. Reproduce

```sh
node tests/perf/heapcensus/evidence-peakdecomp/peak-decomp.mjs   # from that dir, no args
```

Writes nothing unless `V4_WRITE` is set; `V4_WRITE=RESULTS.txt node peak-decomp.mjs`
regenerates `RESULTS.txt` byte for byte. It asserts, before printing anything,
that the `HCPKSIZE` rows sum to `HCPKTOTAL bytes` and the `HCSIZE` rows to
`HCTOTAL bytes` in every one of the six runs, and throws on either mismatch.
Point it at a live memrig root to re-run against fresh runs:
`node peak-decomp.mjs /g/blocks/v3-run`.

**Scope: `tests/perf/**` only — GREEN BY CONSTRUCTION, no gate runs
`tests/perf`.** Nothing was built and nothing was run.
