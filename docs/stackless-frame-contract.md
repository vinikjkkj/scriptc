# The stackless frame contract

What the runtime provides, and what emitted code owes it. Written so the
codegen side can be built without asking the runtime side anything.

Runtime: `packages/runtime/src/scr_coro.{h,c}`, plus a support block in
`scr_async.c` (search `stackless coroutine support`).
Proof the RUNTIME behaves like a fiber: `tests/perf/corostate/` (`run.sh`).
That rig links `scr_coro.c` directly and never invokes the compiler, so it
says nothing about either lowering — see section 6.

---

## 1. The emitted shape

A stackless async function emits three things, one for one with the fiber
path in `emit-async.ts` — an argpack becomes the frame, a trampoline becomes
the resume function, and the spawn wrapper stays a spawn wrapper.

```c
/* 1. the frame: ScrCoroBase FIRST, then params, then live state */
typedef struct {
  ScrCoroBase base;
  double  a;              /* params, exactly the argpack fields */
  ScrStr *b;
  double  acc;            /* locals live across SOME suspension */
  size_t  i;
  ScrPromise *awaited;    /* the operand currently being awaited */
} Frame_f;

/* 2. the resume function */
static void resume_f(ScrCoroBase *bp) {
  Frame_f *f = (Frame_f *)bp;
  switch (f->base.state) {
    case 0: goto S_entry;
    case 1: goto S_after_1;
    default: abort();
  }
S_entry:
  ...
  f->awaited = scr_async_g(f->a);     /* may be a fiber function: fine */
  f->base.state = 1;
  scr_coro_park(&f->base, f->awaited);
  return;                             /* MANDATORY, see 3.2 */
S_after_1:
  f->acc = scr_coro_take_f64(&f->base, f->awaited);
  scr_promise_release(f->awaited);
  f->awaited = NULL;
  if (scr_exc_pending()) return;      /* the await rejected; see 3.5 */
  ...
  scr_coro_finish_f64(&f->base, f->acc);
}

/* 3. the spawn wrapper -- SAME SIGNATURE as the fiber one */
ScrPromise *scr_async_f(double a, ScrStr *b) {
  Frame_f *f = scr_coro_alloc(sizeof *f, &resume_f, /*has_exc=*/false);
  f->a = a;
  f->b = b;
  return scr_coro_spawn(&f->base);
}
```

**The wrapper signature is the whole hybrid story.** A caller only ever calls
the wrapper and receives a `ScrPromise *`. It cannot tell a stackless callee
from a fiber one, so the two mix freely in both directions and the transform
can be rolled out per function.

---

## 2. What emitted code MAY assume

1. **The frame arrives zeroed.** `scr_coro_alloc` callocs, so every field the
   codegen does not assign is `0`/`NULL`. Pointer fields may be released
   unconditionally on a cleanup path.
2. **`state` starts at 0.** State 0 is the entry state; no prologue needed.
3. **`base.promise` exists and is owned by the frame.** The codegen never
   creates, retains or releases it.
4. **ALS and the exception cell are handled.** `scr_coro_resume_entry` saves
   and restores the AsyncLocalStorage context on every resume, and swaps a fat
   frame's own cell in and out. This is INV-5; emitted code does nothing for
   it. (A fiber got both free from `scr_switch`.)
5. **The body starts synchronously.** `scr_coro_spawn` runs the body on the
   *caller's* stack up to the first suspension — INV-2, JS semantics. A
   function that never awaits has already settled by the time the wrapper
   returns.
6. **A throw that escapes becomes a rejection.** If the resume function
   returns with an exception pending and has neither parked nor finished, the
   runtime rejects the frame's promise. Emitted code does **not** need an
   `if (!scr_exc_pending())` guard around its finish call the way the fiber
   trampoline does — though having one is harmless.
7. **Turn accounting is the runtime's.** `scr_coro_park` charges exactly one
   `scr_ready_push` per await: one now if the operand is already settled, zero
   now and one at settle if it is pending. Emitted code must not queue
   anything itself.
8. **`SCR_TICK_POISON` reaches this lane.** The HOP arm consults
   `scr_coro_tick_poison()` (an accessor over `scr_async.c`'s cached static,
   not a second `getenv`) and adds one deliberate extra turn when set. That is
   the one place the one-push invariant is broken, and only under the knob.
   Until it existed the poison could not move a stackless turn count at all,
   so the turn table stayed green no matter what the lowering did.
   `run-poison.sh` asserts both that the poison moves this lane and that it
   moves it by the same amount as the fiber lane; `--blind` reproduces the
   regression and must go red.

---

## 3. What emitted code OWES

### 3.1 `ScrCoroBase` must be the first member
The runtime casts `ScrCoroBase *` to your frame and back. Put it first, do not
put anything before it, do not reorder it.

### 3.2 Set `state` BEFORE parking, and `return` immediately after
`scr_coro_park` does not transfer control — it is an ordinary call that
arranges the resume and comes back. The statement after it must be `return`.
Anything else runs a second time on resume.

### 3.3 Every resume path must park, finish, or throw
On every path out of the resume function exactly one of these must have
happened:
- `scr_coro_park(...)` then `return`, or
- one of `scr_coro_finish_void/f64/ref/throw`, or
- an exception left pending (the runtime converts it, see 2.6).

Returning without any of the three is a codegen bug and the runtime **aborts
loudly** rather than leaking a frame that settles nothing. That abort is a
feature: the silent version of this is an async function whose promise never
settles.

### 3.4 Own the awaited promise
`scr_coro_take_*` does not release the operand. The frame holds it across the
suspension (so it must be a frame field, not a C local) and emitted code
releases it after taking the value.

### 3.5 Refcounted frame fields are the codegen's to release
The runtime frees the frame block; it does **not** walk your payload. Every
refcounted field live in the frame must be released on every exit path,
including the rejecting one — which is why 3.3's example checks
`scr_exc_pending()` after a take and bails to a cleanup path.

*Known parity gap, not a regression:* a frame still parked when the loop exits
is abandoned and its payload is not released.

**THE `drop` HOOK IS NOT OWED, AND THAT IS NOW MEASURED RATHER THAN ASSUMED**
(2026-10-11). This paragraph used to continue "— exactly what happens to an
abandoned fiber today (`scr_fibers_abandoned`)", and then to offer: "If the
codegen cannot discharge 3.5 on all paths, the right fix is a per-function
`drop` hook in `ScrCoroBase`; that costs 8 bytes on every frame, so it is
deliberately not there yet. Ask for it rather than leaking." That was a
CONDITIONAL offer whose condition nobody ever measured, and section 7 then
carried it for months as though it were an outstanding obligation. It is not
one. `tests/harness/coro-abandon-parity.test.ts` drives a frame carrying a
heap string, an array and an object ACROSS the suspension — all three read
after the resume, so the emitter must put them in the frame — out through
every exit path a frame can actually take, and asks the RC audit:

| exit path | stackless lane, SCR_RC_AUDIT=1 | frame payload leaked |
| --- | --- | --- |
| the await REJECTS, caught, normal return | exit 0, audit silent | none |
| ordinary fulfilment | exit 0, audit silent | none |
| the consumer drops the result promise | exit 0, audit silent | none |
| the frame's own promise rejects, unattached | exit 1 (unhandled rejection), audit silent | none |
| throws before its first await | exit 0, audit silent | none |
| **parked when the loop exits** | **exit 99, `RC AUDIT FAILED`** | the whole payload, by design |

**The codegen discharges 3.5 on every path a frame LEAVES by.** The hook's
condition is false, so the 8 bytes are not owed — and 8 bytes was never the
whole price. `scr_coro_release` (`packages/runtime/src/scr_coro.c:57`) has
EXACTLY ONE caller, `scr_coro_resume_entry` (`:308`), and a frame only
reaches it after its body has run and released its own slots, so a hook
invoked there DOUBLE-releases. The only site that wants one is loop exit, and
loop exit holds no list of live frames to walk: `ScrCoroBase` is six fields
with no links and no cycle header (`scr_coro.h:102`), and `scr_async.c:4456`
sets a COUNTER. A usable hook therefore needs an intrusive registry with
insert and unlink on the `scr_coro_alloc` hot path, which is two more
pointers per frame on top of the hook — not a pointer in the header.

