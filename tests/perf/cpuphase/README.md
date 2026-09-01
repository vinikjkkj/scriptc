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

~2,785 allocations per message, 85% freed again inside the run. The runtime
allocates through the mingw CRT `malloc` -- no `VirtualAlloc`, `HeapCreate`
or private pool anywhere in `packages/runtime/src` -- and the Windows heap
decommits freed blocks, so churn re-commits the same pages and pays a fault
each time. That is the 20.4x fault gap.

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
