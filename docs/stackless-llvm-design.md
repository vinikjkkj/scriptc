# Designing the coro lowering for the LLVM lane

**Status: design, not implementation. Nothing here has been compiled.**

Companion to `stackless-llvm-port.md` (the parity inventory, the options and
their costs) and `stackless-d4-work.md` (what D4 is). This file answers the
five hard questions about *how* the lowering would be built, and every answer
is read out of `packages/compiler/src/backend/llvm/` rather than inferred
from the C side. Line numbers are against main at the time of writing.

Three labels are used throughout and they carry the whole verdict:

- **MECHANICAL** -- a counterpart exists in the LLVM emitter and already runs.
  This is translation, and its risk is typos.
- **DECISION** -- no counterpart exists. Somebody chooses, and the choice has
  consequences worth naming before it is made.
- **NOT DETERMINED** -- could not be settled by reading. Marked rather than
  guessed, because reading the runtime pointed the wrong way twice in the
  session that produced this file.

## 0. Why this is the gap that matters

LLVM is the CLI's **default** backend. Stackless is a capability of the C
emitter only. So the 84.3% of functions and 76.5% of points currently
admitted, and the 99.8%/99.6% ceiling D4 would unlock, all apply to a lane
the CLI does not choose by omission. `index.ts:790` is the line that makes it
so, and section 6 is about removing it safely.

## 1. The frame -- MECHANICAL, with an exact precedent

In C the frame is an emitted struct, one per coroutine. The LLVM emitter
already does exactly this, for exactly this reason, and the construct is the
**argument pack** of the fiber path:

```
emitter.ts:2705   %<pack> = type { <field types> } ; <fn> args
emitter.ts:2706   ptrtoint (ptr getelementptr (%<pack>, ptr null, i32 1) to i64)
emitter.ts:2723   %fp<i> = getelementptr inbounds %<pack>, ptr %ap, i64 0, i32 <i>
emitter.ts:2819   %sp<i> = getelementptr inbounds %<pack>, ptr %ap, i64 0, i32 <i>
```

That is a **per-function generated aggregate type**, addressed by **typed
GEP**, and sized by the `ptrtoint getelementptr(null, i32 1)` idiom. The coro
frame is the same construct with a different field list:

```
%<frame> = type { %ScrCoroBase, <params>, <live locals>, ptr }
```

So the frame needs no new mechanism. Two differences from the C lane, both
in the LLVM lane's favour:

- the C lane's `protoOut` / `E.link` / `stripStatic` placement problem does
  not exist, because the LLVM lane never splits a translation unit
  (`programUnits` is C-only). That placement bug is what stopped the first
  split C build from compiling at all.
- field access is a typed GEP from the start, so a field cannot be addressed
  at the wrong offset by arithmetic.

**Scale, and it is NOT DETERMINED.** app182 would generate roughly 990 frame
types (the emitted C generates that many frame structs). Its `.ll` is already
229,342,779 bytes. The effect of ~990 further named aggregate types on `.ll`
size, on `llc` time and on link time was not measured and cannot be read off
the source.

## 2. The dispatch -- MECHANICAL, and simpler than the C lane

Counted in the LLVM backend:

| construct | emissions |
|---|---|
| `switch i<N>` | **18** |
| `indirectbr` | **0** |
| `blockaddress` | **0** |

So the emitter uses `switch` for every multi-destination construct it has,
and has never needed a computed branch. Existing precedents, all the same
shape as a state dispatch:

- `dyn.ts:2809` and `emitter.ts:3761` -- union arm dispatch, `switch i32 <tag>, label %<bad> [ i32 <i>, label %<arm> ... ]`
- `dyn.ts:3047`, `dyn.ts:3319`, `dyn.ts:4256` -- dyn kind dispatch over `DK.*`

The coro dispatch is literally that form:

```
switch i32 %state, label %<abort> [ i32 1, label %sc_S1  i32 2, label %sc_S2 ... ]
```

**The LLVM lane needs the switch alone where the C lane needs a switch AND a
goto per arm**, because the switch's targets are basic blocks. And the C
lane's precondition -- *the local declarations must dominate every label* --
is structural here: `BlockBuilder.entryAllocas` renders into the entry block,
so every block is dominated by every alloca by construction.

## 3. The spawn wrapper -- MECHANICAL, and it is the same place

`emitAsyncScaffolding` already emits, per async function: the argpack type,
a fiber trampoline, and a spawn wrapper that call sites and closures enter
through. The trampoline is