**AND THE PARITY CLAIM WAS FALSE IN THE REASSURING DIRECTION.** The residue
is *not* "exactly what happens to an abandoned fiber". On the SAME source the
stackless lane prints its coroutine line, FALLS THROUGH to the leak check
(`scr_console.c:61-64` prints and does not return), finds the deliberately
retained payload and dies `_Exit(99)`; the fiber lane prints its skip notice,
RETURNS (`:67-71`), and exits 0. Both halves are deliberate where they were
written — the coroutine line exists precisely so the failure is EXPLAINED
rather than silent — so the divergence is pinned by the test rather than
erased. What could not stand is the sentence claiming the two lanes agree,
because that sentence was the stated reason for leaving the residue open.
SCR_RC_AUDIT BUILDS ONLY: `coro-abandoned-count.test.ts` PROOF 3b pins the
literal out of a shipping image, so none of this reaches a shipped binary,
and the column this whole clause moves is diagnostic fidelity — zero bytes,
zero blocks. It is completeness, not a gain.

### 3.6 Pick lean or fat correctly
`has_exc` is `false` for census classes **D1–D3** and `true` for **D4**.

- A **lean** frame (`ScrCoroBase`, 40 B) has no `ScrExcCell` and borrows the
  ambient cell while it runs.
- A **fat** frame (`ScrCoroExc`, 96 B) carries its own 56-byte cell.

The rule is a property, not a budget: the cell holds an exception *in flight*,
so a frame needs its own only if it can be **suspended while one is pending**,
and that is exactly D4 (a suspension reachable from a `finally`, or from a
`try` whose `finally` must still run). Passing `false` for a D4 function loses
the pending exception across the suspension. Passing `true` for a D1 function
is merely 56 bytes wasted.

Measured on `tests/perf/zapo-rest/app182`: **D1–D3 is 2,148 of the 2,260
suspension points (95.1%)**. Lane: none — the census classes and the point
count both come from the IR liveness pass, which both backends consume
unchanged, so this share is lane-independent. *That figure was taken on an
earlier build and is NOT re-derived below; the point population can move with
the admission.*

**The fat frame is now allocated on the real load, and on 2026-10-06 it was
not.** Counted from the emitted `.scrh` (lane: C; same artifact as section
8b): at `90004bd0f`, **76 of 1,301 frames (5.8%) open with `ScrCoroExc`** and
1,225 with `ScrCoroBase`. At `4e93997eb` the same program emitted 990 frames
and **zero** fat ones — so "the fat frame exists and is sized" described the
header, not the output. **The denominators are not the same question:** 95.1%
above is a share of suspension POINTS, 5.8% here is a share of FUNCTIONS, and
neither converts into the other without the per-function point counts.

---

## 4. Frame sizing

**The IR liveness numbers are a LOWER BOUND, not a value.** A frame is

    sizeof(ScrCoroBase) + live IR locals + live EMITTER TEMPORARIES

and the third term is not derivable from the IR, because those values have no
`IrLocal` for liveness to name. They are discovered during emission, from the
RC frame (`E.frames`) at the moment of the park.

This is not a rounding error. `scr_coro_park` RETURNS to the scheduler, so
every C local in the resume function is dead at the resume label -- and every
temporary the emitter's RC frame still OWNS at that park has the same problem.
`await Promise.race([a, b])` is the worked case: both input promises stay owned
across the await, and a scope release running over them after the resume walks
dangling pointers. Moving the awaited promise into the frame fixes one of
them; the rest need the same treatment.

So: **size frames from the emission, not from the liveness pass.** The numbers
below are what liveness could see, and the real frames are larger by however
many owned temporaries are live at each park.

From the IR liveness pass over zapo-rest, per function: p50 32 B, p90 56 B,
max 208 B of payload -- lower bounds, **and from an earlier build than this
revision**. The worked example in `tests/perf/corostate`
(`resolveDisallowedListEntries`) is 64 B of payload by liveness, so at least
104 B with the base.

**HOW FAR BELOW: measured, 2026-10-10, on `90004bd0f`.** Read off the emitted
header section 8b measures (lane: C; the 1,301 ADMITTED frames; payload =
`sizeof` - 40). The left column is the liveness term as a PROXY -- the
`sc_v_*` fields, which are exactly what `coroFrameLocals` put in the frame --
not a re-run of the liveness pass:

| | liveness term (`sc_v_*` fields) | MEASURED payload |
|---|---|---|
| p50 | 24 B | **48 B** |
| p90 | 72 B | **128 B** |
| max | 456 B | **4,216 B** |

Field counts are converted at 8 B each, which is exact for 1,210 of the 1,301
frames; the remainder carry the 96-byte fat base.

**Do NOT read this against the `32 / 56 / 208` above cell by cell.** That row
is over the admitted population of an earlier build; this one is over 1,301
functions. A p50 that FELL (32 -> 24 B) is the admission reaching many more
small functions, not frames getting leaner. The only cross-row statement that
survives different populations is the max, and it is the one that matters:
the liveness bound this section published as **208 B** is **456 B** today,
and the real payload behind it is **4,216 B**.

**The worst frame is the argument in one line.** `sc_cf_route` is 4,256 B and
holds **43 IR locals against 484 emitter temporaries** -- the liveness pass
can see **8%** of that frame.

Both loop forms put their iteration state in the frame: a `forOf` lowers to an
array pointer plus an index, and both are live across every suspension in the
body. The liveness measurement does count those.

## 5. No frame pool, and the number that says so

The fiber pool (cap 4096) exists because `CreateFiberEx` costs ~20 µs. A frame
is a `calloc`. Measured (`run-bench.sh`, 104-byte frame):

| | ns per round trip |
|---|---|
| `calloc` + `free` | 49.8 (min 35.5, max 66.9) |
| free-list get/put | 3.9 |

So a frame pool's **ceiling** is ~46 ns per frame. Across a full 24,246-frame
peak that is ~1.1 ms, against the **435-501 ms** that replacing
`CreateFiberEx` with `calloc` already saves — both from the section 6 bench
below, and both therefore inheriting its arms, its host, and the fact that it
is a RUNTIME bench rather than a compiler-lane one. The pool would buy
**~1.1 ms of 435-501 ms, i.e. 0.2-0.3%** of what the transform itself wins,
in exchange for a cap, a decay policy, and the retention and poisoning
problems the fiber pool needed several commits to settle.

*This paragraph read `~504 ms` and `0.2%` until 2026-10-10. `504` is
20.8 us x 24,246, i.e. the TOP of the fiber range times the peak with the
stackless side never subtracted — a cost, not a saving, and outside what the
table's own ranges support. The saving is
(18.1 us - 144 ns) x 24,246 = 435 ms at one end and
(20.8 us - 134 ns) x 24,246 = 501 ms at the other. The conclusion is
unchanged, which is exactly why it went four days unchecked.*

**Decision: no frame pool.** Revisit only if a profile shows frame allocation
above a few percent of run time; the number to beat is 46 ns.

---

## 6. Speed, for context

**Lane: NEITHER. These are RUNTIME numbers.** `tests/perf/corostate/*` never
go through the compiler: `run-bench.sh` hands `corobench.c` and
`packages/runtime/src/scr_coro.c` straight to `zig cc`, and the "stackless"
arm is the hand-written `FrameLoop` state machine inside that file, not
emitted code. What the table compares is `scr_switch` against
`scr_coro_park` in one `scr_coro.c` — the same object file BOTH lanes link.
So no row below is a property of the C lowering, of the LLVM lowering, or of
the transform in general. Arms are the table's own columns.

