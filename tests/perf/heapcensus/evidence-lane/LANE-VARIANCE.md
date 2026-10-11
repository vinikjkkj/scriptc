# The lane's effect on the settled heap — three runs per arm

**Verdict: the −340,480 B lane figure is NOT SEPARABLE at n=3.** It is not
refuted. It was never supported: the single cross-day pair it came from had
3.0% power to see it.

Base `dc0d063c1`, branch `perf/heapcen-lane-variance`, worktree
`G:\blocks\v2-wt`. **Nothing was built.** Six runs, 14.2 min, both exes
already on disk.

---

## 1. What was measured, and the order declared before run 1

| arm | lane | exe | bytes |
|---|---|---|---:|
| **C** | FIBER | `G:\blocks\sa2-out182-prof\zapo-rest-182.exe` | 32,679,424 |
| **B** | STACKLESS | `G:\blocks\sb-out182-prof\zapo-rest-182.exe` | 33,356,800 |

Both are **post-repair**. This slice isolates the lane, not the string-arena
repair, so the PRE binary is not used.

Order **`C B B C C B`**, declared with its reasons in `PREREG.txt` before run 1
existed: it is `evidence-variance`'s `ABBAAB` with `A → C` term for term, so
the position structure matches the slice these numbers are read against; it is
balanced 3/3; and it puts arm C in position 1, the known-suspect slot on this
rig — the conservative placement, not the flattering one. The leave-one-out
dropping position 1 was promised in the same file and is reported below
whether or not it helps.

Knobs are `evidence-variance`'s ten, **diffed term for term against
`v1-run.sh`: identical.** `./v2-run.sh` sources `./v2-rig.sh` **from this
directory** and was executed exactly as committed — `census-arms.sh:132`'s debt
of a committed recipe nobody can run is not repeated here.

### Lane identity — a lane property, not an exe hash

`rg -c scr_fiber` on each `.ll`: **sa2 = 1488 lines, sb = 3 lines, ratio 496x.**
Both read **non-zero**, and that is the control working. Stackless conversion
is per-function, so a real module keeps a `declare` and two calls on the
stackless lane. **The discriminator is the ratio, not the zero** — a zero here
would be a dead grep. ("Must be 0" belongs only to the ten-line probe in
`tests/perf/stackless-knob-guard.mjs`.)

Per run, independent of the manifest, the `PROF` row carries the binary's own
site id for `scr_string.c:820`: `1aab5ae` in all three C runs, `1b4f5ae` in all
three B runs. **Partitions cleanly.**

### A null that proves nothing here, said out loud

`HCSIZE 131079` is absent in all six runs. **Both arms are post-repair, so this
slice contains no arm that could make that row read non-zero.** On its own it
cannot tell "repaired" from "dead row". Its positive arm lives in
`evidence-variance` arm A (46, 46, 46 on exactly that row). Read it there.

---

## 2. Each arm's spread, before any *t*

| column | arm C range | arm C sd | arm B range | arm B sd | C/B |
|---|---:|---:|---:|---:|---:|
| `busy` | 440,448 | **239,808** | 65,856 | 37,880 | 6.3 |
| `free` | 8,921,888 | 4,473,254 | 2,044,704 | 1,049,951 | 4.3 |
| `uncommitted` | 21,491,712 | 10,794,421 | 2,088,960 | 1,074,693 | 10.0 |
| `busyBlocks` | 17 | 10 | 1 | 1 | 17.0 |
| `regions` | 1 | 1 | 0 | 0 | — |

**The fiber arm's `busy` sd is 239,808 B.** The previous slice's stackless
`busy` sd was 762 B, which made the 340,480 B claim look like a 447x margin
over the noise. Against 239,808 B the same claim is **1.42x the arm's own sd**,
and **0.77x the arm's own range**.

This session's stackless `busy` sd is **37,880 B — 50x** the previous
session's 762 B. The tight arm was a property of that session, not of the lane.

---

## 3. The verdict

| | |
|---|---:|
| claimed, from one cross-day pair (sb − sa) | **−340,480 B** |
| measured here, 3 v 3 (B − C) | **−98,859 B** |
| \|t\| | 0.71 |
| Welch df | 2.10 |
| **t_crit at that df** | **4.303** |
| 95% CI on the delta | **[−702,009, +504,291] B** |

