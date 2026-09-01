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

## Memory, page faults, and where the bytes come from

`cpuphase` polls the child every 2 ms for working set, peak working set and
page faults, and reports `GetProcessIoCounters` alongside the CPU columns.
Polling rather than sampling at the phase markers, because both halves of
the memory story are invisible to markers: the floor happens before the
first marker exists, and the compiled lane spikes and *releases* inside a
phase where node's only ever climbs.

`send_1to1`, 200 contacts x 2 devices, 600 messages, same workload both
lanes:

|                | node       | compiled   | ratio |
| -------------- | ---------- | ---------- | ----- |
| page faults    | 16,134     | 328,885    | 20.4x |
| kernel ms      | 578        | 2,734      | 4.7x  |
| user ms        | 4,141      | 2,063      | 0.50x |
| ioOther        | 2          | 4          |       |
| peak RSS       | 171.56 MiB | 76.91 MiB  | 0.45x |
| startup RSS    | 26.20 MiB  | 17.58 MiB  | 0.67x |

**The kernel time is page faults.** `ioOther` of 4 rules out I/O and ioctls,
and the compiled lane's *user* time is half node's in the same phase. The
memory growth and the kernel time are one cause, not two.

Two hypotheses died here, both by measurement:

- **Entropy.** On win32 `arc4random_buf` passes every call straight to
  `SystemFunction036` (`RtlGenRandom`) with no pool -- exactly the shape
  that would explain syscall time. It costs 0.053 us for an 8-byte draw and
  0.058 for 32 bytes: a user-mode fast path. Nine seconds would need ~155
  million calls.
- **Module init.** The idea was that per-module initialisers scattered
  through 22.3 MB of `.text` fault in the image before `main`. RSS reaches
  17.58 MiB and sits **flat for ~550 ms with no further faults** before any
  work, against a ~25.8 MB image, and startup takes 4,042 faults against
  `send_1to1`'s 328,885. The faults are in the workload, not startup.

### Allocation sites

`-DSCR_PROF_ALLOC` (see `tests/perf/prof/scr_prof.h`) needs none of the link
walls that close `-finstrument-functions`, because it interposes the
allocator through the preprocessor and keys on a compile-time `file:line`.
Same workload:

    allocations  1,671,020    frees  1,427,468 (85.4%)
    bytes           110.27 MiB   sites  1,447   lost 0

~2,785 allocations per message, 85% freed again inside the run.

> **This paragraph used to end "and the Windows heap decommits freed blocks,
> so churn re-commits the same pages and pays a fault each time. That is the
> 20.4x fault gap." That explanation is wrong and was refuted twice over --
> see "The arena, built and measured" and "It is `CreateFiber`" below. The
> faults are not the heap at all.**

95% of the bytes are the runtime's own sites, not the emitted program (203
runtime sites, 105.26 MiB; 1,244 program sites, 5.01 MiB):

| bytes      | allocs  | avg   | site                                       |
| ---------- | ------- | ----- | ------------------------------------------ |
| 26,353,760 | 164,711 | 160   | `scr_async.c:1331` fiber, one per async call |
| 12,668,568 | 166,276 | 76    | `scr_cycle.c:150` cycle-collector pool MISS  |
| 9,037,888  | 141,217 | 64    | `scr_array.c:179` array header               |
| 8,883,078  | 92,691  | 95    | `scr_bytes.c:52` bytes payload               |
| 7,149,056  | 55,852  | 128   | `scr_map.c:249` map object                   |
| 6,828,544  | 50,272  | 135   | `scr_map.c:164` map storage                  |
| 6,429,120  | 5,430   | 1,184 | `scr_cipher_value.c:90` ScrCipher            |
| 4,802,752  | 139,328 | 34    | `scr_array.c:172` array data                 |
| 3,707,640  | 92,691  | 40    | `scr_bytes.c:43` bytes header                |
| 3,328,960  | 103,528 | 32    | `scr_async.c:1388` promise waiters realloc   |