**The label this paragraph replaced — "Lane: C … the LLVM lane is UNMEASURED
here" — was wrong twice, and the correction is recorded rather than quietly
applied because the table was quoted under that label for days.** (1) There
is no compiler lane in this bench for "C" to name. (2) The LLVM lane now has
a stackless lowering and it is the **SHIPPING DEFAULT** —
`ir/coro-plans.ts` tests `SCRIPTC_STACKLESS === "0"`, so an ABSENT knob is
ON — and that lane has been measured twice. Section 6a.

`run-bench.sh`, zig 0.16.0 from `G:\tools\zig`, target `x86_64-windows-gnu`,
`-O2`, K=2000, 11 reps, both arms in one process. Absolute ns, ranges across
two launches.

| | fiber | stackless | ratio |
|---|---|---|---|
| hop suspend+resume | 284–310 ns | 96–111 ns | 2.8–3.0x |
| waiter suspend+resume | 408–625 ns | 202–222 ns | 2.0–2.8x |
| create, pool hit | 253–258 ns | 73–90 ns | 2.9–3.5x |
| create, pool **empty** | 18.1–20.8 µs | 134–144 ns | **125–155x** |

The last row is the one that matters at the zapo peak: 24,246 fibers are live
simultaneously, so the pool is drained and every spawn is a real
`CreateFiberEx` with a 1 MiB reserve.

**On `24,246` against `9,004`.** Commit `fe60c3267` reports `live fiber
stacks 9,004 -> 3` for the same program. The two are **possibly distinct
populations, not reconciled**: this figure is described here as fibers live
simultaneously at the peak, while `fe60c3267`'s is a live-fiber-stack count
on a different build and a different arm (its row sits beside the
100%-conversion ceiling, not the real load). Neither was re-measured to
settle it, so do not treat either as the peak fiber count without naming the
build and the arm it came from.

---

## 6a. The compiled lanes, measured

Section 6 measures the runtime. This section measures what the COMPILER
emits. Every row names its program, its arms, its denominator and its
instrument, because the single most expensive mistake on this front has been
a right measurement carried past its scope.

### 6a.1 Microbench, LLVM lane -- the first compiler-lane speed numbers

Four arms -- fiber and stackless, each on the C lane and the LLVM lane --
quiet window, programs COMPILED by scriptc (unlike section 6). Reference arm:
fiber on the LLVM lane; the table's ratio is within that lane.

| | ratio, fiber -> stackless |
|---|---|
| hop | 2.17x |
| waiter | 2.50x |
| hopserial | 2.33x |
| hopconc, 50k live tasks | 5.64x |
| marginal bytes per live task | 6,064.9 -> 585.3 B (**10.36x**, R2=0.99999) |

**No ratio between the two COMPILER lanes is quotable: their speed ranges
OVERLAP.** The LLVM lane is not faster than the C lane here; it is
indistinguishable from it, with smaller frames, because it spills fewer
temporaries -- `hopTask` is 88 B on the C lane and 64 B on the LLVM lane.

*Scope: like 6a.2, the bench program lives in the measuring rig and not in
this repo.*

### 6a.2 The synthetic ladder (`fanoutladder.ts`), LLVM lane

A real compiled program, 3 async frames per chain, membership checked BEFORE
the measurement: 4 of 4 functions and 7 of 7 suspension points converted.

- marginal private commit **64.81 -> 6.21 KiB per chain (10.43x)**
- totals at 384,000 chains **24,307 -> 2,332 MiB (10.42x)**
- allocation burst **1.52x** (3k chains) and **1.83x** (24k)
- correctness to 384,000 chains on BOTH arms -- concurrency does not break
- under an identical **1024 MiB** ceiling, fiber breaks in (16,000, 16,400]
  and stackless in (168,000, 170,000] => **10.4x more concurrency**.
  Predictions 16,152 and 168,398 were made BEFORE the run; both landed inside
  their brackets.

*Scope: the program lives in the measuring rig, not in this repo. The numbers
are reproducible only with that rig, and that is a known gap.*

### 6a.3 The real application (`tests/perf/zapo-rest/app182`)

Two binaries of the SAME program, differing only in the lane
(`SCRIPTC_STACKLESS=0` vs the knob absent). Both are LLVM-lane builds (`.ll`,
no `.c`); every assertion passes on each arm (61 of 61 at `167fc0f8e`, 59 of
59 at `554d2fb65` -- the harness has grown two) and the transcripts are
byte-identical outside timestamp, pid, port and the exe path. Instrument:
`PeakPagefileUsage` / `PeakWorkingSetSize` -- **kernel high-water marks read
out of process, not a sampled series** (a downsampled series cannot measure a
peak). Route `/s/alpha/store/threads?limit=20`, ABBA arm order, saturation
cell n=6 (`554d2fb65`) and n=12 (`167fc0f8e`).

**The table below is the re-measurement at `167fc0f8e`. The numbers first
recorded here, at `554d2fb65`, are kept beside it, because between the two
heads 194 of the stackless arm's 196 remaining `scr_async_spawn` sites left
the artifact and it is the fact that NOTHING MOVED that is the finding.**

| | fiber | stackless | ratio | (same row at `554d2fb65`) |
|---|---|---|---|---|
| peak private commit at saturation (62.9 concurrent chains) | 22.14 MiB | 13.91 MiB | **1.591x** (-37%) | 22.07 / 13.92 = 1.585x |
| peak working set at saturation | 30.28 MiB | 26.49 MiB | 1.143x | 30.21 / 26.58 = 1.136x |
| private working set (plateau) | 14.91 MiB | 11.03 MiB | 1.351x | 14.82 / 11.04 = 1.342x |
| **marginal private commit per concurrent request** | 165.2 KiB | 42.0 KiB | **3.93x** | 163.6 / 41.8 = 3.91x |
| throughput at saturation | not re-measurable, see below | | | 8,629 -> 8,933 rps = +3.5% |
| p50 at saturation | not re-measurable, see below | | | 6.995 -> 6.701 ms = -4.4% |

Every memory row reproduces to within 1.0% of the figure measured at
`554d2fb65`, on both arms. The marginal row is a least-squares slope over
C=0..64, the region where achieved in-flight tracks offered 1:1 (R2 = 0.994
fiber, 0.998 stackless); socket-corrected it is 4.05x. Worst within-cell
spread in peak commit is 2.07%, against a 59.1% effect -- 29x the noise.

#### The re-measurement, and why it was owed

`554d2fb65` measured a stackless arm whose emitted `.ll` still carried **196**
`scr_async_spawn` call sites. At `167fc0f8e` that artifact carries **2** (the
compile-time census reads `1485 lowered of 1485 planned`, against the
`1,292 of 1,301` that 6a.4 describes). 194 sites -- the 184 of the
zero-suspension-point row and the nine cross-park readers among them -- left
the lane between the two heads.

**They bought nothing on this program.** Peak private commit on the stackless
arm went 13.92 -> 13.91 MiB (-0.04%) and the marginal went 41.8 -> 42.0 KiB
(+0.52%), both inside the within-cell spread. Neither column moved: not the
peak, not the slope.

That is not a null result about the lane; it is a positive result about where
the lane's cost lives. **A coroutine with no suspension point never parks**,
so on the fiber arm its stack is acquired and released inside one turn and is
never resident alongside another. It cannot appear in a high-water mark taken
over 62.9 concurrently parked chains. The 8.2 MiB that separates the arms at
saturation is paid by frames that are parked AT THE SAME TIME, and those were
already converted when the first table was measured. Converting the rest was
completeness and correctness work -- it closed the refusal set to zero -- and
it is correctly scored at zero MiB here.

**The fiber arm is the control, and it held**: 22.07 -> 22.14 MiB (+0.32%) and
163.6 -> 165.2 KiB/req (+0.96%), across a compiler that changed under it. A
fiber arm that had moved would have condemned the rig, not the lane.

