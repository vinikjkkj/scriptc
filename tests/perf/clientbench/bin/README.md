# `bin/` — the external sampler, built not vendored

`cpuphase.exe` is built from **`tests/perf/cpuphase/cpuphase.c`**, which is the
canonical copy and stays the only one. An earlier revision of this directory
vendored a second copy; two copies of an instrument drift, and a bench whose
sampler quietly differs from the one its README cites is worse than no bench.

Build it (with `harness/env.sh` sourced, so `zig` is the tree's 0.16.0 and not
Chocolatey's 0.15.2):

    zig cc -O2 -o bin/cpuphase.exe ../cpuphase/cpuphase.c -lpsapi

`harness/bench.sh` requires `bin/cpuphase.exe` to exist and refuses to run
without it, rather than silently measuring nothing.

## What it gives, and why an external sampler at all

`process.cpuUsage()` has no scriptc lowering and `process.memoryUsage()`'s four
V8-heap fields are refused by name, so the compiled lane cannot report its own
CPU or heap — the bench prints `n/a` for those columns on purpose. A parent
reading the child's kernel counters is the only instrument the compiled lane
and the node lane can **share**:

* `QueryProcessCycleTime` — cycles, exact to the context switch. The headline.
* `GetProcessTimes` — the user/kernel split. Tick-quantised at 15.625 ms, so
  useless for small deltas, but it is the only thing that separates "spinning"
  from "blocked" on a socket-bound workload, and over phases of seconds the
  quantum is 0.03–0.4%.
* `PeakWorkingSetSize` — peak RSS.

It echoes the child's stdout byte-for-byte, so the bench's JSON still parses
and the two lanes stay diffable.

Verified on a positive control before use: a child spinning for 700 ms read
700 ms wall, 96.0% CPU and 2,502 Mcycles, and a child allocating 3M objects
read a 343.60 MiB peak against a 30.42 MiB start.