Two sites are half the problem and both are structural. `scr_async_spawn`
callocs a fiber per async **call** -- and it eagerly runs the body to its
first suspension, so a body that never suspends still allocated a fiber to
run in. And `scr_cyc_alloc_miss` is by its own name the path taken when the
collector's pool has nothing to hand back; 166,276 misses in one phase is a
pool that is not sized for this workload.

This lane ranks **churn**. Residency is a different list and needs the
`-DSCR_PROF_LIVE` add-on, which charges a free back to the allocating site.

### CPU per function (compiled lane, shipping-shaped binary)

`tests/perf/sampler` profiles by suspend-and-sample, so it needs none of the
link-time walls that close `-finstrument-functions` for a program this size.
Four things it had to learn, each found by measurement:

1. **Idle threads outvote the work.** A first cut put 99% of hits in ntdll's
   wait stubs. Sampling is gated on each thread's own cycle delta.
2. **A thread in a syscall parks its user RIP on an ntdll stub**, so the
   sampler walks to the first frame inside the program image.
3. **The "program image" test must be the executable sections, not the
   module.** A module-wide test accepted an address in `.rdata` as a frame
   and reported a confident **97%** for a symbol that cannot execute.
   Restricting to `IMAGE_SCN_MEM_EXECUTE` sections dissolved it entirely.
4. **The PE carries no debug directory and no DWARF** (`rva=0 size=0`, and
   `nm` reports no symbols), so DbgHelp can never symbolise the live process
   however the search path is set. The `.pdb` beside the binary is a valid
   MSF 7.00 file, so symbolisation is done offline: load the **`.pdb`
   itself** as the module image at a synthetic base and resolve each sample
   by RVA.

`send_1to1`, 400 contacts x 2 devices, 1200 messages, program-code samples
with `+0x...` variants merged into their base function:

| self%  | function                   |
| ------ | -------------------------- |
| 21.05% | `crypto_x25519_dirty_fast` |
| 14.74% | `ge_scalarmult_base`       |
| 7.37%  | `crypto_eddsa_key_pair`    |
| 5.26%  | `g_rounds`                 |
| 3.16%  | `scr_clear_immediate`      |
| 3.16%  | `scr_str_cp_at`            |

**51.6% of program-code samples are crypto**, which agrees with node's
control for the same phase (`createPrivateKey` 59.73%, `feMul` 25.41%). The
two lanes are doing the same work in the same proportions -- and the
compiled lane does it in **half** node's user time. Nothing in the user-mode
profile explains the gap, which is the same conclusion the fault counters
reached from the other direction.

Caveat worth keeping: only ~95 of ~1,355 samples land in program code,
because the busiest-thread heuristic still frequently picks a thread parked
in a syscall. The ranking is stable across runs and the dropped samples are
uniformly non-program, but the absolute percentages are thin.

#### A fifth way the sampler lies, caught by cross-checking

Run against the **uninstrumented** binary the yield is far better (1,583 of
1,895 samples reach program code, against 95 of 1,355 for the instrumented
one) -- and the table is then dominated by a single name:

    93.81%  scr_win_run_sync
     1.58%  crypto_x25519_dirty_fast
     1.45%  ge_scalarmult_base

`scr_win_run_sync` is `scr_child.c`'s synchronous child-process core. The
bench supervises the fake server through it for the whole run, and its pump
polls at about 1 kHz (`WaitForSingleObject(proc, progress ? 0 : 1)` then
`Sleep(1)`). A 94% headline for a polling loop is exactly the shape of a
real finding, and it is not one.

**It is refuted by a number already in this file.** If that pump were
burning a core, `buildContacts` -- which is 97% RPC wait -- could not
measure **20.5% CPU**. It does. So the pump is cheap, and the 93.81% is a
**thread-selection artifact**: the busiest-thread heuristic picks the thread
with the largest cycle delta each round, and a thread that wakes 1,000 times
a second is selected far more often than the one thread actually computing.