**Throughput was NOT re-measured, and the +3.5% above stands only as the
`554d2fb65` figure.** The re-measurement ran on a box carrying 26-31 processes
over 300 MB against that run's 7, and rps is the row that notices: within the
single n=12 saturation cell the FIBER arm alone returned 3,702 to 6,632 rps, a
1.79x spread, while its peak commit stayed inside 21.97-22.24 MiB (1.2%). Two
sweeps of the same two binaries on the same afternoon put the lane's
throughput edge at +0.9% and at +11.6%. Memory was measurable on that box;
throughput was not. **That is the general shape: a kernel high-water mark over
a fixed workload is robust to a loaded host, and a rate is not.**

**Four things bound those numbers, and they matter as much as the numbers.**

1. **The 10.4x of 6a.2 does NOT transfer, not even as a marginal slope.**
   That figure is per CHAIN on a ladder whose chains carry almost no heap.
   This one is per CONCURRENT REQUEST, where lane-independent heap -- the
   parsed bag, the rows, the JSON string, the response buffer -- sits in the
   numerator AND the denominator. Different denominators, so the ladder
   number is not even an upper bound on this one by a safe argument.
2. **The ratio is not a constant of the lane, and it is not monotone in
   payload size.** Marginal KiB per request, C=0 vs C=64, n=2 per cell, at
   `167fc0f8e` with the `554d2fb65` reading in brackets:
   404 **1.95x** (2.28x), `/health` **1.67x** (1.92x), threads-20 **3.70x**
   (3.96x), threads-200 **1.89x** (1.88x). The ORDER is reproduced exactly,
   and the peak-commit column reproduces to within 0.6% on all four routes.
   (The marginal column here is a two-point slope at n=2 and is the noisiest
   estimator in this section; the table above is least squares over seven
   cells -- same data, different estimator, 3.70x against 3.93x on the same
   route.) The prediction that a LIGHTER
   request would show a HIGHER ratio was REFUTED. The model that fits all
   four rows has two terms -- `F(lane, call depth) + H(per-request heap)`.
   `F` is lane-dependent: a fiber commits real stack pages down to the
   deepest frame the chain reaches, while the stackless arm spills only the
   slots live across each suspension. `H` is lane-independent and dilutes the
   ratio from both ends. **The lane pays most on a request that goes DEEP and
   returns LITTLE.**
3. **`scr_net_dispatch` drains `SCRP_BATCH = 64` events per turn**, so
   achieved in-flight pins at **62.9** from an offered 64 all the way to
   2048 -- identically on both arms, which is exactly what makes the
   comparison fair. No zapo-rest route parks a chain, so for THIS program the
   per-chain saving multiplies by **<= 63, never by 384,000**. The C=64 ->
   C=512 cells add 448 sockets and zero chains, which isolates the socket
   cost: +1,586 B/socket fiber and +1,402 B/socket stackless at `554d2fb65`,
   +1,190 and +1,516 at `167fc0f8e`. The two runs bracket each other rather
   than agreeing, so this control establishes that the socket cost is
   lane-independent to about +/-15%, not to three digits.
4. **The +3.5% is a FLOOR on the throughput gain, not a ceiling.** The load
   generator shared the same 6-core box, so both arms were compressed by
   contention.

Not measured, and said rather than implied: WebSocket subscribers (the ack
window is O(1) by design), scaling in N sessions (that measures client/store
construction), `/connect` chains (needs the network), and startup latency
(lazy migration dominates).

### 6a.4 Reach on the real load

**SUPERSEDED at `167fc0f8e`: the census now reads `1485 lowered of 1485
planned`, with `scr_async_spawn` 1,487 -> 2 call sites in the emitted `.ll`.**

**AND THE "EMPTY REFUSAL SET" THAT USED TO BE WRITTEN HERE WAS WRONG, in a
way worth keeping because the instrument is still in use.** `1485 of 1485
planned` is a lowered-against-PLANNED ratio, and it is structurally blind to
a function refused BEFORE planning: such a function is in neither column. The
same paragraph records the two surviving `scr_async_spawn` sites, so the
document contradicted itself in two sentences. The artifact, not the census,
is the only honest reach measure -- and the two it names are
`ProtoStreamReader.ensure` and `destroyIfSupported`, both refused at the
admission gate for `agenResume`'s sake (6a.5). What follows is the account at the
revision this section was written for, kept because 6a.3's first table was
measured against it.

**1,292 of 1,301 planned coroutines lower** on app182, triangulated three
ways and cross-checked exactly against `scr_async_spawn` 1,488 -> 196
(1,488 - 1,292 = 196). The 9 refusals fall back to the fiber lane correctly.
This section recorded a reach of ZERO on real load before the then-adapter
ICE was fixed; the census has not moved since (predicted 1,297, measured
1,292, identical refusal set).

---

### 6a.5 The two fiber entries that are left, counted where it matters

6a.3's benefit table is scored on `/s/alpha/store/threads?limit=20`. 6a.4
says what is still on a fiber. **This section answers the question that sits
between them and that neither could: how many frames of those entries are
SUSPENDED AT THE SAME INSTANT while that table is being measured?** That
number, not the conversion count, is what a remaining conversion could buy --
B1's null is exactly the lesson that a spawn which completes inside one turn
costs nothing.

Instrument: the per-entry park table in `tests/perf/fiberstat/scr_fiber_stat.h`,
keyed on the fiber ENTRY POINTER and counting `scr_await_park` (an await on an
UNSETTLED promise) and `scr_await_yield` (the one-turn microtask hop a settled
await takes) separately, each with an exact high-water. Read out through the
`_Exit` interposer on app182's `/shutdown` route, because `process.exit`
lowers to `_Exit` and an atexit-only report is silently never written. The
table has no reset, so a phase is a SEPARATE CELL and the per-phase answer is
a subtraction. Both arms built at `6bc2848a9` with the header `-include`d
through `SCRIPTC_PROF_CFLAGS`. The instrument reaches the runtime C TUs only,
and that was checked rather than assumed: the stackless arm's emitted
`.ll` differs from B1's UNINSTRUMENTED build of the same program by 42
bytes, every one of them inside a worktree or provenance-cache PATH STRING.
The program being measured is the one B1 measured.
Raw tables: `tests/perf/fiberstat/evidence/`.

| cell | arm | what ran | fibers created | suspended high-water | entries in the table |
|---|---|---|---|---|---|
| boot | stackless | server up, no requests | **0** | **0** | **0** |
| threads-20, C=64 | stackless | 90,234 requests, 62.9 in flight | **0** | **0** | **0** |
| `/health`, C=64 | stackless | 266,228 requests, 62.7 in flight | **0** | **0** | **0** |
| session create+remove | stackless | one session destroyed | 11 | 11 | 1 |
| boot | fiber | server up, no requests | 37 | 36 | 17 |
| threads-20, C=64 | fiber | 74,535 requests, 62.9 in flight | **315** | **315** | 19 |
| session create+remove | fiber | one session destroyed | 40 | 39 | 64 (+36 over the table) |

**`ProtoStreamReader.ensure` is parked ZERO times, on every route, and it is
not merely unparked -- it is never SPAWNED.** On the stackless arm the
artifact holds exactly two `scr_async_spawn` entries, and across four cells
only ONE of them ever appears. Under load the table is empty and
`CreateFiberEx` is called zero times: the whole stackless server runs the
62.9-concurrent-chain cell that produced the 1.591x / 3.93x table **without
creating a single fiber stack**.

**Why it cannot be otherwise, read from the source rather than inferred from
the zero.** `ensure` is reached only through `streamProtoFields`
(`zapo-js/src/util/proto-stream.ts:235`), whose only two callers are
`history-sync.ts:304` and `group-history.ts:92`; both are driven by an inbound
DECRYPTED WhatsApp message (`WaClient.ts:348` for the
`HISTORY_SYNC_NOTIFICATION` protocol type, `WaClient.ts:443` for the group
bundle). The rig sets `ZAPO_AUTOCONNECT=0` and there is no WhatsApp socket, so
the path is unreachable on every route -- **not just on the measured one**.

