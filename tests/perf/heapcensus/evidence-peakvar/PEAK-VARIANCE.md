# The peak, measured 3 against 3 — the first lane figure in this front to survive a variance estimate

Six runs, three per arm, alternated `SL FB FB SL SL FB`, on two binaries built
for this slice from one script whose only branch is `SCRIPTC_STACKLESS`.
Tree `be8d74ddb`, branch `perf/heapcen-peak-variance`, worktree `G:\blocks\v3-wt`.
Only `tests/perf/**` is touched, so this is **green by construction** — no gate
runs `tests/perf`. Not merged, not pushed.

Everything numeric here is produced by `peak-stats.mjs`, which runs from this
directory with no arguments and writes `RESULTS.txt`. Run against the live
memrig root it produces **byte-identical** output, which is what makes the
committed `.heapcen.txt` provably the real ones and not a transcription.

## 1. Coverage first, because it gates everything else

| pos | tag | arm | snapPrivate | kernelPeak | coverage |
|---|---|---|---:|---:|---:|
| 1 | p1 | STACKLESS | 99,692,544 | 100,233,216 | **99.461%** |
| 2 | p2 | FIBER | 508,194,816 | 508,899,328 | **99.862%** |
| 3 | p3 | FIBER | 508,424,192 | 508,784,640 | **99.929%** |
| 4 | p4 | STACKLESS | 108,261,376 | 108,290,048 | **99.974%** |
| 5 | p5 | STACKLESS | 99,340,288 | 100,192,256 | **99.150%** |
| 6 | p6 | FIBER | 599,945,216 | 600,772,608 | **99.862%** |

**All six clear the pre-registered 99% bar. None is excluded.** And the risk
the prereg named as most likely to break the slice — coverage differing *by
lane*, so that the two arms are snapshotted at different relative instants —
**does not fire**: SL 99.528% against FB 99.884%, |t| = 1.48 against t_crit
4.303 at Welch df 2.03. **Not separable.**

It is worth saying that the direction, though not separable, is the one the
mechanism predicts: a fixed 1 MiB step skips a smaller *fraction* of a 508 MiB
climb than of a 100 MiB one, so the fiber arm's snapshot sits relatively closer
to its own peak. The arm that is slightly disadvantaged by this is the
**stackless** one, and stackless is the arm with the *smaller* peak — so the
bias, such as it is, works **against** the lane effect reported below, not for
it.

The two committed peak runs that existed before this slice
(`evidence-peak/abba1A`, `abba4A`, both stackless, 512 KB step) read 99.547%
and 99.579%. Neither they nor these six reach vmcensus's 99.85–99.96% standard
on the stackless arm. **The trigger is not as tight on this load as vmcensus
is**, and that is now measured rather than assumed.

## 2. Each arm's spread, before any t

| column | FB sd | SL sd | FB range | SL range |
|---|---:|---:|---:|---:|
| peak CRT busy | 7,491,643 | 2,408,928 | 13,175,536 | 4,276,928 |
| peak committed (all heaps) | 7,869,139 | 4,828,370 | 13,667,328 | 8,526,512 |
| snapPrivate | 52,906,027 | 5,051,976 | 91,750,400 | 8,921,088 |
| settled busy | 231,464 | 211,078 | 422,864 | 374,576 |

**The fiber arm is 3.1x wider than the stackless arm at the peak and 10.5x
wider in PrivateUsage.** That is the same qualitative finding `be8d74ddb`
reported for the settled heap (fiber 239,808 B against stackless 37,880 B), now
reproduced on a different instant with different binaries. The settled `busy`
column here reads sd 231,464 / 211,078 — **the same order as the previous
session's fiber arm and 5.6x the previous session's stackless arm**, which is
one more instance of the rule that a variance estimate does not cross sessions.

## 3. The verdict

### The lane IS separable at the peak — the thing the settled heap could not do

