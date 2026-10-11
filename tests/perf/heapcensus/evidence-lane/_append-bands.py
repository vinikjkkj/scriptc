# _append-bands.py -- appends the audit band to each document that carries the
# -340,480 B lane sentence. BINARY MODE, LF only: these four files are pure LF
# and a text-mode append on Windows would rewrite every line ending.
# Nothing is rewritten; each band is APPENDED, and each band quotes the exact
# sentence it answers. Run from anywhere; paths are absolute.
import io, os, sys

ROOT = r'G:\blocks\v2-wt\tests\perf\heapcensus'

BAND_COMMON = """
THE MEASUREMENT, 2026-10-11, evidence-lane/ -- 3 runs per arm, alternated
CBBCCB, order declared in evidence-lane/PREREG.txt before run 1 existed.
Same two exes (sa2-out182-prof FIBER, sb-out182-prof STACKLESS), same ten
knobs, nothing built. Full table: evidence-lane/RESULTS.txt, reproducible
with `node evidence-lane/lane-stats.mjs`.

  arm C (FIBER)     busy sd    239,808 B   range 440,448 B over three runs
  arm B (STACKLESS) busy sd     37,880 B   range  65,856 B over three runs
  measured lane busy delta (B - C) = -98,859 B
  |t| = 0.71, Welch df = 2.10, t_crit = 4.303  =>  NOT SEPARABLE FROM ZERO
  95% CI = [-702,009, +504,291] B -- CONTAINS ZERO *AND* CONTAINS -340,480.

THE CLAIM IS NOT REFUTED; IT IS UNSUPPORTED. The pair never had the power to
assert it. Power to detect a true 340,480 B lane shift at n=3 here is 3.0%;
the minimum detectable effect at 80% power is 721,173 B; n = 7 per arm
(about 33 min) would settle it. The fiber arm's own busy range, 440,448 B
across three runs of ONE binary at fixed knobs, is LARGER than the effect
the single pair was read as showing.
"""

BAND_WIDER = """
AND THE WIDER SENTENCE IN THIS SECTION IS BOUNDED THE SAME WAY. The claim
that the lane's settled effect is "large" and "lives almost entirely outside
the busy column" rests on -7.919 MiB of free and -23.281 MiB of uncommitted
from the same single pair. Measured 3 v 3:

  free          delta -12,833,904 B  |t| 4.84  df 2.22  t_crit 4.303  marginal
  uncommitted   delta  -9,243,307 B  |t| 1.48  df 2.04  t_crit 4.303  NOT sep.
  regions       FIBER 10, 11, 10  vs  STACKLESS 9, 9, 9

The fiber arm's uncommitted sd is 10,794,421 B -- comparable to the claimed
-24,412,160 B itself -- so that column cannot carry a point estimate from a
pair either. The DIRECTION survives: all three fiber runs settle with more
free and more regions than all three stackless runs. The MAGNITUDES do not.
The honest form of the wider sentence is "the fiber lane settles with a
structurally larger heap, direction reproduced, size unpinned".

A FLOOR THAT APPLIES TO THE "marginal" ROW ABOVE AND TO EVERY SIMILAR ONE.
At 3 v 3 there are C(6,3) = 20 arm assignments, so the smallest attainable
two-sided permutation p is 2/20 = 0.10. No effect at this n can reach
p < 0.05 without the normal assumption, and the free/committed rows revert
to "not separable" under the pre-registered leave-one-out. Read them as
"worth n=7", not as established.
"""

SCOPE = """
SECTIONS OF THIS FILE NOT NAMED ABOVE ARE NOT THEREBY IN FORCE -- they are
merely unaudited by this slice. This slice measured the SETTLED heap only.
It does not touch the string-arena repair's -3,020,443 B busy delta, which
stands, and it does not touch any PEAK figure, including the -21.117 MiB of
pagecensus/evidence-fr2/DECOMP.txt, which is a different quantity.
"""

BANDS = {}

