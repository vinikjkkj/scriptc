#!/usr/bin/env python3
# Verify every pointer added by _append-pointers.py IN THE POST-EDIT FILES.
# Each check is (file, needle). Needles are normalised: whitespace collapsed,
# unicode dashes/times/quotes mapped to ASCII, so a quote that crosses a line
# wrap in either document still matches.
#
# Run with --selftest to corrupt two needles on purpose: a green run is only
# evidence if the harness can go red.
import os
import re
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
SELFTEST = "--selftest" in sys.argv

MAP = {
    "\u2014": "-", "\u2013": "-", "\u2212": "-", "\u00d7": "x",
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2026": "...", "\u00a0": " ",
}


def norm(s):
    for k, v in MAP.items():
        s = s.replace(k, v)
    s = s.replace("*", "").replace("`", "").replace(">", " ")
    s = re.sub(r"\s+", " ", s)
    return s.lower()


CACHE = {}


def body(rel):
    if rel not in CACHE:
        with open(os.path.join(ROOT, rel), "rb") as fh:
            CACHE[rel] = norm(fh.read().decode("utf-8"))
    return CACHE[rel]


HC = "tests/perf/heapcensus/"
PC = "tests/perf/pagecensus/"

LIVEPAIR = HC + "evidence-livepair/RESULTS.md"
OWNER = HC + "OWNER-131079.md"
PLAN = HC + "PLAN-POSTFIX-CENSUS.md"
LANE = HC + "evidence-postfix/LANE.txt"
SBC = HC + "evidence-postfix/sb.compare.txt"
FR2 = PC + "evidence-fr2/DECOMP.txt"
WB = HC + "WHICH-BUFFER.md"

VERD = HC + "evidence-chunkref/VERDICT.md"
VAR = HC + "evidence-variance/VARIANCE.md"
LV = HC + "evidence-lane/LANE-VARIANCE.md"
PV = HC + "evidence-peakvar/PEAK-VARIANCE.md"
SITE = HC + "evidence-peaksite/SITE.md"