| column | FIBER mean | STACKLESS mean | delta SL−FB | \|t\| | df | t_crit | 95% CI |
|---|---:|---:|---:|---:|---:|---:|---|
| peak CRT busy | 83,301,787 | 49,779,456 | **−33,522,331** | 7.38 | 2.41 | 4.303 | [−53,072,611, −13,972,050] |
| peak committed | 87,373,925 | 58,401,632 | **−28,972,293** | 5.44 | 3.32 | 3.182 | [−45,933,329, −12,011,258] |
| peak PrivateUsage | 538,854,741 | 102,431,403 | **−436,423,339** | 14.22 | 2.04 | 4.303 | [−568,457,680, −304,388,997] |
| settled busy | 16,024,059 | 16,025,579 | +1,520 | 0.01 | 3.97 | 3.182 | [−573,972, +577,012] |

The last row is the control that makes the first three mean something: **the
same six runs that separate the lanes by 32 MiB at the peak cannot separate
them at all at shutdown** (|t| = 0.01). This is not an instrument that reports
a difference wherever it looks.

**The peak CRT-busy result survives the pre-registered leave-one-out**
(position 1 dropped, |t| = 6.86 against 4.303), which the four narrow "YES"
columns of `be8d74ddb` did not.

> **AND THE PERMUTATION FLOOR STILL APPLIES.** At 3 v 3 there are C(6,3) = 20
> arm assignments, so the smallest attainable two-sided permutation p is
> 2/20 = 0.10. **Every YES above is parametric.** What has changed from the two
> previous slices is not the floor but the effect size: at the settled heap the
> effect was smaller than one arm's own range; here it is 4.5x the pooled sd.

### The −21.117 MiB sentence now has a second, independent measurement

The claim, located by `rg` and quoted:
`tests/perf/pagecensus/evidence-fr2/DECOMP.txt`, block *"WHAT THE LANE
REMOVED"*, row `CRT HEAP`: **79.828 MiB fiber against 58.711 MiB stackless,
−21.117 MiB**. That is CRT heap **committed** at the peak, so the column that
answers it is `pkAllCommitted`, not peak busy.

| | recorded (n=1 pair) | measured here (3 v 3) |
|---|---:|---:|
| fiber | 79.828 MiB | **83.326 MiB** (sd 7.505) |
| stackless | 58.711 MiB | **55.696 MiB** (sd 4.605) |
| delta | −21.117 MiB | **−27.630 MiB**, CI [−43.805, −11.455] |

**Different tree, different binaries, different session, and both arm means
land within 3.5 MiB of the recorded pair. The CI excludes zero and contains
−21.117.** This is the first lane figure in this front that a variance
estimate has upheld rather than dissolved.

### The 94.33% / 17.89% pair is NOT refuted, and the reason is the denominator

Stackless reads **48.600%** here and fiber **15.467%** (|t| = 240 on the gap).
The stackless number is half the recorded 94.33%, and **that is not a lane
result**:

* The **numerator reproduces**. The record puts the stackless peak CRT heap at
  53.438 MiB; this slice measures 47.473 MiB busy.
* The **denominator does not**. 94.33% implies a PrivateUsage near 56.6 MiB;
  this binary peaks at **97.7 MiB** on the same lane and the same load. The
  instrument declared 786,432 B of `.data` and one 64 KiB stack; the measured
  gap is **about 41 MiB**, and the PROF tables (`-DSCR_PROF_ALLOC
  -DSCR_PROF_SIZEHIST -DSCR_PROF_STACKS`) carried here were not carried by the
  vmcensus run that produced 94.33%.

So: **a heap-over-PrivateUsage fraction taken from an instrumented binary is
not comparable to one taken from a lighter one.** `WHICH-BUFFER.md` §5 already
forbids quoting a commit or RSS figure from an instrumented binary; this is the
same prohibition reaching one step further, into any **ratio whose denominator
is such a figure**. The absolute 94.33% is **untouched — neither confirmed nor
refuted**. What this slice establishes is the ordering and the 33.1 pp gap.

### 81.90% busy at the peak against 46.19% at shutdown: reproduces

| arm | busy% at peak | busy% at shutdown |
|---|---:|---:|
| STACKLESS | **85.425%** (sd 2.842 pp) | **43.345%** (sd 3.490 pp) |
| FIBER | **95.363%** (sd 0.291 pp) | **34.586%** (sd 0.780 pp) |

