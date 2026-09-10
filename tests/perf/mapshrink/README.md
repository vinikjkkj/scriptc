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
| D, **link shape** | `scr_cycle.c` must not depend on `scr_map.c`. Reads the linker's answer, and proves its own detector by flagging a deliberate hard edge |

Arm C exists because a suite that only ever prints `ok` has not been shown
able to print `FAIL`.

## Arm D, and the gap that put it there

The first version of this change called `scr_map_idle_shrink()` **by name**
from `scr_collect_cycles_idle`. That is an undefined symbol in every TU
that links `scr_cycle.c` without `scr_map.c` -- and three of the runtime's
own unit tests do exactly that (`intern`, `number`, `tonumber`). Five gate
builds went red, every one of them `Command failed: zig cc` rather than an
assertion, on a dependency edge that had never existed before.

**Arms A to C could not have caught it.** They build one file with one
`zig cc` and never touch a link line, so they stayed green while the gate
went red. That is the gap arm D closes, and it is checked the only way a
link problem can be: by asking the linker.

The collector now owns `scr_cyc_idle_hook` and calls through it. `scr_map.c`
installs itself at the moment the **first map becomes a shrink candidate**,
not from a constructor -- which removes the init-order question entirely,
since before that instant there is nothing to shrink and NULL is not merely
safe there but correct. Same shape as the pagecensus walk hook.

Verified against the actual pre-fix file rather than only a synthetic one:
the old `scr_cycle.c`, compiled and linked alone, still reports `undefined
symbol: scr_map_idle_shrink` -- so arm D would have caught the regression
that caused it. It is also why nothing in this directory may be named
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

## THE RESULT, 2026-09-10: outcome 1 fired, and the route still closes

One instrumented run of `app182` on the documented dials
(`CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1 IDLE_S=60`), clean exit,
2,712 report lines:

```
SHRANK -- passes=3 visited=10 shrunk=10 bytes=299840
          (entries=193536 live=12096 buckets=94208)
          queued=10 requeued=43280 unlinked=0
          skip_iter=0 skip_small=0 skip_dense=0 failed=0
```

**The mechanism is correct on real traffic**: ten maps went sparse, ten
shrank, no failures and no skips. That is outcome 1 above.

**And the route is closed anyway, for two reasons that outrank the state.**

**It is below the floor.** 299,840 bytes is 0.286 MiB. Against the 1.8.2
shipping A/B's settled private WS base of 83.57 MiB that is **0.342%**, and
the within-mode floor is **0.75% = 657,221 bytes**. The effect is **0.46x the
floor** -- less than half the smallest thing the rig can resolve -- so a
12-repetition A/B would return DRAW by construction. It was not run, and
that decision is the reading, not an omission.

**And the timing is the stronger finding.** All 2,712 report lines are
IDENTICAL: every shrink had completed before the first report at turn 25,
and across roughly 67,800 further idle turns -- including the entire
60-second idle hold -- nothing shrank again. The maps go sparse in the first
milliseconds, during startup. **So this mechanism acts during the burst and
is silent on the settled plateau, which is the exact column the user reads.**
It is structurally not touching the retention the complaint is about, and
that closes the route more firmly than the small number does.

**293 KiB is also an upper bound rather than a delivery.** Freeing to the CRT
heap is not returning to the working set: the contiguity control in
`../placement/README.md` measured the heap giving back 72.09 MiB when garbage
was contiguous and 3.39 MiB when the same garbage was scattered. Ten small
scattered `realloc` shrinks are the second case.

### What stands

`scr_map_clear` freeing nothing was a **real retention defect** and it is
fixed. The fix is correct, costs nothing measurable (43,280 queue checks on
the delete path, one load and one branch each, and `skip_*` all zero), and is
covered by five self-test arms. **It is simply not where the user's retention
lives.** The map route is closed as a material contributor **for this
workload**, and no other workload was sought -- a number found by hunting for
a workload that flatters it would not be a measurement.

### The gap in the criterion above, recorded rather than quietly fixed

The criterion said outcome 1 meant "the route works here" and prescribed
running the A/B. That prescription was wrong: it was written in terms of
**state** (did anything shrink) and not **magnitude** (is it above the
floor), so it could not distinguish *it works* from *it works and matters*.
The gap was found by trying to obey it. A registered criterion should name
the floor it will be read against, not just the outcomes.
