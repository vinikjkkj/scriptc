#!/usr/bin/env python3
# Append-only retraction pointers for figures this frontend retracted on
# 2026-10-11. BINARY MODE, LF only: every target below is pure LF (verified by
# byte counter before and after). Nothing existing is rewritten.
#
# Each band: names the SECTION and QUOTES the sentence it answers, points at
# the refutation by SECTION + QUOTED SENTENCE, and states that sections it
# does not name are UNAUDITED rather than thereby in force.
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))

BANDS = {}

BANDS["tests/perf/heapcensus/evidence-livepair/RESULTS.md"] = """
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
"""

BANDS["tests/perf/heapcensus/OWNER-131079.md"] = """
---

> ## AUDITED, 2026-10-11 (later the same day) - THE `RESOLVED` BLOCK IN SECTION 5 RESTS ON A PER-RUN DRAW
>
> **The sentences this band answers**, both inside the `RESOLVED, 2026-10-11`
> block of section *"5. The alignment has no consumer: the lever"*:
>
> > "**The 47 chunks, the 3,080,192 B and the +/-16-per-chunk residue are not
> > merely untouched - they reproduced to the byte** in a second, independently
> > built binary on the other lane, which is a stronger statement than the
> > marker could make."
>
> > "**16.226%** against this run's own counterfactual pre-fix heap of
> > 18,982,784 B, and **16.291%** against the stackless `evidence-idle/on` heap
> > of 18,907,440 B."
>
> **THE CHUNK COUNT IS A PER-RUN DRAW, NOT A CONSTANT, AND 46 IS MODAL.**
> `evidence-variance/VARIANCE.md`, section *"5. The correction that falls out:
> the chunk count is not 47"*:
>
> > "**46 in six of eight; 47 in two, both of them the 2026-10-11 post-fix
> > pair.** The live chunk population moves by a whole 64 KiB chunk between
> > runs of a fixed binary at fixed knobs."
>
> > "The record raised this headline from **15.940%** to **16.226%** on the
> > strength of `sb`'s 47 chunks. At the modal 46 it reads 15.94% again. **The
> > raise rests on a single draw of a quantity that moves by 65,536 B.**"
>
> **AND THE DRAW IS NOW SHOWN INSIDE ONE BINARY, WHICH CLOSES THE ESCAPE THIS
> BLOCK USED.** The agreement of `sa` and `sb` was read here as reproduction
> across lanes. `evidence-lane/LANE-VARIANCE.md`, section *"The chunk count is
> a per-run draw, now shown inside one binary"*:
>
> > "Fiber read **46, 47, 46**."
>
> > "Tally **46 in 12 of 15, 47 in 3 of 15**."
>
> So `sa` = 47 and `sb` = 47 is two draws of a quantity whose mode is 46, not
> two independent confirmations of a constant. **The headline returns to
> 15.940%**; the 16.226% / 16.291% pair and their 0.065 pp agreement are
> products of the 47 and fall with it.
>
> **WHAT SURVIVES, precisely.** The per-chunk 65,536 B is exact and does
> reproduce; the string arena's realized release is real and measured at
> **-3,020,443 B** on `busy` over six runs (`evidence-variance/VARIANCE.md`
> section *"4. Where the bytes actually go"*), which is the modal
> `46 x 65,536 = 3,014,656 B` plus a +5,787 B residual. What falls is the
> **count** `47` and every figure derived by multiplying or dividing by it.
> This band does not touch section 5's own carve table (46 chunks,
> 3,014,768 B, 15.94%), which was always written at 46.
>
> **ALSO STILL OPEN, carried forward and not re-litigated here.** The
> `LANE MARKER` above remains answered by `evidence-postfix/LANE.txt`, and that
> file's own settled-lane figure has since been measured: the `-340,480 B` busy
> delta is **not separable at n=3**, 95% CI `[-702,009, +504,291]`
> (`evidence-lane/LANE-VARIANCE.md` section *"3. The verdict"*). No figure in
> this section depends on it.
>
> **Sections of this file not named above are NOT thereby in force; they are
> merely UNAUDITED by this band.**
"""