`PEAK-OCCUPANT.md`'s 81.90 / 46.19 was one stackless run; three stackless runs
read 85.4 / 43.3. **The shape holds and the magnitudes are close.** The swing is
a **within-run paired contrast** — same process, two instants — so it does not
pay the between-run variance the lane delta pays, which is why it can be solid
at an n where a lane delta would not be.

## 4. What fell out for free: the 1,328 class at the peak is a lane population

| tag | arm | 1,328 blocks AT PEAK | at shutdown | 4,376 blocks at peak |
|---|---|---:|---:|---:|
| p1 | SL | **13** | 1 | 1,570 |
| p2 | FB | **20,203** | 14 | 1,157 |
| p3 | FB | **20,203** | 13 | 1,197 |
| p4 | SL | **15** | 1 | 1,845 |
| p5 | SL | **13** | 1 | 1,470 |
| p6 | FB | **24,242** | 14 | 1,293 |

**A ratio of means of 1,554x, and it vanishes by shutdown on both lanes** —
which is exactly why no settled census in this repository could ever have seen
it. The PROF flags on both arms name this band as the stack band
(`-DSCR_PROF_STACK_SIZE_MIN=1296 -DSCR_PROF_STACK_SIZE_MAX=1352`), and the
count tracks the parked-coroutine population.

> **This puts a scope question to `WHICH-BUFFER.md` §1, titled "it is not a
> buffer, it is SQLite".** That section reads the class **at rest** — it quotes
> `HCSIZE 1328` live at rest = 1 — and at rest this slice agrees with it
> exactly (1 to 14 blocks on both lanes). **It does not refute §1**: a size
> class can hold SQLite blocks at rest and fiber stacks at the peak, and §1
> never claimed anything about the peak. It does mean the sentence
> *"1,328 is SQLite's"* is **scoped to the settled instant** and must not be
> carried to the peak. **Naming it is the whole of the claim here** —
> attributing the 20,203 blocks by site id is a separate slice and this one did
> not do it.

The 4,376 class (*"the whole database"*, `WHICH-BUFFER.md` §2) runs the **other
way** at the peak: 1,570/1,845/1,470 stackless against 1,157/1,197/1,293 fiber.
**Named, not explained.**

## 5. The pre-registered predictions, scored

| | prediction | result |
|---|---|---|
| P1 | the peak lane delta IS separable at n=3 | **CONFIRMED.** −33,522,331 B, \|t\| = 7.38 vs 4.303, survives leave-one-out |
| P2 | stackless peak heap fraction reproduces ~90%, fiber far below | **WRONG AS WORDED.** 48.600% / 15.467%. The ordering and the 33.1 pp gap hold; the absolute is a denominator artefact I predicted without checking it |
| P3 | coverage above 99% on all six — *named as the half most likely to be wrong* | **HELD**, and the lane difference in coverage is not separable |

**The half I named as most likely to break the slice is the half that held.**
That is the opposite of the last three slices, where the named weak half fired
every time — and it is worth not over-reading: P3 held at this load with a
1 MiB step, and both committed peak runs sit below vmcensus's standard, so the
trigger's tightness is a property of the load and the step, not a property that
transfers.

## 6. Power, stated for the null that is in here

The one genuinely null column is settled `busy` (|t| = 0.01). Against the
pooled peak sd the MDE at 80% power is **22.29 MiB**; the power to detect a
true 21.117 MiB peak shift at n=3 is **71.6%**, and to detect 10 MiB, **2.3%**.
So the peak result is comfortably powered for the effect it found and would
**not** have been powered for an effect a third the size.

## 7. What this slice did NOT do

* **It did not touch `packages/runtime/src`.** Nothing outside `tests/perf/**`
  changed, so no gate is owed.