The heuristic needs replacing with cycle-delta *weighting* rather than
argmax before these absolute percentages mean anything. Until then the
instrumented-binary table above is the better ranking -- its yield is worse
but its selection is not biased toward frequently-waking threads -- and the
agreement between its crypto share (51.6%) and node's control (59.73% +
25.41%) is the reason to trust it. The sampler is also process-wide, not
phase-scoped; it does not read the phase markers `cpuphase` uses.

## Every number above was taken on `send_1to1` only

Stated plainly because it was not before: the memory table is `send_1to1` at
**200 contacts x 2 devices, 600 messages**, and the first CPU table is
`send_1to1` at **400 x 2, 1200 messages** -- both *reduced* against the
bench's full **1000 x 2, 1000 messages, 4 groups x 500 members**. Allocation
counts scale and rankings hold, but the user's 20 MB target is against the
full workload, so a reduced number must never be compared to a full-workload
one from another file. The sampler was also **process-wide**, so those
percentages were the whole run's and not the phase's.

Both are now fixed: the sampler reads the same `[phase-begin]`/`[phase-end]`
markers `cpuphase` emits, and weights each sample by its thread's cycle
delta instead of picking one busiest thread.

### Three compute phases, full workload, shipping binary

`send_1to1`, `send_group` and `recv_group`, 1000 x 2, 1000 messages,
4 groups x 500 members. **The three are not the same profile, which is
exactly why one table could not stand for all three:**

| phase        | dominant self-time                                            |
| ------------ | ------------------------------------------------------------- |
| `send_1to1`  | `ge_scalarmult_base` 17.6%, `crypto_x25519_dirty_fast` 16.0%, `g_rounds` 12.4%, `crypto_eddsa_key_pair` 5.9% -- ~52% crypto |
| `send_group` | `scr_arr_slice` **21.0%**, `scr_arr_join` 7.3%, `add_and_denorm128` 7.0%, `feMul` 5.8% -- array work, *not* crypto |
| `recv_group` | `scr_win_run_sync` 66.9%, then `scr_jb_put_json_str` 8.9%, `scr_string_to_number` 6.9% -- JSON and string->number |

`send_1to1`'s ~52% crypto reproduces the 51.6% measured independently on the
instrumented binary, which is the cross-check that the phase-scoped numbers
are sound. **`send_group` and `recv_group` had never been attributed at all**
and neither is crypto-bound.

`scr_win_run_sync` at 66.9% in `recv_group` is the same child-supervision
pump refuted above, and it is **not** claimed as a cost here: it survived
cycle-weighting, which the earlier artifact did not, but it has not been
independently confirmed and the earlier refutation stands until it is.

### Residency: peak versus steady state (the `live` lane)

`-DSCR_PROF_LIVE`, all three phases, **full workload**:

    allocations 15,091,036   bytes 1.65 GiB   freed 94.5%
    live heap PEAK  77.11 MiB      live heap AT EXIT  38.63 MiB
    peak RSS 224.40 MiB (includes the profiler's own 53 MiB table)
    ptrLost 0   freeUnknown 0

**The residency ranking is the reverse of the churn ranking**, as the lane's
own header predicted:

| peak bytes | exit bytes | site                                  |
| ---------- | ---------- | ------------------------------------- |
| 34,832,200 | 16,799,672 | `scr_string.c:128` string allocation  |
| 23,777,200 | 20,781,408 | `scr_cycle.c:150` cycle-collected obj |
| 8,720,992  | 0          | `scr_array.c:172` array data          |
| 2,499,560  | 8,204      | `scr_bytes.c:52` bytes payload        |
| 1,567,520  | 0          | `scr_async.c:1331` **the fiber**      |

**This reorders the work.** The fiber is **#1 by churn** (164,711 allocs,
26.35 MiB ever allocated) and **holds 1.57 MiB at peak and zero at exit** --
so removing it cuts allocations and page faults but takes almost nothing off
peak RSS. Peak is set by **strings (34.8 MiB) and cycle-collected objects
(23.8 MiB), together 76% of the live peak**; retention at exit is those same
two at 97%. Runtime sites hold **99.3%** of the peak.