BANDS["tests/perf/heapcensus/PLAN-POSTFIX-CENSUS.md"] = """
---

> ## AUDITED, 2026-10-11 (later the same day) - "47 chunks" IS A DRAW, AND THE `RESOLVED` BLOCK TREATS IT AS A CONSTANT
>
> **The sentence this band answers**, in the block headed
> *"### RESOLVED, 2026-10-11"*, under *"What the plan registered and
> lane-independence predicted, held"*:
>
> > "The chunk size, the P5 assertions and the +/-16-per-chunk residue
> > reproduce to the byte across both lanes: 47 chunks, 3,080,192 B, zero
> > frees."
>
> **Three of the four items in that sentence hold. `47 chunks` does not, and
> `3,080,192 B` is `47 x 65,536` and falls with it.**
> `evidence-variance/VARIANCE.md`, section *"5. The correction that falls out:
> the chunk count is not 47"*:
>
> > "So the realized release is **not** a constant `47 x 65,536 = 3,080,192 B`.
> > At the modal 46 it is `3,014,656 B`".
>
> and `evidence-lane/LANE-VARIANCE.md`, section *"The chunk count is a per-run
> draw, now shown inside one binary"*:
>
> > "Tally **46 in 12 of 15, 47 in 3 of 15**."
>
> The fiber binary read **46, 47, 46** across three runs at fixed knobs, so the
> `sa`/`sb` agreement at 47 is two draws, not a reproduced constant. **What
> reproduces is the per-chunk 65,536 B and the zero frees, which is what
> lane-independence actually predicted; the COUNT is a per-run population and
> the plan was never entitled to predict it to the block** - the same error
> this block already diagnoses one paragraph later for `P2`'s row total.
>
> **Sections of this file not named above are NOT thereby in force; they are
> merely UNAUDITED by this band.**
"""

BANDS["tests/perf/heapcensus/evidence-postfix/LANE.txt"] = """
================================================================================
AUDITED 2026-10-11 (later the same day) -- "47 chunks ... NOT A DRAW" IS A DRAW
================================================================================

  APPENDED BY HAND 2026-10-11. Nothing above this line is edited.

  THE LINES THIS BAND ANSWERS, in the section "WHAT SURVIVED THE LANE CHANGE
  -- the string arena is lane-independent, and that is now measured rather
  than argued":

      "The arena allocates 47 chunks of exactly 65,536 B and releases none, on
       both lanes, in two independently built binaries. The 3,080,192 B is not
       a draw; it reproduced."

  and, in the section "WHAT THIS RESOLVES IN `POSTFIX-CENSUS.md` SECTION 5":

      "ROUTE A  this run against its own counterfactual pre-fix heap
                3,080,192 / (15,902,592 + 3,080,192 = 18,982,784) = 16.226%"
      "BOTH figures are now ~16.2-16.3%, where the retracted pair read 15.940%
       and 15.944%"

  THE COUNT IS A PER-RUN DRAW AND 46 IS MODAL. evidence-variance/VARIANCE.md,
  section "5. The correction that falls out: the chunk count is not 47":

      "46 in six of eight; 47 in two, both of them the 2026-10-11 post-fix
       pair. The live chunk population moves by a whole 64 KiB chunk between
       runs of a fixed binary at fixed knobs."
      "The raise rests on a single draw of a quantity that moves by 65,536 B."

  AND THE DRAW IS NOW SHOWN INSIDE ONE BINARY, WHICH IS EXACTLY THE ESCAPE
  THIS SECTION RELIED ON. evidence-lane/LANE-VARIANCE.md, section "The chunk
  count is a per-run draw, now shown inside one binary":

      "Fiber read 46, 47, 46."
      "Tally 46 in 12 of 15, 47 in 3 of 15."

  So `sa` = 47 and `sb` = 47 are TWO DRAWS of a quantity whose mode is 46.
  Agreement between two binaries bounds BUILD variation, which is what this
  section set out to test and did test; it does not bound RUN variation, and
  the sentence "The 3,080,192 B is not a draw; it reproduced" claims the
  second from evidence for the first. THE HEADLINE RETURNS TO 15.940%, and
  ROUTE A's 16.226% and ROUTE B's 16.291% fall with the 47 they are built on.

  WHAT THIS SECTION GOT RIGHT AND KEEPS. Lane-independence of the string
  arena is upheld: the per-chunk 65,536 B, the zero frees and the absence of
  `HCSIZE 131079` reproduce across both lanes, and the repair's realized busy
  delta is measured at -3,020,443 B over six runs (evidence-variance/
  VARIANCE.md, section "4. Where the bytes actually go"), which is the modal
  46 x 65,536 = 3,014,656 B plus a +5,787 B residual. The ROUTE A / ROUTE B
  METHOD -- numerator and denominator on one lane -- is also upheld and is
  what the later slices use; it is the 47 in the numerator that moved.

  THIS BAND IS SEPARATE FROM THE `AUDITED 2026-10-11 -- THE SETTLED-HEAP LANE
  FIGURE IS NOT SEPARABLE AT n=3` BAND ABOVE, which answers the -340,480 B
  sentence and nothing else. Neither band names the other's lines.

  SECTIONS OF THIS FILE NOT NAMED ABOVE ARE NOT THEREBY IN FORCE -- they are
  merely UNAUDITED by this band.
"""

