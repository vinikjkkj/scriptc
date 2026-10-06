# The five generator decisions, resolved

Companion to `stackless-generators.md`, which measures the family. This file
resolves the decision list that file's S11 left open, so the synchronous slice
can start against choices that have been made rather than against five that
have not.

**Everything here is from reading.** No build was run: a gate was in flight
throughout. Where a conclusion needs a build, it says so and says what the
build would change -- in one case it changes the priority and not the choice,
which is worth more than a deferral.

## 0. THE FILTER, APPLIED FIRST

The lesson from the native sink is that a taxonomy question presupposes its
subject belongs to the category the taxonomy partitions, so the presupposition
gets tested before the question. Two of the five do not survive it.

| # | was | is |
|---|---|---|
| 1 | the handle: one discriminated `ScrGen`, or two types | **a real decision. Closed, three reasons** |
| 2 | the resume's return protocol | **DISSOLVED -- it presupposes a resume answers by return value. It does not** |
| 3 | who owns the yielded value | **NOT INDEPENDENT -- decided by 1** |
| 4 | who maintains the exception cell at a mixed boundary | **a real decision. Decidable now; a build changes only its priority** |
| 5 | does a sync generator sit on `ScrCoroBase` | **a real decision. Recommended** |

**Five became three.**

## 1. THE HANDLE -- one discriminated `ScrGen`. Closed.

Recommended: **one `ScrGen`, carrying a stored discriminant**, never two handle
types.

Three independent reasons, and the third is new:

1. **Drift.** Two handle types double the consumer emission and reintroduce
   exactly the one-place-updated-and-not-the-other shape `ir/suspends.ts`
   exists to prevent.
2. **A C file outside the compiler would have to discriminate.** The native
   sink (`stackless-generators.md` S10c) is a third consumer of `ScrGen`,
   written in `scr_stream.c`, which knows nothing about lowering and has no
   reason to learn.
3. **21 of 31 `ScrGen` entry points are already backend-agnostic.** Measured
   by reading every declaration in `scr_runtime.h` that takes a `ScrGen *` and
   classifying each body: **10 reach the fiber, 21 touch only `ScrGen`'s own
   slots and state.** The IN/OUT/RET slots live in the handle, not in the
   fiber, so they are indifferent to how the body suspends. Two handle types
   would duplicate 21 indifferent functions in order to serve 10 that are not.

The discriminant is **stored, never inferred**, because that is already this
codebase's rule -- `SCR_CORO_HAS_EXC` says so in its own comment: *"A variant
discriminated only by convention is a shape this codebase has already been
bitten by, so the discriminant is STORED."*

### WHAT THIS CHOICE OPENS, which was on nobody's list

**The discriminant's blast radius: 10 of 31 entry points must branch.**

```
scr_gen_resume        scr_agen_next           scr_agen_next_native
scr_gen_resume_return scr_agen_return         scr_agen_return_native
scr_gen_resume_throw  scr_agen_throw          scr_agen_throw_native
scr_gen_release
```

Nobody had counted this, and it is the honest cost of the recommendation. The
good news is in the same measurement: the other 21 need nothing, which is the
single biggest reason this is cheaper than it looked. Six of the ten are the
async entry points, and those are behind the hop anyway -- so the SYNC slice
pays for **four**: the three `scr_gen_resume*` and `scr_gen_release`.

A second opened item, smaller and unconditional: the trampoline derives the
handle with `scr_gen_of_fiber(sc_self)` (`emit-async.ts:202`). A stackless
generator has no fiber to derive it from, so that line changes **whichever**
handle option is chosen. It is mechanical, and it belongs on the mechanical
list rather than here.

## 2. THE RESUME'S RETURN PROTOCOL -- DISSOLVED

The item read *"widen `ScrCoroParkKind` to three answers, or an out-param"*.
It presupposes that a resume answers its caller by return value. It does not,
and the premise is false in two separate places.

- **`ScrCoroResume` is `typedef void (*)(ScrCoroBase *self)`.** A resume
  function returns nothing at all.
- **`ScrCoroParkKind` is returned by `scr_coro_park`, not by a resume**, and
  it is not a control-flow answer. Its own doc: *"Both mean 'you are
  suspended; return to the scheduler now' -- JS's await always yields, even on
  a settled operand. The distinction is the push accounting, returned so a
  test can assert it rather than infer it."* Widening it to three would put a
  control-flow answer inside an accounting observable.

The parked-versus-finished answer is **already a stored flag**:
`SCR_CORO_SUSPENDED`, set by `scr_coro_park` before either arm, cleared by
`scr_coro_resume_entry` before each re-entry and read after, *"to tell
'suspended' from 'fell out of the body', which are the two ways a resume
function can return and which need opposite handling."*

So "yielded" is a **third stored flag** -- `SCR_CORO_YIELDED` -- following a
pattern the codebase has already chosen and justified. There is nothing to
decide. It joins the mechanical list.

This is the same shape as `coroPlans`: an item that looked like a decision
only because nobody had read how the existing one works.

## 3. WHO OWNS THE YIELDED VALUE -- determined by decision 1

Not independent, so not a decision.

The native sink reads the value straight out of the handle --
`scr_gen_take_out_ref(g)` -- from C, with no knowledge of frames, and the
contract says that is deliberate: *"OUT already holds the yielded value and
`scr_gen_done()` already says whether it was the last."* If the yielded value
moved into the frame, `scr_stream.c` would have to reach into a frame layout
owned by the compiler.