```
emitter.ts:2717   define internal void @<trampoline>(ptr %self, ptr %ap) #<attrs> {
emitter.ts:2824   %p = call ptr @scr_async_spawn(ptr @<trampoline>, ptr %ap)
```

-- an internal definition with a pointer parameter, **taken by address** and
handed to the runtime. The resume function is that shape with one parameter:
`define internal void @<resume>(ptr %sc_b)`, address passed to
`scr_coro_alloc`.

This matters beyond shape. The spawn wrapper is where the boxed-param
blocker was resolved on the C lane for **zero new frame bytes** -- the box is
built by the wrapper, which runs once on the caller's stack, instead of by
the body, which cannot. That same place exists here, so the same resolution
is available rather than needing reinvention.

## 4. `ScrCoroBase` / `ScrCoroExc` / `ScrExcCell` -- mostly MECHANICAL, one DECISION

The type-declaration block (`emitter.ts:1915-1963`) is a list of hand-written
field lists, with a comment stating the contract: they *"mirror
scr_runtime.h field-for-field"*, and naming the hazard -- *"a missing field
would shift every capture read as well as being a write past the object."*
`%ScrClosure = type { i64, ptr, i64, ptr, ptr }` is one line in it. Adding
the coroutine types is the same edit.

**But the emitted code does not address all three equally, and that narrows
the work.** Reading `emit-coro.ts`, emitted code touches exactly two fields:
`base->state` and `base->flags`. The exception cell is never read or written
by emitted code -- the runtime owns it entirely (`scr_coro_exc`,
`scr_exc_swap_cell`, both called from `scr_coro.c`). So:

- `%ScrCoroBase` needs a **correct field list**, because `state` (offset 24)
  and `flags` (offset 28) are addressed through it.
  `{ ptr, ptr, ptr, i32, i32, i64 }` = 40 B, matching the header's own tally.
- `%ScrCoroExc` needs only a **correct size**, because the fat frame embeds
  it and `sizeof` must be right. Its fields are never addressed.
- `ScrExcCell` likewise matters only for that size. Read from
  `scr_runtime.h:2792`: `{ ScrExcKind kind; double f64; bool b; void *payload;
  retain_fn; release_fn; trace_fn }` -- seven fields, which on LP64 pad to
  **56 B**, matching `scr_coro.h`'s stated `40 + 56 = 96`.

**DECISION: how the fat frame gets its size.** Three ways, and they differ in
what can go wrong silently:

1. Declare `%ScrExcCell` field-for-field and `%ScrCoroExc = type { %ScrCoroBase, %ScrExcCell }`. Most faithful; adds a seven-field hand-copy whose only consumer is a size.
2. Declare `%ScrCoroExc = type { %ScrCoroBase, [56 x i8] }`. One number, and it is the number the header already states -- but it is a hardcoded 56 with no compiler checking it.
3. Have the runtime export the size and call for it. No hand-copy at all; costs a call or a global, and is the only option where C's own `sizeof` is the authority.

**And a DECISION that section 5 of `stackless-llvm-port.md` already argues:**
these should be the first entries added to `RUNTIME_FIELD_OFFSETS`, so
`runtime-layout.test.ts` proves `state` and `flags` against the real
toolchain. `runtime-layout.ts` records that eighteen struct bodies are
declared by hand in this emitter with **none** checked; a wrong offset on
`state` is silent corruption of coroutine state, which resumes at the wrong
label rather than crashing.

## 5. The hard part, and the only open DECISION

An SSA value that crosses a park. A park is `ret void`, so the resume block
is entered from the dispatch and nothing defined before the park dominates
it.

Sized on app182 (liveness-derived -- ceiling on reach, floor on work):
**1,676 of 1,728 admissible points (97.0%)** are not nested in an expression,
so the crossing set is empty by construction for them; **41 of 1,099
admissible functions (3.7%)** carry a nested point.

The options and their costs are tabulated in `stackless-llvm-port.md`
section 4: C-prime (refuse nesting in slice 1, 0 sites, reaches 1,058 of
1,099 functions), A (spill at the single `emitExpr` choke point,
`llvm/emitter.ts:5303`, 1 site, reaches all), B (**barred** -- reproduces a
known C-lane defect), D (type `BlockBuilder.tmp()`, 1,480 sites, dominated by
A).

