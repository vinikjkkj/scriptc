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

Interleaved, 3 reps, medians, full-size bench. **Re-measured 2026-09-01
with the `scr_async.c` idle-sleep fix in**, as three arms in ONE session —
node, the PRE-fix binary and the POST-fix binary — because comparing a
fresh run against a table measured on a different machine state is not a
comparison. Both binaries content-verified: PRE has no
`CreateWaitableTimerExW` import, POST has it.

Ratios are **paired within each rep** (the three arms run back to back), so
session drift cancels — the control measured that drift at 1.10-1.51x, and
POST runs last in every rep, so residual bias is *against* POST.

```
phase           pre/node              post/node             post/pre (the fix)
buildContacts   4.35x [3.62-5.78]     1.65x [1.29-1.83]     0.36x [0.32-0.38]
buildGroups    12.06x [10.95-16.06]   1.97x [1.64-2.48]     0.15x [0.15-0.16]
send_1to1       1.35x [1.26-1.38]     1.34x [1.19-1.79]     0.99x [0.95-1.30]
recv_1to1       0.90x [0.85-0.93]     0.83x [0.83-1.39]     0.93x [0.89-1.62]
send_group      1.60x [1.53-1.64]     1.46x [1.40-1.83]     0.95x [0.85-1.14]
recv_group      4.05x [3.57-4.17]     3.90x [3.47-5.25]     0.97x [0.96-1.26]
```

**The fix does what the micro-benchmark said and nothing more.** The two
sequential-RPC phases collapse — buildGroups 61.8 s to 9.6 s, buildContacts
21.3 s to 7.5 s — and every other row is unchanged inside its spread.

**Two things that were predicted and did not happen, which matter more than
the wins:**

1. **`recv_group` did not collapse** (4.05x -> 3.90x) even though it has
   ~251 sequential round trips. It was never wait-dominated: its CPU is
   **97.3%**, against buildGroups' 3.2%. Ordering the rows by RPC sequential
   depth predicted this one wrong — depth only matters when the phase is
   actually blocked, and this one is compute-bound.
2. **`send_1to1`'s kernel time did not fall.** Per rep, seconds:

   ```
           node    pre    post
   rep1    0.83    8.58   8.66
   rep2    1.47    9.22  10.44
   rep3    0.61    9.36   9.06
   ```

   Still ~10x node's. **The syscall cost is NOT the loop-turn sleep** — it
   survives the fix untouched, and it is the largest remaining compiled-lane
   cost in a compute-bound phase. That is the next thing to attribute.

What the fix *did* move, on the other column asked for: **`buildGroups` CPU
climbed off 3.2% to 13.7-18.8%** while its CPU time stayed at ~1.3-1.9 s and
its wall fell 6.5x. It is no longer blocked; it now spends its ~1.6 s of work
in 9.6 s instead of 61.8 s.

The pre-fix absolute table (measured 2026-08-31, before the fix) is kept in
`dynimp-lab/FINDINGS.txt` section 11.

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
