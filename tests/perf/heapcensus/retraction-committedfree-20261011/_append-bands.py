#!/usr/bin/env python3
# Append-only retraction bands for ONE figure: the reading of `busy + free` as
# COMMITTED memory. The argument lives once, in
# tests/perf/heapcensus/COMMITTED-FREE-RETRACTION.md; each band here names the
# SECTION and QUOTES the sentence it answers, points at the refutation by
# SECTION + QUOTED SENTENCE, and states that sections it does not name are
# UNAUDITED rather than thereby in force.
#
# BINARY MODE, LF only. Every target was checked with a byte counter first:
#   - abba1A.score.txt / abba4A.score.txt are MIXED (87 CRLF / 28 LF). The CRLF
#     lines are pasted raw instrument output; every hand-written and say()-
#     generated line is LF, so the band is LF.
#   - every other target is pure LF.
# Nothing existing is rewritten: the script asserts the old bytes are an exact
# prefix of the new bytes after every write.
#
#   python _append-bands.py [REPO_ROOT]          # default: four levels up
#
# Re-running is a no-op: a file already carrying the marker is skipped.
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))

MARKER = "RETRACTED COLUMN, 2026-10-11 -- `busy + free` IS NOT COMMITTED MEMORY"

# ---------------------------------------------------------------- the shared
# refutation pointer, by section and quoted sentence. Used by every band.
REF_TXT = """  THE REFUTATION, by section and quoted sentence.
  tests/perf/heapcensus/COMMITTED-FREE-RETRACTION.md, section
  "1. The mechanism, demonstrated and not inferred":

      "The NT heap decommits pages inside a free run without splitting that
       run into a `PROCESS_HEAP_UNCOMMITTED_RANGE`, so `HeapWalk` keeps
       reporting the whole block."

  with a NEGATIVE CONTROL in the same table -- the arm that frees nothing
  reads free >= 64 KiB as 0.961 MiB, 100% MEM_COMMIT, 0.000 MEM_RESERVE --
  and section "2. The arithmetic contention, same run, no second variable":

      "the process's own HeapWalk in that run: busy 15.594 + free 21.651 =
       37.245 / EXCESS 15.933 MiB that cannot be committed anywhere"

  WHAT SURVIVES, AND IT IS MOST OF IT. The numbers above are still exactly
  what HeapWalk reported, and `busy + free` is still a valid CEILING. `busy`
  is unaffected -- it is live data. `uncommitted` is unaffected -- it is
  reserved and not paid. IT IS THE SUM THAT BROKE, and only as a statement
  about COMMIT. Nothing here is deleted and no physics is withdrawn.

  SCOPE OF THIS BAND. It audits ONE figure. EVERY SECTION OF THIS FILE THAT
  IT DOES NOT NAME IS UNAUDITED BY IT -- it is NOT thereby in force.
"""

REF_MD = "\n".join(
    ("> " + ln).rstrip() if ln.strip() else ">"
    for ln in REF_TXT.rstrip("\n").split("\n")
)

HEAD_TXT = ("\n"
            "================================================================================\n"
            + MARKER + "\n"
            "================================================================================\n\n")

HEAD_MD = ("\n---\n\n"
           "> ## " + MARKER + "\n>\n")


def txt_band(body):
    return HEAD_TXT + body.rstrip("\n") + "\n\n" + REF_TXT


def md_band(body):
    q = "\n".join(("> " + ln).rstrip() if ln.strip() else ">"
                  for ln in body.rstrip("\n").split("\n"))
    return HEAD_MD + q + "\n>\n" + REF_MD + "\n"