**This is a SCOPE finding about the benefit table, not a defect.** The hot
path the bench measures and the hot path the application has are different
things, and 6a.3's numbers are silent about the second. They remain correct
for what they measure.

**`ensure` could not dominate a per-request number even with a live socket.**
Each `ensure` call is `await`ed sequentially by one driver loop over one
`ProtoStreamReader`, so **at most one `ensure` frame is parked per concurrent
protobuf stream**; streams are created one per history-sync notification, not
one per request. Its concurrency tracks inbound history-sync blobs and can
never enter a per-CONCURRENT-REQUEST marginal slope.

**`destroyIfSupported` is parked 11 at once, and only on teardown.** Zero on
both load routes; on one `/sessions/remove` it is spawned 16 times, parks 16
times, and reaches a high-water of **11** -- which is exactly
`destroyPersistentStores`' `Promise.allSettled` of 11 (`createStore.ts:587`),
the larger of its two batches, the other being `teardownCaches`' 5
(`createStore.ts:525`). `yieldIn` is 0: every one of those awaits was on a
genuinely unsettled promise. Reproduced identically in two independent cells.

**The positive controls, because a gauge that can only read zero passes every
workload.** Three, and all three could have come out the other way:

1. `tests/perf/fiberstat/parkprobe.ts` holds exactly 7 frames of an
   `ensure`-shaped method parked at once and the table reads `parkHi 7`. The
   SAME loop body awaiting a plain promise-returning method instead of an
   async iterator is emitted `stackless spawn %PlainReader.ensure`, carries no
   `scr_async_spawn`, and never appears in the table at all -- which is the
   mechanism of the whole row in one artifact.
2. The fiber arm, on the SAME route at the SAME 62.9 in-flight, reads 315
   suspended frames with four distinct entries at `parkHi 63` each. The
   counter is not blind to this workload; the stackless arm has nothing for it
   to count.
3. The stackless arm's own teardown cell reads 11 in the same binary that
   reads 0 under load.

**What this costs the conversion front.** Lifting `agenResume` --
`LLVM_UNLOWERABLE_POINT_KIND_LIST` in `backend/llvm/coro.ts:378`, with the
`scr_current` question `ir/liveness.ts:487` names -- is the only thing between
`ensure` and the lane, and `ensure`'s emitted body
(`scr_gen_in_ref` / `scr_agen_next` / `scr_await_ref`) confirms it is the
consumer-side resume and nothing else. **On app182 it is worth 0 MiB**, for
the same structural reason the 194 sites were: the frames are not there to
save. It remains correctness work, and the number to beat it against is a
program that actually runs a history sync.

**Stated, because the instrument has one.** `parkLive` can only drift UP (a
fiber torn down while parked never runs its `_OUT`), so every figure is an
upper bound and a zero is a hard zero. The table holds 64 entries; the FIBER
arm's teardown cell overflowed it by 36, so that row's entry count is a floor.
The stackless arm never exceeded 1.

---

### 6a.6 The history-sync cell -- the program 6a.5 asked for

6a.5 closes by saying the number to beat `ensure` against "is a program that
actually runs a history sync". This is that program, and the row it was asked
for. Everything in 6a.3 and 6a.5 is scored on HTTP routes where
`ZAPO_AUTOCONNECT=0` makes `ensure` structurally unreachable; this cell drives
the rig's fake WhatsApp server and `ensure` IS reached.

**Two binaries of the same program at `3c462de14`, differing only in the lane**
(`SCRIPTC_STACKLESS=0` vs the knob absent). Instrument: `PeakPagefileUsage` --
**kernel high-water commit charge read out of process** by
`tests/perf/zapo-rest/harness/pmon.c`, not the maximum of a sampled series.
Driver: `memrig.mts` at `CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 ROUNDS=1
IDLE_S=60`, the dials `docs/estado-vmwalk.md` 7 was measured at. Twelve runs in
three ABBA series (`S F F S`, then `F S S F`, then `S F F S` again), so neither
arm is confounded with position.

#### Peak private commit

| arm | mode | n | mean MiB | within-cell spread |
|---|---|---:|---:|---:|
| fiber | low | 5 | **446.80** | 0.09% |
| fiber | high | 1 | **536.55** | - |
| stackless | low | 3 | **57.12** | 0.68% |
| stackless | high | 3 | **64.76** | 0.43% |

| comparison | ratio | delta | |
|---|---:|---:|---:|
| most conservative (fiber low vs stackless high) | **6.90x** | -382.04 MiB | -85.5% |
| fiber low vs stackless low | 7.82x | -389.68 MiB | -87.2% |
| fiber high vs stackless high | 8.29x | -471.79 MiB | -87.9% |
| most favourable (fiber high vs stackless low) | 9.39x | -479.43 MiB | -89.4% |
| all twelve runs, arm means | 7.58x | -400.82 MiB | -86.8% |

The peak falls in the same place on every one of the twelve: inside the
history-sync decode, between `chunk-decoded-1` and `SYNC-DONE-r1`. Not boot,
not teardown.

**The fiber arm is the control and it held across seven days and a different
tree.** Section 7 of `estado-vmwalk.md` measured 445.56 MiB (low mode) and
538.51 (high) at `e54bf853f`; this measures **446.80** and **536.55** at
`3c462de14` -- +0.27% and -0.36%. The bimodality reproduced too, and the park
table below now MEASURES the population that section could only infer: `outHi`
20,262 against the 20,207 stacks it names for the low mode.

**Same work on both arms, checked rather than presumed.** `memrig-rows.mjs`
over each run's `state.sqlite`: 19,209 messages, 19,200 of them history, 3,200
threads, `bytesSum` 6,023,520, `integrity ok`, identical on both arms, and the
sqlite files are the same size in bytes.

#### The park table on this load, and the answer to "how many at once"

Cells `c08`-`c12` in `tests/perf/fiberstat/evidence/`. The instrumented
binaries' emitted `.ll` is **byte-identical** to the uninstrumented one on each
arm (`SCRIPTC_PROF_CFLAGS` reaches the runtime C TUs only), so these count the
same programs the table above weighs.

| cell | arm | load | fibers out, high-water | **suspended at once** | poolHi | fresh | entries |
|---|---|---|---:|---:|---:|---:|---:|
| `c08` | fiber | full | 20,262 | **20,256** | 4,096 | 42,434 | 64 (+414,592 over) |
| `c09` | stackless | full | 14 | **14** | 14 | 14 | 2 |
| `c10` | fiber | 1x1x1 | 77 | 77 | 77 | 149 | 64 (+6,719 over) |
| `c11` | stackless | 1x1x1 | 2 | 2 | 2 | 2 | 2 |
| `c12` | fiber, `SCR_FIBER_POOL=0` | full | 24,311 | 24,304 | 0 | 166,381 | 64 |

**The form parks, and 20,256 frames of it park at the same instant on the fiber
arm against 14 on the stackless one -- 1,447x.** Subtracting the minimal-load
cell, which is boot plus one message, the history sync itself accounts for
20,179 simultaneous suspensions on the fiber arm and 12 on the stackless one.

**The 14 do not scale with the payload; they scale with CHUNKS.** `c09` holds
exactly two entries, one `gen` and one `async`, which spawn 8 and 16 times at
`CHUNKS=8` and 1 and 2 times at `CHUNKS=1` -- linear in the chunk count and
flat in the 19,200 messages those chunks carry. That is 6a.5's structural
argument reproduced on the load it could not reach: at most one `ensure` frame
is parked per concurrent protobuf stream, and streams are created one per
history-sync notification. **Attribution of the two entries is by SCALING, not
by symbol**: the artifact holds two `scr_async_spawn` entries
(`ProtoStreamReader.ensure`, `destroyIfSupported`) and two `scr_agen_new`
entries (`zipChunks`, a stream async-iterator), and resolving an entry POINTER
to one of them needs `tests/perf/obj-symbols.mjs` against the cached objects,
which was not done. The headline does not rest on which: it rests on 14.