**Why this is a decision and not a blocker: the failure is loud.** An
unspilled value used after a resume label does not dominate its use and the
verifier rejects it at build time. The identical mistake on the C lane was a
segfault found by three rounds of cutting a program down.

**NOT DETERMINED:** whether a statement-root await genuinely leaves zero live
SSA values *in this emitter's own emission order*. The argument is
structural -- the await is the root of its statement, so no operand is
materialised across it -- but it was not compiled, and the emitter's
evaluation order is not something this file read exhaustively. **This is the
one question that only a build answers**, and it is the same build already
queued for the D4 rung-(a) probe: compile one admitted function with a
coroutine lowering stubbed in and see whether the verifier accepts it.

## 6. The door, and the order it comes out in

```
index.ts:790    coro: backend === "c" && coroPlans(mod.functions).size > 0,
```

That conjunct is **correct today**: without it, an LLVM build with the knob
on links `scr_coro.c` into a `.ll` that calls nothing in it -- 4,608 dead
bytes and a link line that disagrees with the emitted TU, which is the
failure `cc.ts` names at `coreRuntimeSources`. Deleting it before the
lowering exists reintroduces exactly that.

What must be true before it goes, in order:

1. `%ScrCoroBase` declared with `state` and `flags` pinned in
   `RUNTIME_FIELD_OFFSETS`, and the fat frame's size resolved by one of
   section 4's three options.
2. Frame type, spawn wrapper, resume definition, dispatch, spill/reload,
   park, and finish/unwind emitted on the LLVM lane. The twelve
   `scr_coro_*` declares come pre-guarded: `scr_coro.h` is already in
   `llvm-runtime-abi.test.ts`'s `HEADER_FILES`, and every entry point is an
   exported symbol -- the header has no `static inline`, so no `_v` twins
   are needed.
3. The LLVM lane consults `coroPlans`. It lives in
   `backend/emission/emit-coro.ts` today; either it moves to `ir/`, or the
   LLVM emitter imports it across backends -- for which precedent exists,
   since `llvm/emitter.ts` already imports four modules from
   `backend/emission/`. Low-stakes **DECISION**.
4. The value guard and the cross-lane scan cover the LLVM lane. Both live in
   `tests/harness/stackless-values.test.ts`, which today builds two C arms.
5. **Only then** delete `backend === "c" &&`.

## 7. Slice or project

| piece | verdict |
|---|---|
| frame type, per function | MECHANICAL -- argpack precedent |
| dispatch | MECHANICAL -- 18 `switch` precedents, simpler than C |
| spawn wrapper, resume definition | MECHANICAL -- trampoline precedent |
| spill / reload | MECHANICAL -- every local is already an alloca |
| finish / unwind, the 12 declares | MECHANICAL -- pre-guarded by the ABI test |
| `%ScrCoroBase` field list | MECHANICAL, one line |
| the fat frame's size | **DECISION**, three options, section 4 |
| offsets pinned or not | **DECISION**, argued yes |
| `coroPlans` moves or is cross-imported | **DECISION**, low stakes |
| SSA values across a park | **DECISION**, four costed options, section 5 |

**Nothing is absent.** The new work is four emission functions and one to
three type declarations, against an emitter that already has every mechanism
each one needs. On that evidence this is a **slice-sized port with one real
open decision** -- which spill strategy -- rather than a project.

That conclusion is **conditional on section 5's unknown**. If a
statement-root await turns out to leave live SSA values in this emitter's
order, option C-prime stops being free and the port acquires option A's cost
up front. That is the single question whose answer could change the verdict
in this table.

## 8. Not determined by reading

- Whether a statement-root await leaves zero live SSA values in this
  emitter's emission order (section 5). The one build that matters.
- The effect of ~990 generated aggregate types on `.ll` size, `llc` time and
  link time (section 1).
- Whether the resume function needs anything beyond the existing `FN_ATTRS` /
  `attributes #0 = { sanitize_address }` applied to the trampoline.
- Whether the LLVM lane's `scopes` / `frames` unwind machinery emits the
  right releases when a body returns at a park rather than at its end. The C
  lane needed `coroUnwind` and `releaseForJump` care here; the LLVM
  equivalent was not traced.
- Whether LLVM's struct layout of a hand-declared `%ScrExcCell` matches C's
  byte-for-byte. Only relevant under section 4's option 1, and only for a
  size.
- Everything about scale and timing. This file reads source; it measures
  nothing that requires running the compiler.
