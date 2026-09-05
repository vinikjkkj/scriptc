# The arming probe for the fiber gauges and the phase hook

`fanoutprobe.ts` is **not a bench**. It exists so that three instruments can
each tell "found none" from "there are none" before any of them is pointed at
the real workload:

* `tests/perf/fiberstat/scr_fiber_stat.h` — the probe holds exactly
  `CONC` concurrent chains three async frames deep, so `outHi` has an
  arithmetic expected value (`CONC * 3 + 1`) rather than "some large number".
* `scr_memmap.h`'s phase hook — the probe prints `[phase-begin] warm`,
  `[phase-begin] burst` and `[phase-begin] after`; asking for only two of
  the three must produce exactly two pairs of snapshot files, so the filter
  is checked in both directions.
* the pair of walks — the `burst.begin` snapshot and the peak snapshot must
  describe different instants, which is the whole premise of subtracting
  them.

Run it as:

    SCRIPTC_PROF_CFLAGS="-DSCR_MEMMAP \
      -include <repo>/tests/perf/fiberstat/scr_fiber_stat.h \
      -include <repo>/tests/perf/memmap/scr_memmap.h"
    scriptc build tests/perf/fanout/fanoutprobe.ts --out probe.exe

    SCR_MEMMAP_OUT=...\mm.txt SCR_MEMMAP_PHASES=burst,warm \
    SCR_MEMMAP_SELFTEST=32 SCR_FIBERSTAT_OUT=...\fst.txt probe.exe

Measured on x86_64-windows-gnu, zig 0.16.0, `CONC=3000`:

    [fiberstat] out=0 outHi=9001 pool=0 poolHi=4096 fresh=9001 freed=9001
    SELFTEST PASS privateDelta=33554432 want=33554432 heapBusyDelta=8388968

`outHi` is `3000 * 3 + 1` exactly — the three async frames plus `main` —
and `poolHi` is `SCR_FIBER_POOL` exactly. A build where either reads
something else is a broken gauge, not a surprising program.