BANDS = {}

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/evidence-peak/abba1A.score.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS, in the section
  "================ RANKING ================":

      "AT THE PEAK.  CRT committed (busy+free, all heaps) = 54.093 MiB"
      "AT SHUTDOWN. CRT committed (busy+free, all heaps) = 32.895 MiB"

  Both lines name a CEILING on committed CRT heap. They do not name committed
  CRT heap. The HCPKHEAPS free term they add in -- 10,267,584 B at the peak,
  18,546,848 B at shutdown -- is the data extent of free blocks, and the NT
  heap has already decommitted an unreported share of those pages.

  WHAT IS UNTOUCHED, AND IT IS THE PART THIS FILE EXISTS FOR. Both ranking
  tables below those lines take their denominator from HCPKTOTAL / HCTOTAL
  bytes, which is BUSY ONLY -- the file says so on each table's own header
  line ("DENOMINATOR: HCPKTOTAL bytes (CRT busy)"). Every share in both
  tables stands.""")

BANDS["tests/perf/heapcensus/evidence-peak/abba4A.score.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS, in the section
  "================ RANKING ================":

      "AT THE PEAK.  CRT committed (busy+free, all heaps) = 61.183 MiB"
      "AT SHUTDOWN. CRT committed (busy+free, all heaps) = 37.531 MiB"

  Both lines name a CEILING on committed CRT heap. They do not name committed
  CRT heap: the free term they add in is the data extent of free blocks, and
  the NT heap has already decommitted an unreported share of those pages.

  WHAT IS UNTOUCHED, AND IT IS THE PART THIS FILE EXISTS FOR. Both ranking
  tables below those lines take their denominator from HCPKTOTAL / HCTOTAL
  bytes, which is BUSY ONLY -- the file says so on each table's own header
  line ("DENOMINATOR: HCPKTOTAL bytes (CRT busy)"). Every share in both
  tables stands.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/evidence-peakvar/RESULTS.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS. In the section
  "=== 6b. THE -21.117 MiB SENTENCE, PLACED AGAINST THE RIGHT COLUMN ===":

      "That row is CRT heap COMMITTED at the PEAK. The column that answers it
       here is pkAllCommitted = HCPKHEAPS busy + free, not pkCrtBusy."

  and in the section
  "=== 8. 81.90% BUSY AT PEAK vs 46.19% AT SHUTDOWN (PEAK-OCCUPANT.md) ===":

      "DENOMINATOR, NAMED: busy+free of the SAME walk -- all heaps at the
       peak, CRT heap 0 at shutdown."

  pkAllCommitted IS ADDRESS SPACE, NOT COMMIT. Section 6b therefore compares
  one ceiling (this file's pkAllCommitted) with another (DECOMP.txt's own
  busy+free row). THE COMPARISON STAYS LIKE FOR LIKE -- which is why 6b's
  verdict is not disturbed -- but neither side is a commit level, and the
  82-83 MiB / 56-59 MiB absolutes must not be quoted as memory paid.

  SECTION 8's RATIO IS BYTES OVER ADDRESS SPACE. busy is bytes; busy+free is
  address space. The 40-61 pp peak-to-shutdown swing it reports can be
  produced in part by the heap decommitting inside free runs, with no change
  in what the process pays. The ORDERING the section draws between arms may
  survive; the LEVELS 81.90% and 46.19% are not occupancy of paid memory.""")

BANDS["tests/perf/heapcensus/evidence-peakvar/PEAK-VARIANCE.md"] = md_band("""**The lines this band answers.** In section *"The lane IS separable at the
peak — the thing the settled heap could not do"*:

> "| peak committed | 87,373,925 | 58,401,632 | **−28,972,293** | 5.44 | 3.32 |
> 3.182 | [−45,933,329, −12,011,258] |"

and in section *"The −21.117 MiB sentence now has a second, independent
measurement"*:

> "That is CRT heap **committed** at the peak, so the column that answers it
> is `pkAllCommitted`, not peak busy."

**`pkAllCommitted` is `HCPKHEAPS busy + free`, which is heap ADDRESS SPACE.**
The −28,972,293 B is therefore a separable difference in how much address
space the two lanes' heaps hold at the peak. That difference is real and the
t column is unaffected. **It is not evidence that the stackless lane pays
28.97 MiB less**, and the row must not be carried into any commit budget.

**What this band does NOT disturb.** Section *"The 94.33% / 17.89% pair is NOT
refuted, and the reason is the denominator"* is argued on `PrivateUsage`, a
kernel column this retraction does not touch; and the file's own refusal to
quote a commit figure from an instrumented binary stands unchanged.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/evidence-postfix/sb.compare.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS, in the section
  "=== THE LANE'S EFFECT ON THE SETTLED HEAP, EVERY COLUMN ===":

      "free is -7.92 MiB and uncommitted is -23.28 MiB, for a committed
       total (busy + free) of -8.244 MiB and 2 fewer regions."
      "the fibre arm settles holding 23 MiB more uncommitted address space
       and 8 MiB more free-but-committed heap at nearly the same busy total."

  -8.244 MiB IS A DELTA IN ADDRESS SPACE, NOT IN COMMIT, and "free-but-
  committed" is the wrong name for the 8 MiB: an unreported share of it is
  free-and-already-decommitted.

  THE PARAGRAPH'S OWN CONCLUSION SURVIVES AND GETS STRONGER, NOT WEAKER.
  Its point is that the lane's settled-heap effect "lives almost entirely
  OUTSIDE the busy column". That is now true twice over: part of the space it
  lives in is space neither arm was paying for. The -340,480 B busy headline,
  and the 11.1%-of-2.9375-MiB arithmetic on it, are BUSY-ONLY and untouched.""")