**Three positive controls, and all three could have come out the other way.**

1. `SCR_FIBER_POOL=0` on the same binary (`c12`) drives `poolHi` 4,096 -> **0**
   and `fresh` 42,434 -> **166,381**, which is above `outHi`, exactly as the
   header's arming note requires. A build where both settings read the same
   would be a broken gauge, and they do not.
2. The fiber arm reads 20,256 where the stackless arm reads 14, on the same
   instrument, the same load and the same host.
3. The stackless arm's own reading is **not zero** -- 14 under load and 2 at
   minimum load. A zero here could not have told "does not park" apart from
   "counter dead"; a non-zero that tracks CHUNKS can.

**Per-entry attribution on the FIBER arm is a floor, and badly so.** The table
holds 64 entries and that arm overflowed it by 414,592 spawns. The two largest
visible entries carry 22,444 spawns each -- which is 19,200 messages + 3,200
threads + 44 -- at `parkHi` 319 and 318. The GLOBAL `outHi`/`suspHi` are not
per-entry and are exact.

#### What this corrects in `docs/estado-vmwalk.md` section 7

That section decomposes the shipped 538.51 MiB high-mode peak into 24,246
stacks at 16,830 B plus 48.68 MiB of page tables -- 437.84 MiB, **81.3% of peak
private commit on this workload** -- and a remainder of 100.67 MiB. Scaled to
the low mode this cell actually measured (20,262 stacks, 446.80 MiB), the same
decomposition gives 365.49 MiB of fiber infrastructure and a remainder of
**81.31 MiB**.

**The lane lands at 57.12 MiB, about 24 MiB BELOW that remainder.** It removed
389.68 MiB where the decomposition attributes only 365.49 MiB to fibers. The
remainder is therefore **not lane-independent**: part of what it files as
"rest" is proportional to the suspended-task population too, and a prediction
built by subtracting only the stack term from the peak -- which is how this
measurement was predicted in advance -- overestimates the floor by about 1.76x.

#### Peak working set, which is a different column and a different finding

| arm | mode | n | mean MiB | spread |
|---|---|---:|---:|---:|
| fiber | low | 5 | 184.18 | 0.20% |
| stackless | low | 3 | 71.13 | 0.79% |
| stackless | high | 3 | 78.21 | 0.40% |

**2.47x, -109.50 MiB, -59.5%.** This contradicts the shape section 7
established for the two FIBER KNOBS, and the contradiction is the point. Those
knobs moved commit by 37% and left RSS untouched, because guard pages and
untouched committed stack were never resident and removing them cannot move a
number they were never in. **The LANE is not that kind of change**: it removes
the whole stack, the touched pages included, so it moves both columns. Carrying
"this is a commit win and NOT an RSS win" across to the lane is a right
measurement used outside its scope.

#### Bounds, said rather than implied

* **The mode is a draw, on both arms.** Six fiber runs gave five low and one
  high; six stackless runs gave three low and three high. The two arms' modes
  are not matched run-for-run, which is why the ratio is quoted as a RANGE
  (6.90x-9.39x) and the conservative end is the one to carry.
* **Eight of the twelve runs were taken on a loaded host** -- a game holding
  9.5 GB and ~58% of a twelve-logical-core box -- and four after it exited.
  That is a control, not a flaw, and the column passed it: the fiber arm reads
  446.76 MiB loaded and 446.85 MiB quiet, **+0.02%**. The stackless arm's MODE
  did follow the host state in this sample (low while loaded, high while
  quiet), at n=2 on the quiet side, which is too few to call a mechanism.
* **Throughput was not measured.** 6a.3's rule applies: a kernel high-water
  over a fixed workload is robust to a loaded host and a rate is not.
* **One workload, one store.** Everything here is `CHUNKS=8 CONVS=400 MSGS=6`
  against the sqlite store. Nothing is claimed about other stores, other chunk
  shapes, or a live WhatsApp socket.

---

## 6b. CLOSED DEFECT: the frame struct did not survive a TU split