CHECKS = [
    # --- 1. livepair: the sentences it answers, in the banded file itself ---
    (LIVEPAIR, "## 3. Is the copy semantically necessary? NO -- and the ownership says so in one line."),
    (LIVEPAIR, "5.6-6.5 MB of the peak"),
    (LIVEPAIR, "5.62%, 6.04% and 5.64% of private bytes at the peak"),
    (LIVEPAIR, "## What this slice did NOT do"),
    (LIVEPAIR, "The 5.6-6.5 MB figure is"),
    (LIVEPAIR, "## MEASURED AND DEAD, 2026-10-11"),
    # --- 1b. livepair: where it now points ---
    (VERD, "## The deciding item, and it is a COUNT, not a t"),
    (VERD, "PRE reads 6, 7, 6. POS reads 6, 7, 6."),
    (VERD, "## The peak aggregate, and an honest statement of its weakness"),
    (VERD, "## The patch does work. It removes 7.48 MB of FLOW per run"),
    (VERD, "7,475,028"),

    # --- 2. OWNER-131079 ---
    (OWNER, "## 5. The alignment has no consumer: the lever"),
    (OWNER, "they reproduced to the byte"),
    (OWNER, "16.226% against this run's own counterfactual pre-fix heap of"),
    (OWNER, "16.291% against the stackless"),
    (OWNER, "## AUDITED, 2026-10-11 (later the same day) - THE RESOLVED BLOCK IN SECTION 5 RESTS ON A PER-RUN DRAW"),
    (VAR, "## 5. The correction that falls out: the chunk count is not 47"),
    (VAR, "46 in six of eight; 47 in two, both of them the 2026-10-11 post-fix pair."),
    (VAR, "The raise rests on a single draw of a quantity that moves by 65,536 B."),
    (VAR, "## 4. Where the bytes actually go"),
    (VAR, "3,020,443"),
    (LV, "### The chunk count is a per-run draw, now shown inside one binary"),
    (LV, "Fiber read 46, 47, 46."),
    (LV, "Tally 46 in 12 of 15, 47 in 3 of 15."),
    (LV, "## 3. The verdict"),
    (LV, "[-702,009, +504,291]"),

    # --- 3. PLAN-POSTFIX-CENSUS ---
    (PLAN, "### RESOLVED, 2026-10-11"),
    (PLAN, "the byte across both lanes: 47 chunks, 3,080,192 B, zero frees."),
    (PLAN, "What the plan registered and lane-independence predicted, held"),
    (PLAN, '## AUDITED, 2026-10-11 (later the same day) - "47 chunks" IS A DRAW'),
    (VAR, "So the realized release is not a constant 47 x 65,536 = 3,080,192 B."),
    (VAR, "At the modal 46 it is 3,014,656 B"),

    # --- 4. LANE.txt ---
    (LANE, "WHAT SURVIVED THE LANE CHANGE -- the string arena is lane-independent, and"),
    (LANE, "The arena allocates 47 chunks of exactly 65,536 B and releases none, on"),
    (LANE, "draw; it reproduced."),
    (LANE, "WHAT THIS RESOLVES IN POSTFIX-CENSUS.md SECTION 5"),
    (LANE, "3,080,192 / (15,902,592 + 3,080,192 = 18,982,784) = 16.226%"),
    (LANE, 'AUDITED 2026-10-11 (later the same day) -- "47 chunks ... NOT A DRAW" IS A DRAW'),
    (LANE, "AUDITED 2026-10-11 -- THE SETTLED-HEAP LANE FIGURE IS NOT SEPARABLE AT n=3"),

    # --- 5. sb.compare.txt ---
    (SBC, "=== ROUTE A and ROUTE B, both with their denominators named ==="),
    (SBC, "live string-arena chunks in sb = 47 alloc - 0 freed = 47"),
    (SBC, "3080192 / (15902592 + 3080192 = 18982784) = 16.226%"),
    (SBC, "3080192 / 18907440 = 16.291%"),
    (SBC, "AUDITED 2026-10-11 (later the same day) -- THE 47-CHUNK NUMERATOR IS A DRAW"),
    (SBC, "AUDITED: THE -340,480 B LINE IS NOT SEPARABLE AT n=3"),
    (VAR, "## 8. What this slice did NOT do, and why"),
    (VAR, "Did not touch evidence-postfix/sb.compare.txt."),

    # --- 6. pagecensus DECOMP.txt ---
    (FR2, "THE STRING-ARENA FIX, 3,080,192 B = 2.9375 MiB, against every denominator it has:"),
    (FR2, "WHAT SURVIVES: 3,080,192 B itself (47 x 65,536, one binary, source"),
    (FR2, "LATER BAND ON THE LANE MARKER ABOVE, 2026-10-11"),

    # --- 7. WHICH-BUFFER.md ---
    (WB, "## 1. (a) WHICH buffer"),
    (WB, "it is not a buffer, it is SQLite"),
    (WB, "## SCOPED, 2026-10-11 - SECTION 1 IS A STATEMENT ABOUT THE SETTLED INSTANT"),
    (PV, "## 4. What fell out for free: the 1,328 class at the peak is a lane population"),
    (PV, "A ratio of means of 1,554x, and it vanishes by shutdown on both lanes"),
    (SITE, "## 2. 4,376"),
    (SITE, "NAMED, three independent strands"),
]

if SELFTEST:
    CHECKS = list(CHECKS)
    CHECKS[1] = (LIVEPAIR, "5.6-6.5 ZZ of the peak")
    CHECKS[20] = (LV, "Fiber read 99, 99, 99.")

fails = 0
for rel, needle in CHECKS:
    ok = norm(needle) in body(rel)
    if not ok:
        fails += 1
    print("%-5s %-58s %s" % ("ok" if ok else "FAIL", rel.split("/")[-1], needle[:72]))

print("")
print("checks=%d fails=%d" % (len(CHECKS), fails))

# every banded file must still be pure LF and must still end with a newline
for rel in [LIVEPAIR, OWNER, PLAN, LANE, SBC, FR2, WB]:
    with open(os.path.join(ROOT, rel), "rb") as fh:
        b = fh.read()
    assert b"\r" not in b, "CR in " + rel
    assert b.endswith(b"\n"), "no trailing newline in " + rel
print("line endings: 7 of 7 pure LF, by byte counter")
sys.exit(1 if fails else 0)