BANDS["tests/perf/heapcensus/evidence-postfix/LANE.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS, in the paragraph headed
  "AND THE LANE IS NOT A SMALL THING IN THIS HEAP", and quoted again in the
  band headed "The lines this band answers, in the section 'THE CONFOUND
  THIS FILE FLAGGED, NOW MEASURED -- `sb.compare.txt`'":

      "It is worth -23.3 MiB of uncommitted address space and -7.9 MiB of
       free-but-committed heap at nearly the same busy total."

  "FREE-BUT-COMMITTED" IS THE WRONG NAME. An unreported share of those 7.9
  MiB is free and already decommitted, so the -7.9 MiB is a delta in address
  space, not in memory paid.

  THIS FILE ALREADY CARRIES A BAND, FOR A DIFFERENT FIGURE. That earlier band
  answers the -340,480 B busy sentence and says so. It does NOT cover this
  line, and a reader who sees one retraction marker and stops reading will
  carry the -7.9 MiB away intact. THE TWO BANDS NAME DISJOINT LINES.

  WHAT IS UNTOUCHED. Everything in this file argued on the BUSY column --
  including "ON THE BUSY COLUMN THE CONFOUND IS 11.1% OF THE CLAIMED EFFECT,
  NOT 720%" and the file's refusal to carry the peak's 21 MiB into a
  settled-heap error bar -- stands exactly as written.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/evidence-lane/RESULTS.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS. The column named `committed` in the tables of
  the sections "=== EVERY RUN, in the declared CBBCCB order ===",
  "=== ALL SIX RUNS. Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===" and
  "=== LEAVE-ONE-OUT: position 1 (c1) dropped, as PREREG.txt promised ===":

      "pos tag arm lane            busy  busyBlk        free  freeBlk
       committed  uncommitted  busy+free+unc  reg  chunks   chunkB  freed"
      "committed     46927717   4489829    33994955   1086332       -12932763
       4.85   2.23   4.303        [-24408867, -1456659]   YES"

  THAT COLUMN IS `busy + free` (lane-stats.mjs:48), WHICH IS ADDRESS SPACE.
  The -12,932,763 B and its "YES" are a separable difference in heap address
  space between the two arms. The t, the df and the interval are arithmetic
  on the numbers as measured and are unaffected; what changes is what the
  column is a measurement OF. It is not memory paid, and must not be quoted
  into a commit budget.

  THE THREE COLUMNS THEMSELVES ARE FINE. `busy` is live data. `uncommitted`
  is reserved and not paid. `busy+free+unc` is heap ADDRESS SPACE and is
  CORRECTLY NAMED -- that column needs no correction at all.

  WHAT IS UNTOUCHED. Section "=== THE COMMITTED PAIR, PLACED AGAINST THIS
  SESSION'S ARMS ===" and the 6.1%-of-the-claimed-lane-effect conclusion are
  argued on the BUSY column and stand.""")

BANDS["tests/perf/heapcensus/evidence-lane/LANE-VARIANCE.md"] = md_band("""**The lines this band answers.** In section *"A floor that applies to every
\\"YES\\" in `RESULTS.txt`"*:

> "columns that do cross 4.303 — `free`, `committed`, `busyBlocks`,
> `freeBlocks` —"

and in section *"4. The wider sentence is bounded the same way"*:

> "on −7.919 MiB of `free` and −23.281 MiB of `uncommitted`. Measured 3 v 3:"

**The `committed` column is `busy + free` (`lane-stats.mjs:48`), which is heap
ADDRESS SPACE.** Its crossing of 4.303 is a real, separable difference in
address space; it is not a difference in memory paid, and the `free` column it
is built on mixes committed pages with pages the NT heap already returned
without reporting them.

**What this band does not disturb.** The variance floor this section
establishes, the leave-one-out reversal, and every statement made about the
`busy` column are untouched — they are arithmetic on numbers that are still
exactly what `HeapWalk` reported.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/evidence-variance/RESULTS.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS. The column named `committed` in the table of
  the section "=== EVERY RUN, in the declared ABBAAB order ===":

      "pos tag arm        busy  busyBlk        free  freeBlk   committed
       uncommitted  busy+free+unc  reg  chunks   chunkB  freed"

  THAT COLUMN IS `busy + free` (stats.mjs:42), WHICH IS ADDRESS SPACE, not
  commit. Every t, CI and power figure computed on it is arithmetic on the
  numbers as measured and is unaffected; what changes is what the column is a
  measurement OF.

  ONE SECTION OF THIS FILE IS CORRECT AS IT STANDS AND MUST NOT BE READ AS
  COVERED BY THIS BAND. "=== WHERE THE RELEASED BYTES WENT: the conservation
  identity, measured ===" is argued on `busy+free+uncommitted`:

      "delta busy+free+uncommitted = -74784 B  (|t| = 0.85, t_crit 4.303)
       => NOT SEPARABLE FROM ZERO"

  That IS heap address space, it is correctly named, and the conservation
  identity it establishes is exactly as sound as it was before this band.""")

BANDS["tests/perf/heapcensus/evidence-variance/VARIANCE.md"] = md_band("""**The lines this band answers.** The file's title:

> "# The committed heap does not move the way one pair said it did — and the
> chunk count is not 47"

section *"0. The three sentences"*, item 2:

> "**The committed column is not readable at this sample size, and the
> brief's committed range, across three back-to-back runs of one binary at
> fixed knobs...**"

section *"1. The instrument, named before anything was measured"*:

> "classifying each entry by `wFlags` into busy / uncommitted / region /
> (else) committed-free."

and the **P2** rows of section *"3. The predictions, both registered before
run 1"*.

**The column these sentences call `committed` is `busy + free`
(`stats.mjs:42`), which is heap ADDRESS SPACE**, and the `wFlags` bucket this
file calls `committed-free` is free-and-maybe-decommitted. The file's verdict
— that the column is **not readable at n = 3** — is untouched and the
arithmetic behind it is untouched. What changes is the column's name and
therefore what a reader may carry away from it.

**Item 3 of section 0 is CORRECT AS IT STANDS** and is not covered by this
band: *"The 3.02 MB does not leave heap 0 at all. `busy + free + uncommitted`
..."* is argued on heap **address space**, which is correctly named, and the
conservation identity it rests on is as sound as before.""")

BANDS["tests/perf/heapcensus/evidence-variance/PREREG.txt"] = txt_band("""
  THE LINE THIS BAND ANSWERS, in the section
  "=== V1 PRE-REGISTRATION -- written BEFORE any run of this slice ===":

      "P2  committed (busy + free) of the POST arm is FLAT OR HIGHER than"

  THE PARENTHESIS IS THE DEFINITION, AND IT IS THE DEFECT. `busy + free` is
  heap ADDRESS SPACE, so P2 was registered against address space and not
  against commit. The registration itself is intact -- it was written before
  run 1, it says what it says, and its verdict in RESULTS.txt is unaffected.
  What must not happen is for a later reader to carry P2's subject matter
  forward as a statement about memory the process pays.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/evidence-chunkref/RESULTS.txt"] = txt_band("""
  THE LINES THIS BAND ANSWERS. The rows named `pkAllCommitted` and
  `committed` in the tables of the sections
  "=== >>> 5. EACH ARM SPREAD, BEFORE ANY t. <<< ===" and
  "=== 6. ALL SIX RUNS.  Welch t, CRITICAL VALUE TAKEN AT THE WELCH df ===":

      "pkAllCommitted     58944624   4520588     58392107   4206551
       -552517     0.15   3.98   3.182         [-11896810, 10791775]    no"
      "committed          35423947   2697260     34939483   2490709
       -484464     0.23   3.97   3.182           [-7229214, 6260286]    no"

  BOTH ROWS ARE `busy + free` (chunkref-stats.mjs:49 and :55), WHICH IS
  ADDRESS SPACE, not commit. Their verdicts here are NULLS, so nothing this
  file concludes depends on reading them as commit -- but a later reader
  quoting 58.9 MiB or 35.4 MiB as "committed heap" would be quoting address
  space.

  WHAT IS UNTOUCHED, AND IT IS THIS FILE'S WHOLE RESULT. The deciding item in
  evidence-chunkref is a per-class COUNT at the 934,576 class ("PRE reads
  6, 7, 6. POS reads 6, 7, 6."), not any aggregate column. That count, the
  65,536 positive control and the 1,048,575 negative control are all BUSY-side
  and stand exactly as written.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/heapcensus/PEAK-OCCUPANT.md"] = md_band("""**The line this band answers.** In section *"abba1A — denominator 46,433,872
B = 44.283 MiB of CRT busy"*:

> "54.09 MiB committed). At shutdown the same heap is **46.2% busy** (15.19
> MiB"

**The 54.09 MiB is `busy + free` of all heaps at the peak** — it is read
straight off `abba1A.score.txt`'s line *"AT THE PEAK.  CRT committed
(busy+free, all heaps) = 54.093 MiB"*, which this retraction bands in that
file too. It is heap ADDRESS SPACE, so **81.9% busy** and **46.2% busy** are
ratios of bytes to address space, not occupancy of paid memory. The ordering
peak-vs-shutdown may survive; the two levels are not occupancies.

**What this band does NOT disturb, and it is the file's spine.** Section *"2.
The ranking"* states its denominator once and then on every line:

> "**DENOMINATOR, said once and then on every line: `HCPKTOTAL bytes` — the
> CRT"

`HCPKTOTAL bytes` is **CRT busy**. Every ranked share in this file is
busy-over-busy and is untouched by this retraction.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/placement/RESULTS.md"] = md_band("""**The lines this band answers.** In section *"Correction: the array change is
a THROUGHPUT change, not the fragmentation fix"*, the table header and its
largest row:

> "| registered prediction | share of committed-free bytes |"

> "| **1,344 B × 15,766 holes** | **57.3% = 20.21 MiB** |"

**"committed-free" is the wrong name for that denominator.** It is
`HeapWalk`'s `free` column, and the NT heap has already decommitted an
unreported share of those pages without splitting the run into a
`PROCESS_HEAP_UNCOMMITTED_RANGE`.

**The SHARES in this table are untouched.** Every one of them is free bytes
over free bytes; whatever fraction of the denominator is decommitted is
distributed across the numerators too, and the comparison is like for like.
**What dies is the absolute `20.21 MiB` read as retained commit**, and with it
any reading of this table as a 20 MiB recovery opportunity. The section's own
conclusion — *"Allocation volume and residue are different measurements"* —
is unaffected.

**`placement.c:46` and `:362` print the same misnomer** (`COMMITTED-FREE
blocks and bytes`, `committed-free %.2f MiB`); that column is `HeapWalk` free
and is a ceiling, not a commit figure.""")

# ---------------------------------------------------------------------------
BANDS["tests/perf/boxanat/README.md"] = md_band("""**The lines this band answers.** In section *"The chunk is the retention
story, not the node"*:

> "40.65 MiB live, not of the 72.84 MiB committed-but-free. Chunk pinning by"

and in the table in the same section:

> "| **settled committed-free** | **bounded at ~10 MiB by measurement**; not
> the plateau |"

**The 72.84 MiB is `HeapWalk`'s `free` column** (it originates at
`heapcensus/scr_heap_census.h:177`) and is therefore a CEILING on
free-and-committed, not a commit figure: the NT heap has already decommitted
an unreported share of those pages.

**The ~10 MiB BOUND SURVIVES, a fortiori.** A bound on committed-free can only
be made easier to meet by discovering that part of the free column was never
committed. The row's verdict — *"not the plateau"* — is strengthened, not
weakened. **What dies is the 72.84 MiB quoted as memory the process pays**,
and any argument that reasons from its size rather than from the live side.""")


# ---------------------------------------------------------------- code bands
def c_band(body):
    out = ["", "/* " + MARKER, " *"]
    for ln in body.rstrip("\n").split("\n"):
        out.append((" * " + ln).rstrip())
    out.append(" *")
    out.append(" * Full argument, negative control and inventory:")
    out.append(" * tests/perf/heapcensus/COMMITTED-FREE-RETRACTION.md")
    out.append(" *")
    out.append(" * This band audits ONE figure. EVERYTHING ELSE IN THIS FILE IS UNAUDITED BY")
    out.append(" * IT -- not thereby in force. */")
    return "\n".join(out) + "\n"


CODE_NOTE = """`busy + free` is heap ADDRESS SPACE, not committed memory. The NT heap
decommits pages inside a free run without emitting a
PROCESS_HEAP_UNCOMMITTED_RANGE, so HeapWalk keeps reporting the whole block
and the `free` column mixes committed pages with pages already returned to
the OS. Demonstrated with a negative control (an arm that frees nothing
reads 100% MEM_COMMIT; three arms that free read 74.6% / 93.7% / 92.7%
MEM_RESERVE), and contradicted arithmetically in one run: an outside walk
resolves 21.312 MiB of private non-stack commit while this process's own
HeapWalk reports busy+free = 37.245 MiB.

`busy` is unaffected -- it is live data. `uncommitted` is unaffected -- it
is reserved and not paid. The SUM is still a valid CEILING. Only its
reading as COMMIT is retracted."""

BANDS["tests/perf/heapcensus/evidence-variance/stats.mjs"] = c_band(
    "THE LINE THIS BAND ANSWERS, at :42 (and the same expression at :138):\n"
    "\n"
    "    committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],\n"
    "\n"
    "The field this script calls `committed` is busy + free.\n"
    "`addrspace` on the same line is correctly named and is NOT affected.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/heapcensus/evidence-lane/lane-stats.mjs"] = c_band(
    "THE LINE THIS BAND ANSWERS, at :48 (and the same expression at :221):\n"
    "\n"
    "    committed:+m[1]+ +m[3], addrspace:+m[1]+ +m[3]+ +m[5],\n"
    "\n"
    "The field this script calls `committed` is busy + free, and it is the\n"
    "column that carries the \"YES\" in RESULTS.txt's six-run table.\n"
    "`addrspace` on the same line is correctly named and is NOT affected.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/heapcensus/evidence-peakvar/peak-stats.mjs"] = c_band(
    "THE LINES THIS BAND ANSWERS, at :66 and :69:\n"
    "\n"
    "    pkAllCommitted: +ph[2] + +ph[4],\n"
    "    committed: +m[1] + +m[3],\n"
    "\n"
    "and the two ratios built on them at :82-:83, `pkBusyFrac` and\n"
    "`stBusyFrac`, whose denominators are therefore ADDRESS SPACE while their\n"
    "numerators are bytes. The 81.90% / 46.19% pair this script prints is not\n"
    "an occupancy of paid memory.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/heapcensus/evidence-chunkref/chunkref-stats.mjs"] = c_band(
    "THE LINES THIS BAND ANSWERS, at :49 and :55:\n"
    "\n"
    "    pkAllCommitted: +ph[2] + +ph[4],\n"
    "    committed: +m[1] + +m[3],\n"
    "\n"
    "Both are busy + free. Both read as NULLS in RESULTS.txt, so this\n"
    "slice's verdict -- which rests on the per-class COUNT at 934,576, not on\n"
    "any aggregate column -- is untouched.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/settled-census/plateau.mjs"] = c_band(
    "THE LINES THIS BAND ANSWERS, at :86 and :101:\n"
    "\n"
    "    crtFree:      36.51 * MiB,\n"
    "    ['CRT heap committed-FREE', M.crtFree,\n"
    "\n"
    "THIS IS THE SHARPEST CASE IN THE FRONT, because the row is SUMMED into\n"
    "an itemisation of what the settled process holds. An unreported share of\n"
    "those 36.51 MiB was already returned to the OS, so the itemisation's\n"
    "total overstates what is paid and the `fragmentation` line at :163\n"
    "overstates the recoverable part. The assertion at :125 (`payload <\n"
    "M.crtFree`) compares a payload against a CEILING and can pass on a\n"
    "margin that does not exist.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/settled-census/reconcile.mjs"] = c_band(
    "THE LINES THIS BAND ANSWERS, at :460 and :482:\n"
    "\n"
    "    'the heap holds MORE committed-free than busy ('\n"
    "    'committed-free space accounts for the retention to within 15% ('\n"
    "\n"
    "and the section printed at :662, 'THE PAGE-SHAPED FRACTION OF THE\n"
    "COMMITTED-FREE SPACE'. `crt.free` is HeapWalk's free column, so\n"
    "\"committed-free\" is a ceiling. The :482 check -- that the free column\n"
    "accounts for the retention to within 15% -- is the one most at risk: it\n"
    "matches a CEILING against a kernel-side retention figure, and the match\n"
    "can be coincidental in either direction.\n"
    "\n"
    "The page-shaped fraction at :662 is NOT disturbed as a shape statement:\n"
    "whole 4 KiB pages inside contiguous free runs are what they are. What\n"
    "changes is that some of those pages are already decommitted.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/pagecensus/vmheap.c"] = c_band(
    "THE LINES THIS BAND ANSWERS, at :7 in the WHY block and at :142:\n"
    "\n"
    "    \"a heap that is 95% live objects and a heap that is 95%\n"
    "     committed-but-free are different problems\"\n"
    "    fprintf(f, \"TOTAL %.3f MiB   busyShare=%.2f%%\\n\",\n"
    "            (busy + freeb) / 1048576.0, ...);\n"
    "\n"
    "THIS CHANGES THE VERDICT ON THE ROUTE, NOT JUST THE OUTPUT. This file is\n"
    "kept as the record of a route that was tried and failed, and its RESULT\n"
    "block blames SPEED -- Heap32Next at 4.6 ms/block, a budget stop, a\n"
    "perturbed subject. A reader concludes the route would answer if only it\n"
    "were fast enough. IT WOULD NOT. ToolHelp enumerates BLOCKS; the question\n"
    "is about PAGES, and a free block's pages may already be decommitted with\n"
    "no block-level signal. A arbitrarily fast ToolHelp walk would still\n"
    "report busyShare over a denominator that is address space.\n"
    "\n"
    "THE CONTROL ARM IS STILL SOUND, and it is sound for a reason worth\n"
    "keeping: vmtgt holds 60 MiB of live malloc and frees nothing, which is\n"
    "exactly the negative-control state in which the free column IS 100%\n"
    "committed. busyShare 95.35% against vmtgt is correct.\n"
    "\n" + CODE_NOTE)

BANDS["tests/perf/placement/placement.c"] = c_band(
    "THE LINES THIS BAND ANSWERS, at :46 and :362:\n"
    "\n"
    "    \"HeapWalk over every heap: busy blocks and bytes, COMMITTED-FREE\n"
    "     blocks and\"\n"
    "    printf(\"  returned-to-OS %.2f MiB | committed-free %.2f MiB | busy\n"
    "            %.2f MiB\\n\", ...);\n"
    "\n"
    "`committed-free` is HeapWalk's free column and is a CEILING, so the\n"
    "three printed terms are not disjoint in the way the line implies: part\n"
    "of `committed-free` has already been returned to the OS and is therefore\n"
    "also inside what `returned-to-OS` is trying to name.\n"
    "\n"
    "The arm-to-arm COMPARISONS in this program are not disturbed -- every\n"
    "arm is measured the same way -- and `returned-to-OS` and `commit` come\n"
    "from the kernel side, not from HeapWalk.\n"
    "\n" + CODE_NOTE)


def main():
    written, skipped = 0, 0
    for rel, band in BANDS.items():
        path = os.path.join(ROOT, rel.replace("/", os.sep))
        with open(path, "rb") as fh:
            old = fh.read()
        assert b"\r" not in band.encode("utf-8"), "band must be LF only: " + rel
        if MARKER.encode("utf-8") in old:
            print("SKIP (already banded) " + rel)
            skipped += 1
            continue
        assert old.endswith(b"\n"), "target does not end in a newline: " + rel
        with open(path, "ab") as fh:
            fh.write(band.encode("utf-8"))
        with open(path, "rb") as fh:
            new = fh.read()
        # APPEND-ONLY PROOF: the old bytes must be an exact prefix of the new.
        assert new[:len(old)] == old, "NOT APPEND-ONLY: " + rel
        assert len(new) == len(old) + len(band.encode("utf-8")), "size drift: " + rel
        print("OK %-72s +%d B" % (rel, len(new) - len(old)))
        written += 1
    print("\nwritten=%d skipped=%d of %d" % (written, skipped, len(BANDS)))


if __name__ == "__main__":
    main()
