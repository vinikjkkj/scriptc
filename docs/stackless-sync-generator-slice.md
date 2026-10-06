# The synchronous-generator slice: what it is, and what it cost to write

Companion to `stackless-generators.md` (the measurement that scoped it) and
`stackless-generators-decisions.md` (the three decisions it implements).
This file records the SLICE -- the defects found while writing it, and the
rules that came out of them.

## 0. NOTHING HERE HAS BEEN BUILT

Read this before any claim below.

The slice is **twelve files and zero builds**. Every statement in this file
was reached by READING: the compiler has not run on it, no binary has been
produced, no test has been executed against it. Where something below is
called "fixed", it means the code was changed to match a reading. It does
not mean a run confirmed it.

That is not an aside. The largest unverified surface this front has had is
sitting on `coro/sync-generators`, and the first compile is expected to find
further defects of the classes described here. The predictions for that
build are in section 6, registered as predictions.

## 1. COUNTING AN ITEM IS NOT DOING IT

The four runtime entry points decision 1 opens -- `scr_gen_resume`,
`scr_gen_resume_return`, `scr_gen_resume_throw`, `scr_gen_release` -- were
counted up front, **named in two separate reports**, and then not written.
All four had zero references to the discriminant, and `scr_gen_coro_step`
had exactly one occurrence in the file: its own definition. A frame-backed
generator would have been driven as a fibre.

The instruction that produced the count was a good one and it did what it
was for: the items were not *discovered late*. It did not stop them being
*left undone*. **A named, counted item is worse than an unnamed one, because
nobody looks for it again** -- the count converts "to do" into "accounted
for".

**What caught it was auditing the DIFF against the list, not re-reading the
list.** Re-reading confirms an item is named; only the diff shows whether
code exists. The completion check is therefore mechanical: for each named
item, grep the diff for the symbol it should touch, and require a hit.

### The gap was a container

The four missing branches hid a leak nobody had listed. An UNSTARTED
generator can be released or returned-into before the body ever runs, and
the `+1` its parameters arrived with has to go somewhere. The fibre path has
`drop_args` for exactly this. A frame had **nothing** -- so every unstarted
frame-backed generator would have leaked its arguments, with **no crash and
no diagnostic**. It was found only because closing the other hole led
through it.

**RULE: a gap found probably contains another.** The audit therefore stops
on a clean pass *after a fix*, never on the first clean pass.

## 2. THREE INTERACTION DEFECTS

Found by reading ACROSS files, after the within-file audit was already
clean. None of the three is visible in any single file.

**One: the spawn would have run the body.** `emitCoroSpawns` iterates
`plans`, and generators entered `plans` in the same slice that opened
admission. Without a skip, both wrappers are emitted -- one returning
`ScrPromise *`, one returning `ScrGen *` -- and the promise one calls
`scr_coro_spawn`, **which runs the body**. The decision this slice is
proudest of, violated from the other side of the file, by a loop that did
not know generators had started existing. Neither file is wrong alone.

**Two: a `return` would have settled a NULL promise.** `emit-stmts.ts` calls
`coroFinish` at three return paths, and `scr_coro_finish_*` fulfils
`base->promise`, which decision 3 deliberately leaves NULL for a generator.
The dispatch now lives in ONE helper, so a fourth return path added later
gets the right behaviour by calling it, and a direct `coroFinish` becomes
visibly the odd case. That is structure rather than discipline.

**Three, exposed by fixing two: every completed generator leaked its
frame.** The release path freed an UNSTARTED frame and abandoned a SUSPENDED
one -- deliberately, as the fibre lane abandons a stack -- and a DONE frame
fell into the abandoned arm. That is the **common** path: every generator
consumed to exhaustion ends there. No crash, no diagnostic.

Second instance of a gap containing another, in one session.

## 3. THE CONSUMER RULE

The class behind defect one is general, because **every slice on this front
widens an admitted set** -- D1, `return`, `try`, `boxedParam`, generators,
D4 -- and each widening hands new members to every existing consumer, which
is running code written when that member could not exist.

**The cheap test: for each consumer, ask WHAT IT BRANCHES ON.**

| branches on | exposure | evidence from this slice |
|---|---|---|
| a **property** (`fn.generator`, `fn.async`, the backend) | safe | the LLVM gate and `emit-async.ts:19` survived untouched |
| **set membership** | exposed | `emitCoroSpawns` broke; a second site would have |