**The interval contains zero *and* contains the claim.** This slice does not
refute a −340 KB lane effect; it shows the pair never had the power to assert
one.

The critical value is taken **at the Welch df** and printed in every row.
Reading the previous slice's table at df=4 (t_crit 2.776) flipped a verdict.

### A floor that applies to every "YES" in `RESULTS.txt`

At 3 v 3 there are C(6,3) = 20 arm assignments, so the smallest attainable
two-sided **permutation** p is 2/20 = **0.10**. No effect, however large, can
reach p < 0.05 at this n without leaning on the normal assumption. The four
columns that do cross 4.303 — `free`, `committed`, `busyBlocks`, `freeBlocks` —
clear it only narrowly and **all four revert to "not separable" under the
pre-registered leave-one-out**. Read them as *worth n=7*, not as established.

### Power, computed

| true shift | power at n=3 |
|---:|---:|
| 340,480 B | **3.0%** |
| 500,000 B | 23.1% |
| 1,000,000 B | 99.8% |

MDE at 80% power: **721,173 B**. To bring the MDE down to the claimed
340,480 B: **n = 7 per arm, ≈33 min**. This is a null **with its power
computed** — not "the lanes are the same", but "n=3 on this rig cannot see a
340 KB difference in settled busy".

---

## 4. The wider sentence is bounded the same way

`sb.compare.txt` and `LANE.txt` build a second conclusion on the same pair —
that the lane's settled effect is *large* and *lives outside the busy column*,
on −7.919 MiB of `free` and −23.281 MiB of `uncommitted`. Measured 3 v 3:

| column | delta (B − C) | \|t\| | df | t_crit | |
|---|---:|---:|---:|---:|---|
| `free` | −12,833,904 | 4.84 | 2.22 | 4.303 | marginal, dies on LOO |
| `uncommitted` | −9,243,307 | 1.48 | 2.04 | 4.303 | not separable |

The fiber arm's `uncommitted` sd is **10,794,421 B**, comparable to the claimed
−24,412,160 B itself. **The direction survives** — all three fiber runs settle
with more `free` and more `regions` than all three stackless runs — **the
magnitudes do not.** The honest form is: *the fiber lane settles with a
structurally larger heap, direction reproduced, size unpinned.*

---

## 5. Three things that fell out, two of them unasked

### The chunk count is a per-run draw, now shown inside one binary

Fiber read **46, 47, 46**. `a0e2c9fa3` had seen 47 in exactly two places, both
in the same-day `sa`/`sb` pair, which left open the reading "47 is something
about that pair". **It is not.** c2 is a third 47: fiber lane, different
session, from a binary that read 46 in the runs either side of it. The previous
headline correction — 46 is modal, and the raise to 16.226% rested on a draw —
**stands and is strengthened.**

Tally **46 in 12 of 15, 47 in 3 of 15**. **That denominator is not the previous
slice's**: its "6 of 8" excluded `evidence-idle/on`; this 15 is that 8 plus
`evidence-idle/on` plus this slice's six. Different populations — do not chain
the two fractions.

The error bar goes on **N**, the measured factor: 65,536 is a definition
(`SCR_STR_ARENA_CHUNK`), N is observed over {46,47}. The 752 B per-chunk
granularity term is real but **87x smaller than this step**.

### "`sb` ran heavy" splits in two, and only half was an artefact

- **On `busy` it was the denominator.** `sb` read z = +13.49 against the
  previous session's stackless arm; against this session's — same binary, same
  knobs — it reads **z = −0.28**. An outlier score is a statement about the arm
  it is scored against, and that arm changed. `sb` was never an outlying *run*
  on `busy`; the previous trio was an unusually tight *arm*.
- **On `busyBlocks` it is real and still unexplained.** The six measured runs of
  that exact binary span **47,623–47,629**; `sb` sits at **47,940**, 311 blocks
  above the top, with nothing in between. Both z values (+150 then, +548 now)
  are inflated by sd ≈ 1–2 and should not be quoted as z at all — but the raw
  number stands. **Named, not retired.**

### Between-session drift of a fixed binary — a term nobody had measured

