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
is abandoned and its payload is not released — exactly what happens to an
abandoned fiber today (`scr_fibers_abandoned`). If the codegen cannot
discharge 3.5 on all paths, the right fix is a per-function `drop` hook in
`ScrCoroBase`; that costs 8 bytes on every frame, so it is deliberately not
there yet. Ask for it rather than leaking.

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

Two binaries of the SAME program at `554d2fb65`, differing only in the lane
(`SCRIPTC_STACKLESS=0` vs the knob absent). Both are LLVM-lane builds (`.ll`,
no `.c`); 59 of 59 assertions pass on each arm and the transcripts are
byte-identical outside timestamp, pid and 2 ms. Instrument:
`PeakPagefileUsage` / `PeakWorkingSetSize` -- **kernel high-water marks read
out of process, not a sampled series** (a downsampled series cannot measure a
peak). Route `/s/alpha/store/threads?limit=20`, ABBA arm order, saturation
cell n=6.

| | fiber | stackless | ratio |
|---|---|---|---|
| peak private commit at saturation (62.9 concurrent chains) | 22.07 MiB | 13.92 MiB | **1.585x** (-37%) |
| private working set (plateau) | 14.82 MiB | 11.04 MiB | 1.342x |
| **marginal private commit per concurrent request** | 163.6 KiB | 41.8 KiB | **3.91x** |
| throughput at saturation | 8,629 rps | 8,933 rps | **+3.5%** |
| p50 at saturation | 6.995 ms | 6.701 ms | -4.4% |

The marginal row is a least-squares slope over C=0..64, the region where
achieved in-flight tracks offered 1:1 (R2 = 0.995 fiber, 0.996 stackless);
socket-corrected it is 4.01x. Worst within-cell spread in peak commit is
1.39%, against a 58.5% effect -- 42x the noise.

**Four things bound those numbers, and they matter as much as the numbers.**

1. **The 10.4x of 6a.2 does NOT transfer, not even as a marginal slope.**
   That figure is per CHAIN on a ladder whose chains carry almost no heap.
   This one is per CONCURRENT REQUEST, where lane-independent heap -- the
   parsed bag, the rows, the JSON string, the response buffer -- sits in the
   numerator AND the denominator. Different denominators, so the ladder
   number is not even an upper bound on this one by a safe argument.
2. **The ratio is not a constant of the lane, and it is not monotone in
   payload size.** Marginal KiB per request, C=0 vs C=64, n=2 per cell:
   404 **2.28x**, `/health` **1.92x**, threads-20 **3.96x**, threads-200
   **1.88x**. (threads-20 reads 3.96x here and 3.91x in the table above
   because this is a two-point slope and that one is least squares over seven
   cells; same data, different estimator.) The prediction that a LIGHTER
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
   cost: +1,586 B/socket fiber, +1,402 B/socket stackless, lane-independent
   as it must be.
4. **The +3.5% is a FLOOR on the throughput gain, not a ceiling.** The load
   generator shared the same 6-core box, so both arms were compressed by
   contention.

Not measured, and said rather than implied: WebSocket subscribers (the ack
window is O(1) by design), scaling in N sessions (that measures client/store
construction), `/connect` chains (needs the network), and startup latency
(lazy migration dominates).

### 6a.4 Reach on the real load

**1,292 of 1,301 planned coroutines lower** on app182, triangulated three
ways and cross-checked exactly against `scr_async_spawn` 1,488 -> 196
(1,488 - 1,292 = 196). The 9 refusals fall back to the fiber lane correctly.
This section recorded a reach of ZERO on real load before the then-adapter
ICE was fixed; the census has not moved since (predicted 1,297, measured
1,292, identical refusal set).

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
  out, and `ir/liveness.ts` records that the stated reason was the wrong one:
  its `yield` calls `scr_await_hop` inside `scr_agen_yield_settle`, and the
  hop is the one suspender this lane declares it cannot lower — so it
  belongs to the hop front, not to this one. **Reach of the sync-generator
  clause on app182 is ZERO and that is measured, not unknown:** all three of
  its remaining generator-family functions are async, so the adjudicator is
  generator-lane parity, never an app182 coverage delta.
- **A `drop` hook** for abandoned-frame payload release (3.5) — still open
  **in `ScrCoroBase`**, which is where 3.5 needs it. A `drop` does now exist
  one level up for generators (`scr_gen_of_coro(base, drop)`), for the
  different reason that an UNSTARTED generator can be released before its
  body ever runs; it is a handle parameter, not a frame field, and it costs
  the 40-byte base nothing.
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

## 8. Frame cost of the non-refcounted spill (2026-10-06)

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
`unionKeyGet`'s result stay UNTESTED and are named here rather than implied:
both are refcounted in every spelling anyone has constructed -- a narrowed
receiver payload is a record/object/array, a keyed read answers at a
join-typed union -- so no program can tell the two versions apart there.

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
