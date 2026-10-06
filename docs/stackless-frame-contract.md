# The stackless frame contract

What the runtime provides, and what emitted code owes it. Written so the
codegen side can be built without asking the runtime side anything.

Runtime: `packages/runtime/src/scr_coro.{h,c}`, plus a support block in
`scr_async.c` (search `stackless coroutine support`).
Proof it behaves like a fiber: `tests/perf/corostate/` (`run.sh`).

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

Measured on zapo-rest: D1–D3 is 95.1% of 2,260 suspension points.

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
max 208 B of payload -- lower bounds. The worked example in
`tests/perf/corostate` (`resolveDisallowedListEntries`) is 64 B of payload by
liveness, so at least 104 B with the base.

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
peak that is ~1.1 ms, against the ~504 ms that replacing `CreateFiberEx` with
`calloc` already saves. The pool would buy 0.2% of what the transform itself
wins, in exchange for a cap, a decay policy, and the retention and poisoning
problems the fiber pool needed several commits to settle.

**Decision: no frame pool.** Revisit only if a profile shows frame allocation
above a few percent of run time; the number to beat is 46 ns.

---

## 6. Speed, for context

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

---

## 6b. OPEN DEFECT: the frame struct does not survive a TU split

Measured on a real `zapo-rest` build with `SCRIPTC_STACKLESS=1`, `--backend c`:
the emitted C **does not compile**.

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

What the conversion would have been, had it linked (counted from the emitted
C, guard: a function has a trampoline or a resume, never both):

| | OFF | ON |
|---|---|---|
| suspendable functions | 1,489 | 1,489 |
| became state machines | 0 | **533** |
| still fibers | 1,489 | 956 |
| suspension points on frames | 0 | **753** |
| suspension points on fibers | 2,270 | 1,517 |
| function coverage | 0% | **35.8%** |
| suspension-point coverage | 0% | **33.2%** |

## 7. Not covered yet

- **Generators and async generators.** `ScrGen` is a separate handle with its
  own resume protocol; nothing here touches it.
- **A `drop` hook** for abandoned-frame payload release (3.5).
- **D4 lowering.** The fat frame exists and is sized, but no test drives a
  suspension inside a `finally`.
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

THESE ARE STATIC BYTES PER FRAME STRUCT TYPE, SUMMED OVER THE DISTINCT
COROUTINE TYPES IN THE PROGRAM. They are **not** runtime occupancy: what a
run actually holds depends on which coroutines are instantiated and how many
are live at once, and that was not measured. Do not read +1.6% as a memory
number taken under load.

Measured on the real load (`tests/perf/zapo-rest/app182`), knob ON, exact
`sizeof` from the C compiler rather than a layout model — a probe including
the emitted `.scrh` and printing `sizeof` for each `sc_cf_*`:

| | frames | total | mean | median | p90 | max |
|---|---|---|---|---|---|---|
| main `76ebc7ce4` | 962 | 80,016 B | 83.2 B | 72 B | 104 B | 3,856 B |
| + spill | 962 | 81,304 B | 84.5 B | 72 B | 104 B | 3,976 B |
| + spill + nesting | 990 | 84,528 B | 85.4 B | 72 B | 104 B | 3,976 B |

- The spill alone costs **+1,288 B, +1.6%**, and only **109 of 962 frames
  (11.3%)** grow at all — mean +11.8 B, worst +120 B (`sc_cf_route`). The
  median and p90 frame do not move.
- The arithmetic closes: the spill adds exactly 161 non-refcounted fields
  (117 `double`, 44 `bool`) and 161 × 8 = 1,288. The two arms were told apart
  by that content, not by trusting the checkout.
- Nesting adds **nothing** to the frames main already had; the further
  +3,224 B is entirely the 28 newly admitted functions (mean 115.1 B).

**120 of the 990 admitted bodies (12.1%) hold at least one non-refcounted
temp across a park, 183 of them in all.** That is the population the
alternative proposal — a fence listing non-lowerable argument POSITIONS —
would have had to cover, and it was costed at 6 functions / 16 points from a
predicate that turned out to be the wrong dimension. The clearest single
refutation is `bin`: `n1(8) * 1000 + await pf(3)` answered NaN, and the same
expression inside an index aborted outright, in a node that has no `args` at
all, so no argument-position rule would ever have reached it.