BANDS["tests/perf/heapcensus/evidence-postfix/sb.compare.txt"] = """
================================================================================
AUDITED 2026-10-11 (later the same day) -- THE 47-CHUNK NUMERATOR IS A DRAW
================================================================================

  APPENDED BY HAND 2026-10-11, second hand-appended band in this file.
  Nothing above this line is edited and nothing was regenerated.

  THE LINES THIS BAND ANSWERS, in the section "=== ROUTE A and ROUTE B, both
  with their denominators named ===":

      "live string-arena chunks in sb = 47 alloc - 0 freed = 47"
      "realized release               = 47 x 65536 = 3080192 B"
      "ROUTE A  this run against ITS OWN counterfactual pre-fix heap
                3080192 / (15902592 + 3080192 = 18982784) = 16.226%"
      "ROUTE B  this run against the STACKLESS baseline evidence-idle/on
                3080192 / 18907440 = 16.291%"

  THE COUNT 47 IS A PER-RUN DRAW; 46 IS MODAL. evidence-variance/VARIANCE.md,
  section "5. The correction that falls out: the chunk count is not 47":

      "So the realized release is not a constant 47 x 65,536 = 3,080,192 B.
       At the modal 46 it is 3,014,656 B"
      "The record raised this headline from 15.940% to 16.226% on the strength
       of sb's 47 chunks. At the modal 46 it reads 15.94% again."

  Shown inside ONE binary by evidence-lane/LANE-VARIANCE.md, section "The
  chunk count is a per-run draw, now shown inside one binary":

      "Fiber read 46, 47, 46."
      "Tally 46 in 12 of 15, 47 in 3 of 15."

  SO BOTH ROUTES ABOVE CARRY A ONE-DRAW NUMERATOR. The headline returns to
  15.940%. The ROUTE A / ROUTE B construction itself -- numerator and
  denominator on one lane -- is upheld and is not what moved.

  WHY THIS FILE IS BANDED BY HAND RATHER THAN REGENERATED. It is produced by
  `sb-compare.sh` and cannot be regenerated without re-running `sb`;
  evidence-variance/VARIANCE.md section "8. What this slice did NOT do, and
  why" gave exactly that reason for routing its amendment to
  POSTFIX-CENSUS.md instead. The consequence was that the file carrying the
  figure never got the pointer. The practice settled on later in the same day
  -- see the `AUDITED: THE -340,480 B LINE IS NOT SEPARABLE AT n=3` band above,
  appended by hand by evidence-lane/_append-bands.py -- is append-only hand
  bands below the generated text, and this band follows it.

  SECTIONS OF THIS FILE NOT NAMED ABOVE ARE NOT THEREBY IN FORCE -- they are
  merely UNAUDITED by this band.
"""

BANDS["tests/perf/pagecensus/evidence-fr2/DECOMP.txt"] = """
  LATER BAND ON THE `LANE MARKER` ABOVE, 2026-10-11 -- ITS "WHAT SURVIVES"
  CLAUSE SURVIVES ONE TERM TOO MANY. Nothing above is edited or re-run.

  THE LINE THIS BAND ANSWERS, in the LANE MARKER attached to the block
  "THE STRING-ARENA FIX, 3,080,192 B = 2.9375 MiB, against every denominator
  it has:":

      "WHAT SURVIVES: 3,080,192 B itself (47 x 65,536, one binary, source
       arithmetic)"

  THE COUNT 47 IS A PER-RUN DRAW, AND "one binary" DOES NOT RESCUE IT.
  evidence-lane/LANE-VARIANCE.md (heapcensus), section "The chunk count is a
  per-run draw, now shown inside one binary":

      "Fiber read 46, 47, 46."
      "Tally 46 in 12 of 15, 47 in 3 of 15."

  and heapcensus evidence-variance/VARIANCE.md, section "5. The correction
  that falls out: the chunk count is not 47":

      "So the realized release is not a constant 47 x 65,536 = 3,080,192 B.
       At the modal 46 it is 3,014,656 B"

  The marker scoped the numerator to ONE BINARY because the defect it was
  marking was a CROSS-LANE mismatch. The count varies run to run WITHIN one
  binary at fixed knobs, so the one-binary scope was the wrong fence for this
  term. The term that is genuinely source arithmetic is the PER-CHUNK
  65,536 B, not the product.

  WHAT SURVIVES, RESTATED. The repair's realized release is measured at
  -3,020,443 B of settled `busy` over six runs (heapcensus
  evidence-variance/VARIANCE.md, section "4. Where the bytes actually go"),
  i.e. the modal 46 x 65,536 = 3,014,656 B plus a +5,787 B residual -- about
  2.0% below the 3,080,192 B used in the four percentage pairs above, which
  the LANE MARKER had already marked for a different reason. The v1-v3 / f1
  decompositions of this file remain this file's own and are untouched.

  LINES OF THIS FILE NOT NAMED ABOVE ARE NOT THEREBY IN FORCE -- they are
  merely UNAUDITED by this band.
"""

