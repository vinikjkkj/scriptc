# The ambient file's per-program cost, and the corpus-static timeout

## The question

`coverage.test.ts > every corpus program is 100% static` timed out at
601867 ms against a hardcoded 600000 ms in the full gate. This block adds a
~230-line ambient declaration file to EVERY program's roots, and that test
pays it once per corpus program, 1725 times. That is a specific, plausible
mechanism by which the failure could be mine, so it was measured rather than
attributed.

## The A/B — and the sample that would have given the wrong answer

`analyze()` over the same 60 corpus files, sorted, one untimed warm-up,
mean ms per program.

| run | ambient root | mean ms | host |
| --- | --- | --- | --- |
| A1 | with    | **201.51** | another block's gate RAMPING UP |
| B1 | without | 162.61 | contended |
| A2 | with    | 159.04 | contended |
| A3 | with    | 170.75 | contended |
| A4 | with    | 174.35 | contended |
| A5 | with    | 168.07 | contended |
| B2..B5 | without | 156.29 / 150.31 / 150.54 / 159.52 | contended |
| **A6** | with    | **160.31** | quiet |
| **A7** | with    | **160.35** | quiet |
| **A8** | with    | **160.30** | quiet |
| **B6** | without | **157.95** | quiet |
| **B7** | without | **153.63** | quiet |
| **B8** | without | **145.59** | quiet |

**A1 alone against B1 says the ambient file costs 39 ms per program — a 24%
regression, and over 1725 programs 67 s, which would have been decisive.**
That reading is wrong. A1 was taken while a sibling block's gate was spinning
up. The drift control (re-running A after B) is what caught it: A2 came back
at 159 ms, indistinguishable from B.

On a **quiet** host, three samples each:

    with     160.32 ms  (160.30, 160.31, 160.35 — spread 0.05 ms)
    without  152.39 ms  (145.59, 153.63, 157.95 — spread 12.4 ms)
    delta      ~8 ms per program, about 5%

Over 1725 programs that is roughly **14 seconds**. Real, measurable, and not
free — but an order of magnitude below what the single-sample reading claimed.

## The direct answer

The A/B only bounds the mechanism. The test itself settles it. Run alone on a
quiet host, **with the ambient file present**:

    ✓ every corpus program is 100% static (corpus and coverage agree)  387549 ms
    Test Files 1 passed — rc=0

**387.5 s against a 600 s limit: a 212 s margin, not 22 s.** So the gate's
601867 ms was contention, and the ~14 s the ambient file costs is not close to
decisive. The "578 s uncontended" figure this margin panic was built on was a
single sample; four samples elsewhere put the test near 269 s, and this one
lands at 387 s with my change in.

**Recorded as a design constraint anyway:** ~8 ms per program is what one
~230-line always-shipped ambient file costs. That is the unit price for the
next one, and stage 3/4 should not assume it is zero.