Two smaller retainers never shrink: `scr_cycle.c:330` (roots buffer) and
`scr_cycle.c:414` (white list) both `realloc` by doubling and hold 0.5 MiB
and 1.0 MiB at exit having never been given back.

**And the gap the arena is aimed at is now a number.** Live heap peaks at
77.11 MiB while peak RSS is 224.40 MiB; subtracting the profiler's own
53 MiB table leaves roughly 171 MiB of RSS behind 77 MiB of live heap. The
remainder is image, stacks, and allocator slack that the churn re-commits --
which is the same 28.7x page-in ratio seen from the other side.

## The arena, built and measured: it does almost nothing

The standing explanation for the compiled lane's 328,885 page faults was
churn against a heap that decommits. A private, non-decommitting allocator
was built to test it -- `tests/perf/prof/scr_arena.h`, size-class slabs over
one `VirtualAlloc` reservation, injected through `SCRIPTC_PROF_CFLAGS` the
same way `scr_prof.h` is, so nothing in `packages/` changes.

Interleaved in one session, plain and arena alternating, plain re-run last
as the drift control. `send_1to1`, **200 contacts x 2 devices, 600 messages**,
`ZAPO_BENCH_SCENARIOS=send_1to1`; both binaries built from the same tree by
the same script, differing only in the `-include`.

| arm | `send_1to1` faults | peak RSS | rssEnd | kernel ms |
| --- | --- | --- | --- | --- |
| plain r1 | 329,111 | 76.48 MiB | 58.33 | 4,828 |
| arena r1 | 327,076 | 75.44 MiB | 60.61 | 4,844 |
| plain r2 | 328,918 | 76.13 MiB | 59.88 | 5,016 |
| arena r2 | 327,209 | 75.46 MiB | 60.22 | 5,094 |
| plain r9 (last) | 328,896 | 75.80 MiB | 59.96 | 4,547 |

Faults **-0.6%**. Peak RSS -1.2%. Kernel time unchanged.

**It is not a plumbing failure.** The arena's own exit counters:

    chunks=364  committedBytes=23,855,104  small=1,666,962  large=149
    freed=1,452,023  foreign=165  livePeakBytes=20,577,200

1,666,962 allocations captured, against the 1,671,020 the `-DSCR_PROF_ALLOC`
census counted for this same workload. Only 149 exceeded 4096 bytes; only
165 frees were foreign pointers. It caught everything -- and **the whole
heap's live peak in this phase is 19.62 MiB**, which cannot be what 329,111
faults are about.

Two observations finish the heap explanation off:

1. **RSS still falls inside the phase with the arena in**, 75.44 to 60.61
   MiB. The arena never returns a page, and only 149 allocations went to the
   CRT, so what is being released is neither.
2. **The faults arrive with a flat working set.** `cpuphase` now takes
   `SCR_CPUPHASE_TRACE=<ms>` and dumps the whole run instead of the first
   1.5 s. Through the middle of `send_1to1`:

   ```
   ms     rssMiB  faultsTot  faultsInStep  rssDeltaKiB
   6095    65.70    174,928     13,783          -80
   6500    66.28    188,585     13,657           36
   6907    66.59    202,223     13,638          108
   7313    67.31    215,553     13,330          232
   7725    67.80    228,413     12,860           80
   ```

   ~13,500 faults every 400 ms -- 34,000 a second, 132 MiB/s of page-ins --
   while the working set moves by tens of kilobytes. Pages the process
   already had are being faulted in again. No allocator does that.