Same exe, same ten knobs, same host, different session (`evidence-variance`
`b1/b2/b3` against this slice's):

`busy` drifts **+20,939 B**, |t| = 0.96, df = 2.00 — **not separable**, and
**6.1%** of the lane effect the committed pair claimed to have measured
*across* sessions. This is why the previous slice's b-runs were **not reused**
as this slice's arm: session is exactly the term a reuse cannot hold fixed.

---

## 6. The pre-registered predictions, scored

| | prediction | outcome |
|---|---|---|
| **P1** | lane `busy` delta survives at −300..−400 KB **and is separable** | **REFUTED.** −98,859 B, \|t\| 0.71. Sign survives; magnitude and separability do not. |
| **P2** | the fiber lane reads 46 chunks | **WRONG AS WORDED** (46, 47, 46) — but the claim it served, that 47 is a draw, is confirmed *more* directly. |
| **P3** | `free`, `uncommitted`, `committed` stay not separable | **SPLIT.** `uncommitted` as predicted; `free`/`committed` cross narrowly and revert on LOO. |

**P1 failed by the exact route pre-registered as the weak half** — arm C's
variance, not the effect. The pre-registration guessed "hundreds of KB" for
arm C's `busy` sd; it measured 239,808 B. The named risk is the one that fired.

---

## 7. What this slice did NOT do

- **Did not build anything.** Both exes were already on disk and are identified
  by size in `PREREG.txt`.
- **Did not re-measure the string-arena repair.** Both arms are post-fix; the
  **−3,020,443 B** `busy` delta of `a0e2c9fa3` is untouched and stands.
- **Did not measure PEAK anything.** Every column here is the settled heap at
  `_Exit`. The **−21.117 MiB** peak figure is a different quantity and is
  neither confirmed nor refuted.
- **Did not quote RSS, private commit, throughput or wall-clock.** These
  binaries carry `RtlCaptureStackBackTrace` in the allocation path and
  `WHICH-BUFFER.md` §5 forbids it.
- **Did not run to n=7.** Quantified, not absorbed: ≈33 min would settle the
  340,480 B claim.
- **Did not explain why arm C is wide.** `regions` and `free` move with it,
  which points at the allocator mapping more segments on the fiber lane — a
  hypothesis this slice did not test and does not assert.
- **Did not explain `sb`'s 47,940 `busyBlocks`.** Open.

---

## 8. Against the briefing

- **The briefing named three documents carrying the claim. There are four.**
  `rg` found `evidence-postfix/LANE.txt` carrying it at four lines, unlisted.
  It is banded too. `evidence-variance/VARIANCE.md` carries a forward pointer
  to the open question and is banded as answered.
- **The briefing predicted the fiber lane would read 46 chunks.** It read
  46, 47, 46.
- **Cost was 2.37 min/run, not 2.33** — 14.2 min for six.
- **`LANE.txt` and `sb.compare.txt` were already more careful than the
  headline.** Both said "one pair, no variance estimate, read as a ceiling",
  and `LANE.txt` said outright "It is not a point estimate of −340,480". The
  caution was written; the measurement was missing. **The ceiling they offered
  survives** — the 95% CI tops out at 702,009 B, far inside 21 MiB. It is the
  point estimate that does not.

---

## 9. The repair, and how it was checked

Four documents were **appended to, never rewritten** — `_append-bands.py` opens
each in **binary mode** (these files are pure LF; a text-mode append on Windows
would rewrite every line ending) and asserts the result **starts with** the
original bytes and gained **no CRLF**.

Each band names a **section and quotes the sentence** it answers, and carries
the clause that **sections not named are not thereby in force, merely
unaudited**.

`_verify-bands.py` then checks **every pointer against the post-edit file**,
confirming each quoted sentence still exists **above** its band: **35 checks,
0 failures**. It was **positive-controlled** — two deliberately corrupted
pointers produced exactly 2 FAIL lines and exit 1, so a clean run is evidence
rather than silence.

Line endings were verified with a **byte counter** (`b.count(b'\r\n')`), never
with `rg`: `rg -c` for a bare CR reports a match on every line of a pure-LF
file — a fabricated positive that confirms the very rule under audit. Every
file written by hand in this directory is **LF**; the `*.heapcen.txt` are CRLF
because the instrumented binary writes them through a Windows text-mode `FILE`.

---

## 10. Landing

Branch `perf/heapcen-lane-variance` from `dc0d063c1`, worktree
`G:\blocks\v2-wt`. The diff is **`tests/perf/**` only**, so it is **green by
construction — no gate runs `tests/perf`**. Not merged and not pushed.