This replaces "enumerate every consumer and verify it" -- expensive and
vague -- with one binary question per consumer.

**And membership is not always wrong.** `emit-async.ts:23` tests membership
and is correct **by construction**: a line above it skips every generator,
so it can only ever see the set it means. The sharp form is:

> Membership is wrong when the set it tests can gain a member the body is
> not written for.

Without that qualifier the rule condemns correct code and gets abandoned the
third time it cries wolf.

### It prevented one, a slice before it would have fired

Classifying the branches this slice added: nine test a property, one tested
membership -- the route into `emitGenCoroSpawn`. The moment the hop front
admits async generators, an async one arrives there and receives the
**synchronous** spawn: no promise, no settle thunk, nothing an async
consumer needs. Defect one again, armed in the code written while fixing
defect one. Now guarded on `!fn.async`.

That is the first rule from this session that **prevented** rather than
explained. Everything else was retrospective: measure after the red, retract
after the citation, audit after the writing.

## 4. THE SPAWN DOES NOT RUN THE BODY

`emitCoroSpawns` ends with `scr_coro_spawn`, which satisfies INV-2: an async
function runs synchronously up to its first suspension, so one that never
awaits has already settled by the time the spawn returns. **A generator is
the opposite, and JS is explicit about it**: calling a generator function
runs NOTHING; the body starts at the first `.next()`.

The note sits as a comment at the emitted return, because this is exactly
the kind of thing a later reader "fixes" into existence while making the two
spawns look alike.

**And the divergence would be invisible in any test whose generator has no
side effect before its first yield.** That is why it is a comment at the
site and not a line in a design document.

## 5. SPLIT-TU: CLOSED, WITH ONE NAMED RESIDUE

Three questions, all answered by reading.

**How the shared header reaches each unit.** It is emitted once, and says so
itself: *"The shared declarations of a program emitted as N translation
units. Every unit includes this and nothing else of the program."* Built
from `prologue.slice(1)` -- the includes without a second banner -- followed
by `hdr`.

**What links a generator spawn across units.** `E.decl` is three lines and
routes into `hdr` exactly when `link === ""`, which is the split case. The
frame struct, the resume forward declaration, and the spawn and drop
prototypes all land there. Spawn, resume and frame may fall in three
different units and are bridged by the header in all three cases.

**Whether `sc_gen` is a new exposure class.** It is not. The 533-struct bug
was the **struct** being routed to the wrong output; a **field inside a
correctly-routed struct** travels wherever the struct travels. `protoOut`
does not see fields.

**RESIDUE, NOT DETERMINED:** the identity of `prologue` at the splice site
against the TU preamble built earlier was traced **by comment, not by data
flow**. If those ever diverged, the header would lose the conditional
`#include "scr_coro.h"` while the TUs kept it.

## 6. PREDICTIONS FOR THE FIRST BUILD

Registered before the run, so that no outcome can be rationalised after it.

**`EXPECTED_CONVERSIONS` = 1 per parity program.** Derived, not measured:
one generator per program, one resume function per converted generator.

- **0** -- nothing converted. Look at `stacklessPlan`'s `syncGenerator`
  path, not at the lowering.
- **1** -- the reading was right, and parity compares two real lowerings for
  the first time.
- **more than 1** -- I misread what one program emits.

**Parity: expected to pass.** A failure *with* conversions at 1 is the most
valuable result available: it means the lowering is present and wrong, which
is precisely what the guard was built to catch.

**The poison control: expected to pass, and least trustworthy if it does.**
It passed before generators converted, so a green could be the fibre path
still being poisoned rather than the new one. The conversion count must be
non-zero **in the same run** before that green means anything.

**Compile errors: expected.** In the runtime and emitter interaction, not in
the LLVM lane -- that lane consults the admitted set in zero of its ten
files and is gated on `backend === "c"`.

### Three conditions to stop and report rather than fix

1. A **link** error naming `scr_coro_state_in` or `scr_coro_state_out` -- a
   split or guard interaction, not a typo.
2. Anything in `scr_coro.c` beyond the extraction -- shared infrastructure,
   and a surprise there is a different conversation.
3. The knob-**absent** byte-identity test reddening. Everything in this
   slice is meant to be invisible with the knob off; if it is not, the slice
   has stopped being additive, and that is a decision rather than a patch.