BANDS['POSTFIX-CENSUS.md'] = """
> ---
>
> ## AUDITED, 2026-10-11 (later the same day) — **THE LANE FIGURE IS NOT SEPARABLE AT n=3**
>
> **The sentence this band answers**, in the `RESOLVED, 2026-10-11` block
> above, under "**The confound was 11.1% of the claimed effect, not 720%**":
>
> > "Settled CRT busy heap: 16,243,072 B fiber against 15,902,592 B
> > stackless, **−340,480 B**."
>
> That block already called it "one pair, no variance estimate; read it as a
> ceiling", and that caution was right. What was missing was the measurement.
> It now exists.
>{COMMON}
>{WIDER}
> **The same block's other clause survives and is strengthened.** "The effect
> reproduced to the byte on the other lane. 47 chunks, 3,080,192 B" — the 47
> was already retracted as a draw by `a0e2c9fa3`; this slice saw a third 47,
> on the fiber lane, in a different session, from a binary that read 46 in
> the two runs either side of it (46, 47, 46). The count is a per-run draw
> over {{46,47}} and is nothing about the `sa`/`sb` pair. 46 remains modal.
>
> **And the "`sb` ran heavy" item splits in two.** On `busy`, `sb`'s z = +13.49
> was an artefact of the denominator: against this session's stackless arm,
> same binary and knobs, it reads z = −0.28. On `busyBlocks` it is REAL and
> still unexplained — the six measured runs of that exact binary span
> 47,623–47,629 and `sb` sits at 47,940, 311 blocks above the top, with
> nothing in between. Named, not retired.
>{SCOPE}
""".replace('{COMMON}', BAND_COMMON.rstrip('\n').replace('\n', '\n> ')) \
   .replace('{WIDER}', BAND_WIDER.rstrip('\n').replace('\n', '\n> ')) \
   .replace('{SCOPE}', SCOPE.rstrip('\n').replace('\n', '\n> '))

BANDS['evidence-postfix/sb.compare.txt'] = """
================================================================================
APPENDED BY HAND 2026-10-11, BELOW THE GENERATOR'S OUTPUT.
Everything ABOVE this line is sb-compare.sh's output and is unmodified; re-running
sb-compare.sh reproduces it byte for byte. Only this band was added, because the
file cannot be regenerated without re-running sb.
================================================================================

AUDITED: THE -340,480 B LINE IS NOT SEPARABLE AT n=3

  The lines this band answers, in "=== THE LANE'S EFFECT ON THE SETTLED HEAP
  (sb STACKLESS - sa FIBER) ===" and in the EVERY COLUMN table below it:

      "delta            = -340480 B (-0.325 MiB, -2.10% of the fiber arm)"
      "THE HEADLINE. On the BUSY column the lane is worth -340,480 B"

  This file's own "=== WHAT THIS PAIR CANNOT SAY ===" section already said
  it: "A -340,480 B delta from a single pair cannot be separated from
  run-to-run jitter here, and no committed arm repeats THIS arm's knobs on
  THIS lane to bound it." THAT SECTION WAS CORRECT AND IS NOW DISCHARGED --
  an arm that repeats these knobs on this lane exists, and it bounds it.
{COMMON}{WIDER}
  The ceiling this file offered -- "the lane is not worth 21 MiB on the
  settled busy heap" -- SURVIVES: the 95% CI tops out at 702,009 B, far
  inside 21 MiB. It is the point estimate that does not survive.
{SCOPE}
""".replace('{COMMON}', BAND_COMMON.replace('\n', '\n  ').rstrip(' ')) \
   .replace('{WIDER}', BAND_WIDER.replace('\n', '\n  ').rstrip(' ')) \
   .replace('{SCOPE}', SCOPE.replace('\n', '\n  ').rstrip(' '))

BANDS['evidence-postfix/LANE.txt'] = """
================================================================================
AUDITED 2026-10-11 -- THE SETTLED-HEAP LANE FIGURE IS NOT SEPARABLE AT n=3
================================================================================

  The lines this band answers, in the section "THE CONFOUND THIS FILE
  FLAGGED, NOW MEASURED -- `sb.compare.txt`":

      "busy             16,243,072     15,902,592      -340,480 B  (-0.325 MiB)"
      "ON THE BUSY COLUMN THE CONFOUND IS 11.1% OF THE CLAIMED EFFECT, NOT 720%."
      "AND THE LANE IS NOT A SMALL THING IN THIS HEAP. It is worth -23.3 MiB
       of uncommitted address space and -7.9 MiB of free-but-committed heap"

  THIS FILE WAS ALREADY THE MOST CAREFUL OF THE FOUR. Its "WHAT THE PAIR
  CANNOT SAY" paragraph ends "It is not a point estimate of -340,480", and
  that is exactly right. The band below supplies the number that paragraph
  could not.
{COMMON}{WIDER}
  WHAT THIS FILE GOT RIGHT AND KEEPS. The refusal to carry the peak slice's
  -21.117 MiB into a settled-heap error bar stands, and stands by a wider
  margin than before: the 95% CI on the settled busy delta tops out at
  702,009 B. The "WHAT IS STILL NOT CLOSED" item -- "Nothing here licenses
  applying -340,480 B ... to any other arm or knob set" -- is now stronger
  than it was written: nothing licenses applying it to THIS arm and THIS
  knob set either.
{SCOPE}
""".replace('{COMMON}', BAND_COMMON.replace('\n', '\n  ').rstrip(' ')) \
   .replace('{WIDER}', BAND_WIDER.replace('\n', '\n  ').rstrip(' ')) \
   .replace('{SCOPE}', SCOPE.replace('\n', '\n  ').rstrip(' '))

