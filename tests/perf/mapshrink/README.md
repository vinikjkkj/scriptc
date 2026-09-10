# mapshrink — giving a sparse map's tables back, and the safepoint that makes it safe

Self-test for `scr_map_idle_shrink`. One `zig cc` of one file, two
processes, no scriptc compiler, no runtime link and no rig:

```sh
sh tests/perf/mapshrink/run.sh [<out-dir>]
```

Three arms, and the third is the one that matters most.

| arm | what it proves |
|---|---|
| A, shrink enabled | 31 checks over seven outcome classes |
| B, `SCR_MAP_SHRINK=0` | 5 checks: disabled does nothing, loudly. A **separate process**, because the knob is cached on first use, so an in-process "disabled" arm would prove nothing |
| C, **negative control** | injects a bail-out into `scr_map_shrink_one` and **requires** the suite to fail. Broken, it reports 7 failures and exits 1 |

Arm C exists because a suite that only ever prints `ok` has not been shown
able to print `FAIL`. It is also why nothing in this directory may be named
`scr_map.c`: `selftest.c` does `#include "scr_map.c"`, and a quoted include
searches the includer's directory before any `-I`, which is exactly the
mechanism arm C uses to substitute a broken copy.

## A retention bug in `scr_map_clear`, found in passing and reported on its own

**This is not a subclause of the shrink. It predates it and it is a defect
in `clear()`.**

`scr_map_clear` releases every key and value and sets `nentries` to 0 — and
**frees nothing**. `entries`, `live` and `buckets` all keep whatever
capacity the map reached at its peak, for the remaining life of the map.

A reader of that function would reasonably assume it frees. `map.clear()`
is the most explicit statement a caller can make that the contents are no
longer wanted, and the tables survive it intact. A cleared 200,000-entry
map holds roughly **4.8 MB** of tables afterwards — entries 3.2 MB, live
0.2 MB, buckets 1.4 MB — indefinitely.

That is the user's complaint in miniature, inside our own runtime: memory
that does not come back after a burst. The idle shrink is the fix, and
`clear()` queues into it; but the bug should be read as `clear()`'s, not as
a missing feature of the shrink.

## Where the shrink runs, and why that was measured rather than chosen

Counting the sites that cache one of these buffer pointers in a C local
across a call that can reach a move:

| safepoint | `scr_map` | `ScrDyn::obj.entries` | note |
|---|---:|---:|---|
| move-on-grow | 0 | 0 | the **existing** realloc contract, so a nonzero count would be a live bug, not a cost of compaction |
| end of `scr_collect_cycles` | 0 | **9** | a collection can begin inside `scr_cyc_on_release`; 771 of 3,461 runtime functions can reach one |
| between loop turns | 0 | 0 | no C local is live at all |

The tempting place is beside the cycle arena's page return at the end of
`scr_collect_cycles`. Page return survives there only because it touches
**free** pages that no live pointer names; moving a live table is a
different proposition. The shrink runs from `scr_collect_cycles_idle`
instead, and **before that function's pace gate** — the gate returns early
on the cycle-root count, and a burst that leaves sparse maps need not leave
cycle roots, so pacing the shrink there would make "does memory come back"
depend on whether a collection happened to be due.

`iter_depth` is **not** redundant at the idle point. A synchronous
`forEach` cannot span a loop turn, but an async iteration holds it across
precisely the instant this pass runs. Busy maps are skipped, counted
separately and re-queued rather than dropped.

## The measurement plan, registered before the measurement

**One binary, two arms, selected by `SCR_MAP_SHRINK`.** The knob is read at
runtime in the shipping build, so `SCR_MAP_SHRINK=0` versus `=1` is an A/B
on a single executable, through `harness/delivery-ab-knob.sh` with
`CTL_ENV`/`TRT_ENV`. That forecloses the code-layout confound between the
arms the same way the page-return A/B did.

**What that A/B does NOT cover, stated up front.** `ScrMap` grew two
pointers and a flag, so code layout moved *relative to main*. A knob A/B
compares two arms of one binary and cannot see that; only a build-versus-
build comparison could, and that comparison is itself layout-confounded. So
the struct growth is an **unmeasured** delta against main, not a covered
one, and an A/A floor does not adjudicate a header change.

**Reading the counters needs a second, instrumented build.** The report is
behind `SCR_MAP_SHRINK_STAT` (default 0) because that arm references
`atexit`, an ambient symbol the library-mode audit rejects — and zapo-rest
leaves through `_Exit`, which skips `atexit` entirely. So the counter run
is a separate instrumented build chaining the report through the existing
`_Exit` interposer, and it is **not** the binary the memory numbers come
from.

### The falsification criterion, written down before the reading exists

The shrink's benefit depends on maps in the zapo workload actually going
sparse. Three outcomes, and the second and third are answers:

1. **SHRANK, and settled memory falls** — the route works on this workload.
2. **RAN AND NOTHING SHRANK** — maps in this workload do not go sparse.
   That is the result. It is reported as the result, and the route is
   closed for this workload rather than re-run against a workload chosen to
   make it look good.
3. **NEVER RAN** — the pass did not execute. A zero byte delta then says
   nothing about the mechanism, which is the whole reason the report
   separates this case from case 2.

A byte delta on an inert path is the failure shape this instrument exists
to refuse.
