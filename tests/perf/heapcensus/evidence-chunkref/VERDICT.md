# The for-await chunk share removes TURNOVER, not peak bytes. The saving is ZERO.

`16d91996f` replaced the `for await` chunk copy with a share on the one
`scr_stream_rbuf_take_f` path that owns its buffer. The slice that wrote it
predicted **5.61-6.54 MB off the peak** (6 or 7 x 934,576). This slice measured
it, 3 runs per arm, alternated, and the answer is **zero**.

Run `node chunkref-stats.mjs` from this directory, no arguments, to reproduce
every table below.

## The deciding item, and it is a COUNT, not a t

`HCPKSIZE 934576` — blocks of that class LIVE at the peak instant:

| | q1 | q2 | q3 | q4 | q5 | q6 |
|---|---|---|---|---|---|---|
| arm | PRE | POS | POS | PRE | PRE | POS |
| 934,576 live at peak | 6 | 6 | 7 | 7 | 6 | 6 |

**PRE reads 6, 7, 6. POS reads 6, 7, 6.** Run for run the same, and 1:1 with the
1,048,576 partner in all six. This is a population with no spread to speak of,
so it settles the question on its own — it does not need, and does not get, a
significance test.

**The mechanism.** Before: `d = copy(chunk); release(chunk)` — the original dies
one instruction later, leaving ONE buffer per chunk. After: `d = ref(chunk)` —
the SAME buffer survives, still ONE per chunk. The live population per chunk is
one in both arms. The predicted 6-7 x 934,576 counted the copy as an *extra*
resident buffer. It never was one.

The transient-overlap escape — during the `memcpy` both are briefly live, so a
peak snapshot landing in that window would show PRE at 12-14 — was
pre-registered as the half most likely to break this reading. **No PRE run reads
12 or more.** Refuted.

## The patch does work. It removes 7.48 MB of FLOW per run

A null on the peak is worthless if the guard never fired, so reachability is
measured separately, at the copying site `scr_bytes.c:52`, band 19 (the octave
holding 934,576):

| arm | band-19 copies per run | bytes at the site |
|---|---|---|
| PRE | 48, 48, 48 | 92,210,643 mean |
| POS | 40, 40, 40 | 84,735,615 mean |

A drop of **exactly 8** in every run, zero overlap between arms, against
`CHUNKS=8`: the share fires once per chunk. The byte delta is **-7,475,028 B**
against 8 x 934,576 = 7,476,608 B — a 1,580 B residual. Band 20 is unchanged at
40 and the reference site `scr_bytes.c:529` is flat, so the instrument is not
drifting.

**So the two channels point opposite ways: the patch deletes one alloc, one
free and one 934 KB memcpy per chunk — about 7.48 MB of allocation flow per run
— and moves the resident peak by nothing.** Flow is not retention. That
distinction is the whole of this result.

## The peak aggregate, and an honest statement of its weakness

| column | delta POS-PRE | \|t\| | Welch df | t_crit | 95% CI | sig? |
|---|---|---|---|---|---|---|
| pkCrtBusy | **+231,717 B** | 0.08 | 3.94 | 3.182 | [-8.22, +8.66] MiB | no |
| snapPrivate | -495,616 B | 0.14 | 3.98 | 3.182 | [-11.54, +10.59] MiB | no |

The measured delta is **positive** — the wrong sign for a saving — and nowhere
near separable. But the CI contains the predicted saving as well as zero, so
**this column alone does not kill the figure**:

- pooled sd 3,405,427 B; se of the difference 2,780,519 B
- power to detect 6 x 934,576 = **12.2%**; to detect 7 x 934,576 = **20.3%**
- **minimum detectable effect at 80% power = 10.67 MiB**

**The MDE is ABOVE the claim.** On the between-run variance channel this design
could not have seen a 5.35-6.24 MiB saving and the null there is weak. It is the
per-class live COUNT, not the aggregate, that carries this verdict — and that
count has effectively no variance.

At 3 v 3 there are C(6,3) = 20 assignments, so the smallest attainable two-sided
permutation p is **2/20 = 0.10**. Every "YES" in the generated tables would be
parametric. None of them is a YES.

## Everything else held

- **Coverage first.** 99.182-99.962% on all six, above the pre-registered 99.0%
  bar; **6 of 6 enter the statistics**. No arm effect on coverage (|t| = 2.40 vs
  t_crit 3.182), so the two arms are snapshotted at comparable relative instants.
- **P3** peak and settled `free` / `uncommitted` do not separate (|t| 0.17-0.90).
  No fragmentation signal.
- **P4** settled `busy` does not separate (|t| = 0.14), coherent with the
  |t| = 0.01 lane effect in `evidence-peakvar`. Coherence, not a new null.
- **Leave-one-out on position 1**, promised in `PREREG.txt` before run q1 and
  reported either way: dropping q1 flips the sign to -627,875 B and |t| = 0.18
  against t_crit 4.303 — still not separable, in either direction.

## What this does NOT say

It does not say the patch is worthless: 7.48 MB of allocation and memcpy per run
is real and measured. It says the **peak** figure of 5.61-6.54 MB must not be
carried. Peak and throughput are different claims and this slice only measured
the peak.