BANDS['evidence-variance/VARIANCE.md'] = """
---

## 10. ANSWERED, 2026-10-11 (later the same day) — the open item in §8

**The sentence this band answers**, in §8 ("what this slice did not do"),
bullet "**Did not re-measure the FIBER arm (`sa`)**":

> "the lane figure in `POSTFIX-CENSUS.md`'s `RESOLVED` banner — settled CRT
> busy `−340,480 B` — is **untouched by this slice** ... Note only that it is
> a 340,480 B claim and this slice measures a 3,803,200 B within-arm range on
> neighbouring columns, so the same question applies to it and is still open."

**That question is now closed, and this slice's instinct was right.**
`evidence-lane/` re-measured the FIBER arm: 3 runs per arm, alternated
`CBBCCB`, both post-fix exes, nothing built.

| | arm C FIBER | arm B STACKLESS |
|---|---:|---:|
| `busy` sd | **239,808 B** | 37,880 B |
| `busy` range over 3 runs | **440,448 B** | 65,856 B |

Measured lane `busy` delta (B − C) = **−98,859 B**, |t| = 0.71, Welch
df = 2.10, t_crit = **4.303** ⇒ **NOT SEPARABLE FROM ZERO**. The 95% CI
`[−702,009, +504,291]` contains zero **and** contains the claimed −340,480.
Power at n=3 to see a true 340,480 B shift: **3.0%**. MDE at 80%: 721,173 B.
**n = 7 per arm, ~33 min**, would settle it.

**And this slice's own §5 item is half repaired.** "Did not explain why `sb`
ran heavy." On `busy` there was nothing to explain: `sb`'s z = +13.49 was a
statement about the denominator, and against the fresh stackless arm — same
binary, same knobs, different session — it reads **z = −0.28**. Arm B's
`busy` sd was **762 B** in this slice and **37,880 B** in the new one, so the
tight trio was a property of that session. On `busyBlocks` the anomaly is
**real and still unexplained**: six measured runs of that binary span
47,623–47,629 and `sb` sits at 47,940.

**A term nobody had measured, reported either way.** Between-session drift of
one fixed binary at fixed knobs (this slice's `b1/b2/b3` against the new
`b1/b2/b3`): `busy` drifts **+20,939 B**, |t| = 0.96, df = 2.00 — not
separable, and 6.1% of the lane effect the committed pair claimed to have
measured *across* sessions. That is why the new slice re-ran arm B instead of
reusing these three.

**Sections of this file not named above are not thereby in force — they are
merely unaudited by this slice.** The −3,020,443 B busy delta of the
string-arena repair, §3's conservation identity and §4's chunk-count
correction are all untouched; §4 is strengthened — a third 47 was drawn on
the fiber lane in a different session (46, 47, 46 inside one binary), so the
count is a per-run draw and 46 stays modal.
"""


def main():
    for rel, band in BANDS.items():
        path = os.path.join(ROOT, rel.replace('/', os.sep))
        with open(path, 'rb') as f:
            before = f.read()
        assert before.count(b'\r\n') == 0, rel + ' is not pure LF; refusing'
        assert before.endswith(b'\n'), rel + ' does not end in a newline'
        payload = band.encode('utf-8')
        assert b'\r' not in payload, rel + ' band carries a CR'
        bad = sorted(x for x in set(payload) if x < 9 or 10 < x < 32)
        assert not bad, rel + ' band carries control bytes ' + repr(bad)
        with open(path, 'ab') as f:
            f.write(payload)
        with open(path, 'rb') as f:
            after = f.read()
        assert after.startswith(before), rel + ' was rewritten, not appended'
        assert after.count(b'\r\n') == 0, rel + ' gained a CRLF'
        print('%-38s +%5d bytes  LF %d -> %d  CRLF %d'
              % (rel, len(after) - len(before), before.count(b'\n'),
                 after.count(b'\n'), after.count(b'\r\n')))


if __name__ == '__main__':
    main()