* **It did not annotate the documents carrying the audited figures.** Nothing
  here is a retraction — the −21.117 MiB is upheld and the 94.33% is untouched
  — so no banner is *required*. The citers were swept with `rg` rather than
  recalled, and the list for whoever lands this is:
  * **−21.117 MiB**: `pagecensus/evidence-fr2/DECOMP.txt`,
    `heapcensus/POSTFIX-CENSUS.md`, `heapcensus/evidence-postfix/sb.compare.txt`,
    `heapcensus/evidence-postfix/LANE.txt`,
    `heapcensus/evidence-lane/LANE-VARIANCE.md`, `.../RESULTS.txt`,
    `.../lane-stats.mjs`, `.../_append-bands.py`.
  * **94.33% / 17.89%**: `pagecensus/evidence-fr2/DECOMP.txt`, `.../MODEPAIR.txt`,
    `.../manifest.txt`, and `heapcensus/scr_heap_census.h` (in the comment
    above the peak block).
  * **81.90%**: `heapcensus/PEAK-OCCUPANT.md`,
    `heapcensus/evidence-peak/abba1A.score.txt`.
    `docs/estado-protofences.md:833` also matches `81.90` and is a **false
    hit** — `node rss=81.90 MiB`, an unrelated number. An `rg -l` list is not a
    citer list until the lines are read.
* **It did not make the four shell scripts runnable from the tree.**
  `v3-rig.sh`, `v3-build.sh`, `v3-run.sh` and `v3-six.sh` are committed
  **exactly as executed**, byte for byte, and they source and invoke each other
  by absolute `/g/blocks/` paths. **A re-runner must copy them back to
  `/g/blocks/` or edit one line in each.** The alternative — rewriting them to
  resolve their own directory, the way `evidence-lane/v2-run.sh` does — would
  make the committed text differ from the text that produced these numbers.
  Stated here rather than hidden, and it is the same debt `census-arms.sh:132`
  carries, with the difference that this one is **named and the executed form
  is the committed form**.
* **It did not go to n=7.** At 2.35 min a run, another four per arm is ~19 min.
  Quantified, not absorbed.
* **It did not isolate CRT-only committed at the peak.** `HCPKHEAPS` prints the
  all-heaps aggregate and the peak walk does not emit per-heap free. The
  non-CRT heaps carry ~30 KB at shutdown, so the aggregate is within ~0.03% of
  the CRT figure, but that is an argument, not a measurement.
* **It did not explain why the fiber arm is wide**, at the peak any more than
  at shutdown.
* **It did not attribute the 20,203 blocks of the 1,328 class by site id.**

## 8. What contradicts the briefing

* **`docs/estado-vmwalk.md` does not contain 94.33 or 21.117.** The briefing
  attributed both to it. `rg` puts the 94.33% in
  `pagecensus/evidence-fr2/{DECOMP,MODEPAIR,manifest}.txt` and in
  `heapcensus/scr_heap_census.h`, and the −21.117 MiB in `DECOMP.txt` plus
  seven other files. The briefing's own rule — sweep with `rg`, do not
  enumerate from memory — catches its own pointer.
* **A binary carrying the peak trigger DID exist on this host.** The briefing's
  control scanned `G:\blocks\*out182*\` and correctly found none; outside that
  glob, `/g/blocks/fr2-out/pk/zapo-rest-182.exe` reads `rg -ac HCPKSIZE` = 159.
  It was **not** used as an arm — different tree (`5fa7a24f8`), and it also
  carries `-DSCR_CYCSTAT_ON`, so reusing it would have made the arms differ by
  three things. **A glob is a filter, and a negative under a filter is a
  negative about the filter.**
* **The `-include` path form matters and nearly cost a build.** Written as
  `/g/blocks/...` it is an MSYS path that the Windows-side compiler cannot
  resolve; both arms were killed four minutes in and relaunched with
  `G:/blocks/...`. The committed `sb-build.sh` uses the `G:/` form; copying the
  shape rather than the string is what reintroduced it.
* **2.35 min per run**, not 2.4; the six cost 14.1 min. Each build took
  ~10.7 min **running two at a time** on separate zig caches, not the 9–16 min
  of a solo build.
* The `scr_fiber` reference counts and `.ll` sizes matched the briefed
  references **exactly**: 3 against 1,488 (496x), 242,844,788 against
  229,342,782 bytes.