BANDS["tests/perf/heapcensus/WHICH-BUFFER.md"] = """
---

> ## SCOPED, 2026-10-11 - SECTION 1 IS A STATEMENT ABOUT THE SETTLED INSTANT
>
> **The claim this band scopes**, the title and finding of section
> *"1. (a) WHICH buffer"*: that the 1,328-byte class **is not a buffer, it is
> SQLite**, supported by `HCSIZE 1328` live at rest reading **1**.
>
> **That reading is right, and it is a reading AT REST.** At the PEAK instant
> the same class is the parked-coroutine population on the fiber lane.
> `evidence-peakvar/PEAK-VARIANCE.md`, section *"4. What fell out for free: the
> 1,328 class at the peak is a lane population"*:
>
> > "**A ratio of means of 1,554x, and it vanishes by shutdown on both lanes**
> > - which is exactly why no settled census in this repository could ever have
> > seen it."
>
> The six peak runs read 13 / 20,203 / 20,203 / 15 / 13 / 24,242 blocks live at
> the peak against 1 / 14 / 13 / 1 / 1 / 14 at shutdown.
>
> **This does NOT refute section 1.** The section reads the class at rest and
> is correct there, and the stackless arm - the arm this frontend ships - reads
> 13-15 blocks even at the peak. What the band adds is the scope: **section 1's
> finding is about the settled instant and must not be carried to the peak**,
> where on the fiber lane the class is 87.4% of the lane's peak delta and is
> stacks, not SQLite. The two instruments do not disagree; they answer at
> different times.
>
> **Also recorded here because it bears on section 1's SQLite identification
> and is a confirmation, not a correction:** the 4,376-byte class is named at
> `file:line` as SQLite's page cache in `evidence-peaksite/SITE.md`, section
> *"2. 4,376"*, titled "NAMED, three independent strands", which derives
> `4096 + 216 + 56 + 8` from `sqlite3MemMalloc`'s size prefix at
> `vendor/sqlite/sqlite3.c:28035`.
>
> **Sections of this file not named above are NOT thereby in force; they are
> merely UNAUDITED by this band.**
"""


def main():
    changed = []
    for rel, band in BANDS.items():
        path = os.path.join(ROOT, rel)
        with open(path, "rb") as fh:
            before = fh.read()
        assert b"\r" not in before, "target is not pure LF: " + rel
        assert before.endswith(b"\n"), "target does not end with newline: " + rel
        text = band
        if not text.startswith("\n"):
            text = "\n" + text
        add = text.encode("utf-8")
        assert b"\r" not in add, "band contains CR: " + rel
        try:
            add.decode("ascii")
        except UnicodeDecodeError:
            raise AssertionError("band is not ASCII: " + rel)
        after = before + add
        with open(path, "wb") as fh:
            fh.write(after)
        with open(path, "rb") as fh:
            back = fh.read()
        assert back == after, "readback mismatch: " + rel
        assert back.startswith(before), "NOT APPEND-ONLY: " + rel
        assert b"\r" not in back, "CR appeared after write: " + rel
        changed.append((rel, len(before), len(back), len(back) - len(before)))
    for rel, b0, b1, d in changed:
        print("APPENDED  %-62s %7d -> %7d  (+%d B)" % (rel, b0, b1, d))
    print("files: %d" % len(changed))


main()