**Fixed in `850c92290` ("the frame struct belongs in the shared header, not
unit 0"), an ancestor of this document's revision: `emit-coro.ts` now routes
both the struct and the resume declaration through `E.protoOut(out)`, which
is the shared header when the program splits and `out` when it does not.**
The diagnosis is kept because the mechanism is instructive and because the
conversion counts below were first taken from this non-linking build.

As measured BEFORE the fix, on a real `zapo-rest` build with
`SCRIPTC_STACKLESS=1`, `--backend c`: the emitted C **did not compile**.

    zapo-rest.part4.c:7:3: error: use of undeclared identifier
                                  'sc_cf__x25_promise_all_tuple_247'

Mechanism, and it is not an edge case:

| | where it lands |
|---|---|
| frame structs `sc_cf_*` | **533**, all in the main TU `zapo-rest.c` |
| shared header `zapo-rest.scrh` | **0** |
| resume functions `sc_cr_*` | **533**, all in `part1..part6,part14` |

So *every* converted function has its frame type in one translation unit and
its resume function in another, with nothing in the header to bridge them.
A program that splits cannot build at all with the knob on; the single-TU
probes pass because nothing is split.

The cause is visible in `emit-coro.ts`'s own note: the declaration goes into
`out` rather than through `E.decl` because "the spawn wrapper below takes the
resume function's ADDRESS, so the declaration has to precede it in the same
emitted section." That reasoning is right about the resume function's FORWARD
DECLARATION and wrong about the frame STRUCT: the struct has no ordering
constraint against the spawn wrapper and belongs in the shared header, which
is the only thing every split TU includes.

The conversion this build produced — counted from the emitted C (lane: C;
arms are the OFF and ON columns; guard: a function has a trampoline or a
resume, never both). First taken from the non-linking build above, and the
same figures were then reported from a build that compiles and runs with the
knob on in `fe60c3267`, so these are counts rather than a projection:

| | OFF | ON |
|---|---|---|
| suspendable functions | 1,489 | 1,489 |
| became state machines | 0 | **533** |
| still fibers | 1,489 | 956 |
| suspension points on frames | 0 | **753** |
| suspension points on fibers | 2,270 | 1,517 |
| function coverage | 0 of 1,489 (0%) | **533 of 1,489 (35.8%)** |
| suspension-point coverage | 0 of 2,270 (0%) | **753 of 2,270 (33.2%)** |

**The `2,270` denominator in the last row is DEFECTIVE: `33.2%` is not a
share of any defined population.** `2,270` is the count of emitted
`scr_await_*` call sites matching `(f64|bool|str|ref|void|dyn)` — the 2,325
emitted sites minus `hop` (54) and minus `dyn_value` (1) — which mixes
emitted call sites with IR suspension points and drops two suspending
libCalls for no stated reason. It is also **inflated by a defect**: 16
suspending nodes are emitted twice (6 functions, all outside the admitted
set), so 2,270 = 2,254 attributable emissions + 16. The correct denominator
is **2,260** IR suspension points (lane-independent), **2,254** await-kind
points (`awaitExpr` 2,223 + `awaitUnionExpr` 31), or **2,325** emitted await
call sites (C lane) — whichever question is being asked. Against 2,254 the
same numerator reads 33.4%. See `stackless-llvm-port.md` section 9, which
supersedes this row and the identical figure in `fe60c3267`.

These figures are also **stale as a statement of today's conversion**. The
denominator held: section 8b counts **1,301 resume functions and 188
trampolines on the same program, disjoint, 1,301 + 188 = 1,489** — the same
suspendable-function population this table used. The numerator has moved
three times: **533 (35.8%)** here, **990 (66.5%)** at 2026-10-06, and
**1,301 of 1,489 (87.4%)** at `90004bd0f`.

## 7. Not covered yet

Two bullets here were true when written and are **no longer true**; they are
corrected in place rather than deleted, because each was cited as a reason
not to look.

- ~~**Generators and async generators.** `ScrGen` is a separate handle with
  its own resume protocol; nothing here touches it.~~ **A SYNCHRONOUS
  generator is now lowered.** `scr_gen_coro_alloc` allocates a frame with no
  promise minted, `scr_gen_of_coro` wraps it in an `ScrGen` whose stored
  discriminant says FRAME rather than FIBER, and `scr_coro_yield_*` returns
  to the consumer without a ready push. An **async** generator still stays
  out, and **the reason printed here until 2026-10-10 was itself the wrong
  one**: it said the `yield` calls `scr_await_hop` inside
  `scr_agen_yield_settle` and "the hop is the one suspender this lane
  declares it cannot lower". `async.hop` is lowerable on both backends
  (`ir/suspends.ts`), and that hop is not an IR node, so no suspender
  analysis ever saw it. The real reason is that **this contract has no async
  half**: `scr_gen_of_coro` takes no settle thunk, the `scr_agen_*` consumer
  entries have no `SCR_GEN_BACKED_FRAME` branch, `scr_gen_coro_step` answers
  YIELDED/DONE/threw with no arm for a body parked on an `await`, and the
  frame yield arms settle no request promise. Enumerated with lines at the
  gate in `ir/liveness.ts`. **Reach of the sync-generator
  clause on app182 is ZERO and that is measured, not unknown:** all three of
  its remaining generator-family functions are async, so the adjudicator is
  generator-lane parity, never an app182 coverage delta.
- ~~**A `drop` hook** for abandoned-frame payload release (3.5) — still open
  **in `ScrCoroBase`**, which is where 3.5 needs it.~~ **NOT OWED, AND THAT IS
  MEASURED (2026-10-11).** This bullet read as an outstanding obligation; 3.5
  only ever made a CONDITIONAL offer ("if the codegen cannot discharge 3.5 on
  all paths") and nobody had measured the condition. It is false:
  `tests/harness/coro-abandon-parity.test.ts` carries a string, an array and
  an object across a suspension and out through all five paths a frame
  LEAVES by — reject-and-catch, fulfil, dropped consumer, unattached
  rejection, throw-before-first-await — and the RC audit is silent on every
  one. See 3.5 for the table, for why the 8 bytes understates the price (the
  hook would have no caller without a new frame registry), and for the parity
  sentence that was FALSE: an abandoned frame exits 99 where an abandoned
  fiber exits 0, in SCR_RC_AUDIT builds, on identical source. **What survives
  as open is nothing from 3.5.** A `drop` does exist one level up for
  generators (`scr_gen_of_coro(base, drop)`), for the different reason that an
  UNSTARTED generator can be released before its body ever runs; it is a
  handle parameter, not a frame field, and it costs the 40-byte base nothing.
- ~~**D4 lowering.** The fat frame exists and is sized, but no test drives a
  suspension inside a `finally`.~~ **Two files drive exactly that now.**
  `tests/harness/stackless-finally-body.test.ts` is shape (1), an `await`
  sited inside a `finally` body, and it carries the cost of that admission:
  a finally body is emitted once per completion path, so one plan point
  becomes up to three emitted states and the one-state-per-point equality
  the compiler used to assert became two inclusions plus a MEASURED
  multiplicity. `tests/harness/stackless-finally-stash.test.ts` guards the
  in-flight exception the body runs on top of (`sc_fexc_N`), which was
  emitted as a C automatic the resume `goto` jumped over. **The driver, not
  the construct, is the discriminator there:** an async resume re-enters
  along one fixed call path and tends to find the dead stack slot still
  holding the right pointer, so the await-only test stayed green over the
  whole life of that defect; a generator is resumed by the consumer from
  arbitrary depth and the fault is deterministic. And the fat frame is no
  longer only "sized": **76 of app182's 1,301 emitted frames are
  `ScrCoroExc`**, against zero on 2026-10-06 (section 3.6).
- **The island.** An embedded-JS call chain lives on the fiber's C stack and
  cannot be moved into a struct; those functions keep fibers. zapo-rest links
  no island, so this does not affect it.

## 8. Frame cost of the non-refcounted spill (2026-10-06; its table is re-measured in 8b)

`emitCoroAwait` spills the emitter's RC frames across a park, and `newTemp`
joined a temp to its frame only when it was refcounted. A `double` or a
`bool` evaluated before a nested suspension was therefore in no frame, was
never spilled, and came back indeterminate — the resume `goto` jumps over its
declaration and the resume function has already returned to the scheduler.
`newTemp` now registers every temp; `releaseFrame` asks `isRefCounted` before
writing a release, so ownership is unchanged.

**AND `newTemp` IS NOT EVERY TEMP (2026-10-10).** Seven expression kinds mint
their result WITHOUT it, because there is nothing to mint it from: a
`ternary`, `logical`, `nullish`, `orDefault`, `optChain`, `unionDisc` or
`unionKeyGet` slot is DECLARED before the arms and WRITTEN inside them. All
nine sites in `emit-exprs.ts` registered the slot `if (isRefCounted(...))`,
and the paragraph above is why that guard was wrong: the frames are the
spill register, not only the ownership register. So the same defect survived
this section by four days, one level up -- `f() ? 7 : 9` beside an await
answered 3.56684903562e-312, `f() && g()` answered false for a true, and a
shared-field `s.kind` answered 6.95216043700965e-310.

The spelling that caught it is the one nobody would look for. `await` of a
`T | PromiseLike<T>` lowers to a TERNARY, so TWO of them in one argument
list put the first one's result across the second one's park:
7470-promiselike-is-a-promise-slot answered `awaited 0 8` for `awaited 7 8`,
and `0` was an uninitialized stack read -- the next run answered
2.54639494916e-313, which is why the differential's `retry: 1` neither
absorbed it nor stabilised it. The LLVM lane was right throughout; only the
C lane was wrong, so llvm-differential caught it as a lane disagreement in
the same gate run that differential caught it as a node disagreement.

`CEmitter.registerTemp` is newTemp's rule for an already-declared slot and
all nine sites now use it. 7472-a-branch-result-crosses-a-suspension pins
one line per family that can carry a SCALAR result. `optChain`'s bind and
`unionKeyGet`'s result were recorded here as untestable because "both are
refcounted in every spelling anyone has constructed". **THAT REASON IS WRONG
IN BOTH HALVES (2026-10-10, measured by a marker emitted at each site and read
back out of the C).**

`unionKeyGet` answers at the JOIN of its arms' answers, and a join of ONE is
that type itself (`lowerUnionKeyedRead`: `joinArms.length === 1 ?
joinArms[0]!`). Two record arms that both declare `n: number`, read as
`u["n"]`, answer a bare `double`. It is now covered: 7472's `unionkeyget`
line prints `unionkeyget NaN` with that site's registration removed, and
`unionkeyget 11004` with it.

`optChain`'s bind is non-refcounted just as easily -- `number | null` narrows
to `f64`, `boolean | null` to `bool`, through `n?.toFixed(...)` and
`b?.toString()`. What makes THAT site inert is a different property, and it
is the one worth writing down: the bind's only reader is `chainRecv`, which
mints its own (registered, therefore spilled) temp, and that read is the
LEFTMOST evaluation in the chain body -- so the bind is dead before any park
the body can contain. MEASURED on `maybe(4)?.toFixed(await pf(0))`: with the
registration removed the program still answers `4.0`, and the only change in
the TU is one `double sc_tmp_sc_t3` frame field that is stored at the park,
reloaded after it, and never read. The registration is correct and inert;
7472's two `optchain` lines exercise the SHAPE and cannot go red for this
rule, which is said in the file so the next reader does not count them.

THE BYTE COST OF THIS SECOND HALF IS NOW MEASURED (2026-10-10, section 8b).
It is **10 fields across 8 of the 990 frames that already existed, 80 B** --
all of them `double` or `bool`, which is the class exactly. Attribution is by
field TYPE and the emitter's own `/* owned across a park */` comment, not by
bisect, so read it as "the branch-result class accounts for at most 0.5% of
the fields this program's frames gained since 2026-10-06", not as an isolated
arm.

THESE ARE STATIC BYTES PER FRAME STRUCT TYPE, SUMMED OVER THE DISTINCT
COROUTINE TYPES IN THE PROGRAM. They are **not** runtime occupancy: what a
run actually holds depends on which coroutines are instantiated and how many
are live at once, and that was not measured. Do not read +1.6% as a memory
number taken under load.

**Lane: C, by construction.** The instrument reads `} sc_cf_<name>;` out of
the emitted shared header and asks a C compiler for `sizeof` on each. The
LLVM lane emits no such struct — it computes its own frame layout (see
`backend/llvm/coro.ts`) — so this table cannot describe the SHIPPING
binary's frames, which are LLVM-lane frames. The one function measured on
both lanes, `hopTask`, is 88 B on the C lane and 64 B on the LLVM lane
(section 6a.1), so these are plausibly an over-estimate of the LLVM frames
for the same program; that is one data point, not a law.

Measured on the real load (`tests/perf/zapo-rest/app182`), knob ON, exact
`sizeof` from the C compiler rather than a layout model — a probe including
the emitted `.scrh` and printing `sizeof` for each `sc_cf_*`:

| | frames | total | mean | median | p90 | max |
|---|---|---|---|---|---|---|
| main `76ebc7ce4` (2026-10-06) | 962 | 80,016 B | 83.2 B | 72 B | 104 B | 3,856 B |
| + spill (2026-10-06) | 962 | 81,304 B | 84.5 B | 72 B | 104 B | 3,976 B |
| + spill + nesting `4e93997eb` (2026-10-06) | 990 | 84,528 B | 85.4 B | 72 B | **112 B** | 3,976 B |
| **re-measured `90004bd0f` (2026-10-10)** | **1,301** | **142,800 B** | **109.8 B** | **88 B** | **168 B** | **4,256 B** |

*The p90 of the third row read `104 B` from 2026-10-06 until 2026-10-10. It
is 112 B under every percentile convention; recomputed from that run's own
archived `sizes.txt`, which was never discarded. A transcription error, not a
measurement one — the other five cells of that row reproduce exactly.*

- The spill alone costs **+1,288 B, +1.6%**, and only **109 of 962 frames
  (11.3%)** grow at all — mean +11.8 B, worst +120 B (`sc_cf_route`). The
  median and p90 frame do not move.
- The arithmetic closes: the spill adds exactly 161 non-refcounted fields
  (117 `double`, 44 `bool`) and 161 × 8 = 1,288. The two arms were told apart
  by that content, not by trusting the checkout.
- Nesting adds **nothing** to the frames main already had; the further
  +3,224 B is entirely the 28 newly admitted functions (mean 115.1 B).

**120 of the 990 admitted bodies (12.1%) hold at least one non-refcounted
temp across a park, 183 of them in all** — as of 2026-10-06. **Re-measured on
2026-10-10 at `90004bd0f`: 214 of 1,301 (16.4%), 372 temps** (247 `double`,
125 `bool`). The 2026-10-06 figure was reproduced exactly, from that run's
archived header, by the script that produced the new one; a re-measurement
whose instrument cannot reproduce the value it is replacing is not a
re-measurement. That is the population the
alternative proposal — a fence listing non-lowerable argument POSITIONS —
would have had to cover, and it was costed at 6 functions / 16 points from a
predicate that turned out to be the wrong dimension. The clearest single
refutation is `bin`: `n1(8) * 1000 + await pf(3)` answered NaN, and the same
expression inside an index aborted outright, in a node that has no `args` at
all, so no argument-position rule would ever have reached it.

## 8b. Re-measured 2026-10-10, and the section's thesis inverted

The table in section 8 was taken on `4e93997eb` (2026-10-06). It is re-run
here on `90004bd0f` with the same instrument, the same entry and the same
arm (knob ON, `--backend c`), and the program itself is unchanged:
`git diff 4e93997eb..90004bd0f -- tests/perf/zapo-rest/app182` is empty, so
the app is the fixed workload and the compiler is the only variable.

**SCOPE FIRST, because this is a WINDOW and not a change.** 189 commits sit
between the two arms, 59 of them touching `packages/compiler/src` and 38
touching the emitter or the IR. The movement below belongs to the window.
**No part of it is attributed to any individual commit, because no
per-commit arm was built.**

| | 2026-10-06 `4e93997eb` | 2026-10-10 `90004bd0f` | delta |
|---|---|---|---|
| frame structs | 990 | 1,301 | +311 |
| total static bytes | 84,528 B | 142,800 B | **+58,272 B (+68.9%)** |
| mean | 85.4 B | 109.8 B | +24.4 B |
| median | 72 B | 88 B | **+16 B** |
| p90 | 112 B | 168 B | **+56 B** |
| max (`sc_cf_route`) | 3,976 B | 4,256 B | +280 B |

Where the +58,272 B comes from:

- **311 newly converted functions: +43,424 B (74.5% of the rise)**, mean
  139.6 B each.
- **708 of the 990 frames that already existed grew: +14,848 B (25.5%)**,
  mean +21.0 B. **None shrank.**
- Those 708 frames gained **1,864 fields, of which 1,854 (99.5%) are IR
  LOCALS (`sc_v_*`) and 10 (0.5%) are emitter temporaries (`sc_tmp_*`)**.
  Five fields were removed (`%spread`/`%uspread`/`%param` locals).
- The 311 new frames carry 3,665 fields: 50.6% IR locals, 27.5% emitter
  temporaries, 8.5% base, 8.5% the awaited promise, **2.1% the `finally`
  stash `sc_fexc_*` (77 of them, every one in a newly admitted body and none
  in the 990)**, 1.4% `sc_pret`, 1.4% a lifted closure env.

**So this section's question is no longer the section's answer.** Section 8
was written to cost the non-refcounted spill, and that cost was small and
narrow: +1.6%, 11.3% of frames touched, median and p90 unmoved. Measured over
the same 990 frames today, the emitter-temporary term is **0.5% of the fields
they gained**. The term that moved the table is **IR locals crossing
suspensions in functions the admission has widened to reach** — and the
median frame moved for the first time (72 -> 88 B) while the p90 grew by half
again (112 -> 168 B). A reader coming to section 8 for "what do frames cost"
should read this block, not that one.

**Conversion, counted from the same emission** (guard: a function has a
trampoline or a resume, never both — verified, the two name sets intersect in
**zero**):

| | count |
|---|---|
| frame structs `sc_cf_*` in the shared header | 1,301 |
| resume functions `sc_cr_*` | 1,301 |
| trampolines `sc_tr_*` (still fibers) | 188 |
| suspendable functions (1,301 + 188) | 1,489 |
| **C-lane function coverage** | **1,301 of 1,489 (87.4%)** |

Two controls, both of which could have come out red:

1. **The TU-split defect of section 6b stays closed.** 0 of the 1,301 frame
   structs are in a translation unit; all 1,301 are in `zapo-rest.scrh`, and
   the knob-ON C build LINKS (`ok: true`, 6.7 min, exe 33,214,464 B).
2. **1,301 is exactly the LLVM lane's PLANNED count** (section 6a.4: 1,292
   lowered of 1,301 planned). `coroPlans` is backend-agnostic, so both lanes
   receive the same plan set; the LLVM lane refuses 9 at its emitter tier and
   the C lane refuses none. The agreement is a consistency check on one
   shared source, not two independent measurements of the same thing.

*Instrument: `/g/blocks/w1-framesize.sh`, the same method as the script that
produced the 2026-10-06 table, with the runtime-source path taken from the
measuring worktree instead of a since-purged one. It reproduces the
2026-10-06 row's frame count, total, mean, median and max exactly from that
run's archived `sizes.txt` -- and disagrees with its published p90, which is
how the 104/112 transcription error in section 8 was found.*
