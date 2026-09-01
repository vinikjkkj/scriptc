# Where the zapo messaging bench's time actually goes

Measured 2026-09-01 against **the real zapo bench** (a copy of
`bench-client5` under `msgbench-lab`), **not** `tests/perf/bench/messaging.bench.ts`,
which is a synthetic shape-alike whose scenario names are deliberately
identical — its own line 5 says so. Any table headed `SEND group` must say
which of the two produced it.

## The protobuf hypothesis is dead. Please stop resurrecting it.

It was carried for days and put in three briefs: zapo's protobuf bundle is
1,867,556 bytes of minified JS becoming 15,725,523 bytes of C, 61.72% of
the program, compiled through the dyn path, and every message encode goes
through it — so it must be where the time goes.

It is not, in either phase where it could have been:

| phase | protobuf | what actually dominates |
|---|---|---|
| `send_group` | **1.85%** | curve25519 / field arithmetic **44.18%** |
| `send_1to1`  | **0.37%** | node:crypto KeyObject / DH **81.78%** |

Shares of **non-idle** samples, node lane, `--cpu-prof`, with setup shrunk
so the phase under test is >99% of the profile. Top rows:

```
send_group                          send_1to1
 25.41%  feMul       math/fe.ts      59.73%  createPrivateKey  crypto/keys
  5.61%  scalarMultBase edwards.ts   13.15%  createPublicKey   crypto/keys
  4.62%  doublePointInto             4.96%  diffieHellman
  4.28%  hkdfSync                    2.63%  hkdfSync
```

Being 61.72% of the *program text* is not being 61.72% of the *run*. The
two phases are X25519 and Curve25519 key agreement reached by two different
routes — `send_1to1` through node:crypto KeyObjects, `send_group` through
zapo's own TypeScript field arithmetic.

Reproduce: `node tests/perf/cpuphase/cpuprof-top.mjs <file.cpuprofile>`.

## CPU per phase, both lanes, same instrument

`process.cpuUsage()` is refused in a compiled binary, so the bench printed
`CPU time 0.00 ms` and `heap delta 0.00 MiB` for every scenario on both
lanes — columns asserting numbers they could not know. `cpuphase.c` fixes
that from outside: it pipes the child's stdout, echoes it byte-for-byte,
and samples the child's kernel counters on the `[phase-begin]` /
`[phase-end]` markers the bench prints.

    cpuphase.exe -- <cmd> [args...]

`QueryProcessCycleTime` is the headline. `GetProcessTimes` is kept only for
the user/kernel split the cycle counter cannot give; its 15.625 ms quantum
is 0.03–0.4% over phases of seconds, unusable per call but reportable here.

Interleaved, 3 reps, medians, full-size bench:

```
phase          lane      wall_s  Mcycles  user_s  kern_s  cpu_s   cpu%
buildContacts  node        7.42     4226    0.77    0.34   1.05  19.4%
               compiled   22.64     7383    1.39    0.67   2.03   9.1%
buildGroups    node        7.10     4912    0.62    0.42   1.11  15.6%
               compiled   60.64     7626    0.94    1.17   2.08   3.4%
send_1to1      node       14.88    54930   14.58    0.98  15.62 104.2%
               compiled   18.64    61144    6.19   10.86  17.08  91.6%
recv_1to1      node       12.38    27334    7.27    0.38   7.67  62.2%
               compiled   11.13    26263    2.69    4.31   7.33  65.8%
send_group     node       17.44    63068   16.28    0.98  17.27 100.1%
               compiled   28.77    94364   18.16    7.61  26.23  91.2%
recv_group     node        2.42     5357    1.09    0.36   1.45  62.8%
               compiled    9.99    33003    6.83    2.41   9.23  92.4%
```

Contention control — the node arm re-run **last**: buildGroups 5.44→5.99 s,
send_group 15.85→15.30 s. Within ~10%.

**The split is the finding.** `buildGroups` compiled is 3.4% CPU over 60.6 s
— blocked, not computing (see `tests/perf/looplatency` for the cause). And
in `send_1to1` the compiled lane uses **2.4× less user time than node** and
still loses, because it pays **11× more kernel time**: 10.86 s against
0.98. The extra cost is syscalls, not compute.

`heap delta` is genuinely unobtainable — there is no V8 heap in a compiled
binary. Both benches now print `n/a` with the reason rather than `0.00`.

## Why there is no compiled-lane function table

`exe-profile`'s `--cputime` lane cannot link a program this size. Three
independent walls, all measured:

1. `lld-link: duplicate symbol .weak.__cyg_profile_func_enter…` — every TU
   that gets `-include scr_prof.h` defines the hooks, which must carry an
   external name. `scr_prof.h`'s own header predicts exactly this: *"the
   CPU lanes therefore still cannot link a program with this many
   translation units."*
2. `-Wl,--allow-multiple-definition` → zig cc: *"unsupported linker arg"*.
3. `__attribute__((selectany))` on the hooks → clang: *"can only be applied
   to data items with external linkage"*.

And it would not have shown the cost anyway: the compiled lane's user-space
compute is already faster than node's, so a user-space profiler is looking
in the wrong half of the process. callgrind on a linux cross build is the
remaining route, and it is declined twice over — WSL Arch has no linux
node, so the fake server is unreachable from inside it, and valgrind
answers CPUID SHA=0, taking the scalar fallback for exactly the crypto
these two phases are made of.