So choosing one discriminated `ScrGen` (decision 1) decides this: **OUT stays
in the handle.** It is one of the 21 indifferent entry points and it stays
indifferent. Two decisions were one.

## 4. THE EXCEPTION CELL AT A MIXED BOUNDARY -- decidable now

Recommended: **`scr_gen_switch_in` saves and restores the ACTIVE CELL
directly, instead of deriving it from fiber identity.**

The hazard is `stackless-generators.md` S6: the function restores the cell
with `scr_exc_swap_cell(me != NULL ? &me->exc : NULL)` where
`me = scr_current`, and `scr_coro.c` never touches `scr_current`.

Two options, and they fail differently:

| option | failure mode |
|---|---|
| (a) the stackless lane maintains `scr_current` | the lane impersonates a fiber it is not. Any future path that forgets to set it restores a cell chosen by a stale pointer -- **silent, and only in mixed programs** |
| (b) save `scr_exc_current_cell()` before the switch, restore after | the dependency on fiber identity is **removed**, not satisfied. Local to one function |

**(b), by failure mode.** It fails high and near: if the save/restore is
wrong, it is wrong on every generator resume, including the pure-fiber ones
that exist today, so it reddens immediately rather than only once a mixed
program exists. (a) fails low and far -- correct until the first path forgets,
and then wrong only in the configuration nobody tests yet. (a) is also the
"discriminated by convention" shape this codebase has already named as a
repeat offender.

**The build changes the priority, not the choice.** Whether the hazard
manifests decides whether this is urgent or merely owed; it does not make (a)
better. Recording that distinction is the point: a deferral would have implied
the choice was blocked, and it is not.

## 5. DOES A SYNC GENERATOR SIT ON `ScrCoroBase` -- yes, one base

Recommended: **one base type, `promise` left NULL, with separate spawn and
finish entry points.**

The premise is true -- a sync generator needs no promise -- but it carries
less than it appears to. Of `ScrCoroBase`'s six fields it needs **five**:

| field | needed by a sync generator |
|---|---|
| `resume` | yes |
| `als` | **yes** -- see below |
| `state` | yes |
| `flags` | yes |
| `rc` | yes |
| `promise` | no (8 bytes of 40) |

`als` is the one worth checking rather than assuming, and it is needed:
`scr_switch` repoints ALS on **every** switch, the generator yield included
(`scr_als_active = to_fiber ? &to_fiber->als : &scr_als_main_slot`), and the
generator fiber captures its own context at creation. The fiber mechanism
carries ALS for free; a state machine does not, which is exactly why
`scr_coro_resume_entry` installs it explicitly. A stackless sync generator
owes the same install.

So a second base type would exist to save **8 bytes of 40** and would cost a
**second implementation of INV-5** -- the ALS and exception-cell bracket.
That is the decisive asymmetry: two INV-5 sites that drift means a sync
generator silently loses its ALS context on resume, and this codebase already
ships a named regression knob for that precise bug
(`SCR_CORO_ALS_BLIND`), which is evidence it is a failure someone expected to
be silent. Fails low and far. One base with a NULL promise fails nowhere; it
wastes 8 bytes per live sync-generator frame.

The split is honest about what is NOT shared: `scr_coro_init` takes a promise
and `scr_coro_spawn` returns one, and `scr_coro_finish_*` settle one. A sync
generator settles nothing, so **the base is shared and the spawn and finish
are not**. Sharing the base is not the same as sharing the lifecycle.

## 6. Chaining, and the resulting size

**What chains:** 3 is decided by 1. Nothing else does -- 4 and 5 are
independent of each other and of 1, which is why they can be settled in any
order.

**What a choice opens:** only decision 1 opens anything, and it opens two
items (above). Decisions 4 and 5 open nothing; both are local.

### The synchronous slice

| | |
|---|---|
| admissible functions it buys | **24 on the corpus, 0 on app182** |
| real decisions remaining | **3, all three with a recommendation** |
| decisions dissolved by reading | **2** |
| mechanical items | **7** -- the five in `stackless-generators.md` S11, plus `SCR_CORO_YIELDED`, plus the `scr_gen_of_fiber` derivation |
| runtime entry points that must branch | **4** for the sync slice (10 overall, 6 of them async and behind the hop) |
| runtime entry points needing nothing | **21 of 31** |
| emission | the three cases: 183 lines in `emit-exprs.ts`, plus three LLVM twins |
| blocked on another front | **nothing** -- the hop blocks the 18 async, not these 24 |

The honest shape of it: the slice is **three recommended decisions, seven
mechanical items, four runtime branches and one emission case that already has
a working twin**, and the biggest single reason it is that small is that 21 of
the 31 handle entry points never learn there are two kinds of generator.

## 7. NOT DETERMINED

- Whether the S6 `scr_current` hazard manifests. Decision 4 does not wait on
  it; the priority does.
- The frame size of a sync generator, and whether a yield point ever needs the
  fat frame. A yield is not an await, and the D4 condition is about an
  exception in flight, so the answer is probably "lean" -- but that is
  reasoning, not a census, and it is not asserted.
- Whether the 24 survive **emission**. Everything here is admissible.
- The exact line count of the four `scr_gen_*` branches. Counted as entry
  points, not as lines.