A microbenchmark had reproduced the fault count beforehand
(`dynimp-lab/arena/churn.c`, the measured size distribution replayed against
both allocators) and it reproduced it *for the wrong reason*: steady churn
through the CRT costs 26,887 faults for 1.65 GiB, one per resident page,
while releasing in bulk costs 482,807. That is a true property of the CRT
heap and it is not this program's problem. **Matching a number is not
identifying a cause** -- the second time in this file a model has matched a
number and been wrong, after the 15.625 ms tick.

## It is `CreateFiber`. One per async call. Matched to 0.1%

`scr_async.c`, `scr_async_spawn`, the win32 arm: `CreateFiber(SCR_FIBER_STACK
= 262144, ...)` once per async **call**, `DeleteFiber` on completion --
164,711 pairs in this phase. **`CreateFiber`'s first parameter is the initial
*committed* stack size**, not a reserve and not lazy. The comment three lines
above it said the opposite ("the reserve stays the default 1MB. Committed
lazily by the OS"), which is why the site was read as a 160-byte `calloc`.

Standalone, no zapo, no sockets, no crypto, no allocation
(`dynimp-lab/arena/fiberfault.c`, `fiberpool.c`), 164,711 iterations each
touching two stack pages the way a real async frame would:

| arm | faults | kernel ms | elapsed |
| --- | --- | --- | --- |
| `CreateFiber(262144)` + `DeleteFiber`, per call | 329,445 | 3,766 | 4.00 s |
| `CreateFiberEx(4096 commit, 1 MiB reserve)` | 329,445 | 1,812 | 2.09 s |
| pooled, 8 reusable fibers | **34** | 16 | **0.025 s** |
| pooled, 64 | 174 | 0 | 0.026 s |
| pooled, 256 | 628 | 0 | 0.034 s |
| `CreateFiber` arm re-run **last** (control) | 329,445 | 3,766 | 4.12 s |

**329,445 against the bench's 329,111.** The compiled lane's entire
page-fault bill, reproduced from the fiber count alone.

- The **faults** are the two demand-zero pages each fresh stack touches.
  Shrinking the commit does not remove them; only reusing stacks does.
- The **commit size is half the kernel time**: 256 KiB to 4 KiB takes 3,766
  ms to 1,812 ms for the same faults, with no semantic change.
- **Reusing the stack removes both**: 34 faults and 0.025 s for the same
  164,711 switches. A pool of 8 suffices. The pool's cost is *commit* --
  256 KiB per fiber, so 256 fibers charge 68.97 MiB -- so it must be bounded
  or the commit shrunk, and the two fixes compose.

**This does not move peak RSS.** The residency table already had the fiber at
1.57 MiB at peak and zero at exit. It is a page-fault and kernel-time fix and
is reported as one.

## Is ~20 MB peak RSS reachable for this workload? No, and here is the floor

Stated plainly because the target deserves a number rather than an attempt.
Every figure below is the **compiled** lane on the real zapo bench.

| term | measured | where |
| --- | --- | --- |
| startup RSS floor, before any work | **17.56 MiB** | flat for >1.4 s, 3,864 faults, against a ~25.8 MB image |
| live heap peak, `send_1to1` 200x2/600 | 19.62 MiB | the arena's own counter |
| live heap peak, full workload, all phases | **77.11 MiB** | `-DSCR_PROF_LIVE` |
| peak RSS, `send_1to1` 200x2/600 | 75.8-76.5 MiB | this file, five runs |
| peak RSS, full workload | 121.88 MiB | earlier run, same instrument |

The floor alone is **17.56 MiB, 88% of a 20 MB budget, before the program
does anything**, and the full workload's live heap adds 77.11 MiB on top of
it. An allocator cannot close that: the arena moved peak RSS by 1.2%, and it
is a *better* allocator than the CRT on this shape (12.2% slack against the
CRT's larger figure), so allocator slack is not where the bytes are.

Reaching 20 MB would need **both** halves attacked at the source:

- **the image floor**, 17.56 MiB resident of a ~25.8 MB binary. That is a
  binary-size question, not a memory-management one.
- **the live set**, of which strings (34.83 MiB at peak) and
  cycle-collected objects (23.77 MiB) are 76%. Both are *payload*, not
  representation: `ScrStr` is a 12-byte header plus a NUL over UTF-8, which
  is 1.2% on the 1102-byte mean this workload allocates. Whether the
  workload needs those bytes is a question about content, and the census
  that would answer it (`SCR_STRCEN_ON` -> `scr_str_census_walk.h`) is
  referenced by `scr_string.c` and **does not exist in this tree**.

A realistic ceiling for allocator and fiber work alone is peak RSS roughly
where it already is, with the *kernel time* cut by most of the fiber's
3.8 s. The 20 MB number is not reachable without shrinking the image or the
live set, and nothing measured here shrinks either.

### Why the two biggest residency sites are both pool misses

`SCR_POOL_MAX` is **256 bytes** (`scr_runtime.h`). `scr_pool_take` returns
NULL above it, so every string and every cycle-collected object over 256
bytes physical misses the pool **by construction, on every call**. That is
exactly what `scr_string.c:128` and `scr_cycle.c:150` are -- the miss arms --
and the mean allocation at `scr_string.c:128` is 1102 bytes, four times the
ceiling. It is not a pool sizing problem for those; the pool cannot serve
them at all.

### The churn ranking over the full workload, which no earlier table showed

Earlier allocation tables were `send_1to1` at 200x2/600. Over the **full**
workload and all three phases the ranking by count is led by a site absent
from them:

| allocs | bytes | avg | site |
| --- | --- | --- | --- |
| 5,365,508 | 277,694,836 | 52 | `scr_bigint.c:39` |
| 722,747 | 28,909,880 | 40 | `scr_bytes.c:384` |
| 643,787 | 103,005,920 | 160 | `scr_async.c:1331` the fiber |
| 622,021 x3 | 13,522,400 x3 | 22 | `scr_bigint.c:528/529/530` |
| 587,423 | 647,291,520 | 1102 | `scr_string.c:128` |

`scr_bigint.c:39` alone is **35.6% of all 15,091,036 allocations**; with
`:528/:529/:530` the bigint file is **47.9%** of every allocation the
workload makes. Those three lines are `scr_big_bitop`'s three temporary limb
arrays, all dead before it returns, at a mean of 22 bytes -- a 16-limb stack
array covers them. And `scr_string.c:128` is 36.6% of all bytes ever
allocated as well as being #1 by residency; it leads both lists, which no
earlier table could show because churn and residency were measured on
different workloads.

`scr_bigint.c`'s own header says "bigint here serves key material and modular
reduction -- hundreds of ops per handshake, not a hot loop". It is 5.4 million
calls here. That premise should be re-checked before "binary long division,
not Knuth D" is accepted on the same authority.

### Sizing the monocypher lead

Measured on the shipping toolchain against the vendored monocypher, 2000 ops
each, **on a host running 16 concurrent compiler processes** -- upper bounds,
to be re-taken quiet:

    crypto_x25519             95.2 us/op        crypto_eddsa_key_pair  42.4 us/op
    crypto_x25519_public_key  94.6 us/op        crypto_eddsa_sign      47.3 us/op
    crypto_blake2b (64 B)      0.163 us/op

What fraction of `send_1to1` is *field multiplication* cannot be read
directly: `fe_mul` has 86 call sites in `monocypher.c` and is inlined at all
of them, which the sampler confirms from the other side -- its table has
`ge_scalarmult_base` and `crypto_x25519_dirty_fast` with `+0x...` offsets and
no `fe_mul` symbol at all. **Derived**, and labelled as derived: the two
scalar-multiplication symbols are 33.6% of `send_1to1`'s program-code
self-time, and Curve25519 scalar multiplication is ~85-90% `fe_mul`/`fe_sq`,
so field arithmetic is on the order of **29% of `send_1to1`** -- one phase of
six. `g_rounds` (12.4%) is Blake2b and is *not* field arithmetic, so the 52%
"crypto" rollup must not be read as 52% field work.
