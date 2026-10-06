# The generator exclusion, measured

Companion to `stackless-llvm-port.md` (the admissible set and the ceiling),
`stackless-d4-work.md` (the `finally` family) and `stackless-frame-contract.md`
(the runtime contract). Referenced by link, never merged, so the set stays
disjoint.

This file exists because the user put generators **in scope**: the target is
no longer 99.8% / 99.6%, it is 100%. The first question of any such move is
not how to build it but whether the reason it was excluded was ever measured.
It was not.

## 0. NEITHER POPULATION IS THE SHIPPING LANE

Read this before any number below.

Every figure is reported twice, on `tests/perf/zapo-rest/app182` and on the
**244-dump test corpus**, and the two disagree about this family more sharply
than about anything this front has measured. The corpus **over**-weights
generators exactly as hard as app182 **under**-weights them: a test corpus has
files named `2010-generators-basics`, and a WhatsApp REST service has two
async generators in 10,195 functions.

`app182` is the shipping lane. The corpus is not a forecast of it, and this
file never treats a corpus number as one.

Every figure is also **admissible**, from the IR analysis -- never **emitted
conversion**. The two ladders must not share a column.

## 1. What was excluded, and on what evidence

Two lines in `packages/compiler/src/ir/liveness.ts`:

```
841  export function stacklessPlan(fn: IrFunction): StacklessPlan | null {
842    if (fn.async !== true) return null;
843    if (hasFiberOnlySuspender(fn)) return null;
844    if (fn.generator !== undefined) return null;
```

and one sentence of comment at `:802`:

> The exclusions beyond D1 are scope, not difficulty: generators need the
> **second machine** and module initialisers carry the evaluation-promise
> cache.

"Scope, not difficulty" was never measured. That is the assertion shape this
front has now been wrong about three times -- `loop` naming D2 and buying 18
functions, `return` sitting off the ladder as the largest blocker, and
`boxedParam` **absent from the ladder entirely** while being the largest of
all. In the `boxedParam` case the decisive sentence was *the stated reason was
not the mechanism*. It is not the mechanism here either, in three independent
ways.

## 2. THE GATE ONLY EVER FIRES FOR ASYNC GENERATORS

`:842` runs before `:844`. A **synchronous** generator has `fn.async !== true`,
so it is refused one line **above** the gate that carries the stated reason,
by a line that carries **no stated reason at all**.

Measured on the corpus: of the 47 functions blocked only by a generator cause,
**24 are sync generators and 18 are async**. So **more than half of the
measured cost of "the generator exclusion" is charged to a gate whose
justification was never written down**, and the sentence about the second
machine is attached to a line that cannot see them.

This is the third instance of the same shape and the sharpest: the previous
two were a reason that was wrong, this one is a reason that was never offered.

## 3. THE 18 ASYNC ONES ARE BLOCKED BY THE HOP, NOT BY THE SECOND MACHINE

`packages/runtime/src/scr_async.c:5289`:

```c
static void scr_agen_yield_settle(void) {
  ScrGen *g = scr_gen_self();
  scr_await_hop();
  ...
```

`scr_await_hop` is what `async.hop` lowers to (`emit-exprs.ts:6446`, through
`fiberOnly`). It is a **registered fiber-only suspender**, and
`STACKLESS_LOWERABLE_LIB_CALLS` in `ir/suspends.ts:151` is **the empty set**.

So every async-generator yield contains the one suspender the stackless lane
declares it has no counterpart for. Async generators are not gated by a second
machine; they are gated by the microtask hop -- the same family that shipped
the fifteen-function crash on 2026-10-06.

**That moves 18 of the 47 onto a different front**, and makes closing the hop a
prerequisite rather than a neighbour. It is also likely that closing the hop
buys those 18 as a side effect, which is a dependency that changes work order,
not a curiosity.

A synchronous yield takes **no hop**: `scr_gen_yield_f64` goes straight to
`scr_gen_yield_switch` (`:4903`). The two flavours are not one piece.

## 4. THE CONSUMERS DO NOT SUSPEND THE CALLER

`genResume` and `agenResume` are registered in `SUSPENDING_NODE_KINDS`
(`ir/suspends.ts:39`), which is what manufactures their `kind=` point blocker
and therefore refuses every async function that consumes a generator.

Neither parks its caller.

- `scr_agen_next` (`scr_async.c:5209`) arms a promise, switches in, and
  **returns normally**. The emitter says so itself at `emit-exprs.ts:8073`:
  *"there is no pending check here... the throw surfaces at the awaitExpr
  wrapped around this node"*.
- `scr_gen_resume` (`:5368`) switches into the generator fiber and comes back
  out of the switch before it returns. The consumer's C frame is alive
  throughout; it is an ordinary call.

Five corpus functions are blocked by a **label**, not by a mechanism.

## 5. What the second machine actually is

It is real, and the reading "two suspension axes with different drivers" is
right -- but it is not two park mechanisms.

| | yield | await |
|---|---|---|
| primitive | `scr_switch(&self->st->ctx, self->return_to, NULL)` | park on a promise |
| destination | the **consumer's** stack | the event loop |
| promise involved | none (sync) / the request promise (async) | yes |
| who resumes | the consumer pulling | the scheduler |

Both reach the **same** primitive -- a switch to `return_to`.
`scr_gen_switch_in` (`:5331`) distinguishes what happened by inspecting the
generator's state after the switch returns. So the second machine is a
**second resumption entry and a three-way answer**: a plain coro resume
answers *parked* or *finished*; a generator resume must answer *yielded*,
*parked* or *finished*.

The runtime says this out loud at `:4957`, for the async case: *"scr_await_park
switches to fiber->return_to, which during a resume is the CONSUMER's stack --
so the consumer comes back out of the switch with the fiber neither yielded nor
done."*

## 6. THE `scr_current` HAZARD -- its own item

`scr_gen_switch_in` restores the exception cell **from fiber identity**:

```c
ScrFiber *me = scr_current;
scr_switch(&here, &f->st->ctx, f);
scr_current = me;
scr_exc_swap_cell(me != NULL ? &me->exc : NULL);
```

`packages/runtime/src/scr_coro.c` contains **zero** occurrences of
`scr_current`. The stackless lane neither sets nor clears it -- by design: the
state machine has no fiber identity, and `scr_coro_resume_entry` brackets the
body to restore ALS and the frame's cell precisely because `scr_switch` used to
do both for free.

So a generator resume executed inside a stackless frame would restore the
exception cell from a variable the stackless lane does not maintain.

**This is not the hazard the comment names, and nobody named it.** It is marked
**NOT DETERMINED whether it manifests**, because the consumer side is refused
today and the path never runs. Real, unexercised, invisible -- the most
expensive combination there is, and the reason it gets its own section instead
of a footnote.

## 7. The cost, both populations, matched columns

Instruments: `genmeasure.mjs`, `sololadder.mjs`, `finkind.mjs` and
`gen9.mjs`, kept at `G:/blocks/stackless/instruments/` (outside every
worktree, and outside the session scratchpad they were written in). They
import the built `dist`, never a copy of the analysis. The
verdict is always `stacklessPlan(fn)`; point blockers come from liveness's own
`p.blockers`; function gates are found by **perturbation** -- undo a candidate
gate on a shallow copy and re-ask the real predicate -- so a gate the
instrument has never heard of cannot be silently attributed to something else.
A consistency check aborts if the model claims a gain where no generator cause
is present: 202 app182 and 148 corpus gen-free blocked functions checked, **0
inconsistent**.

| | app182 | corpus (244 dumps) |
|---|---|---|
| fns with suspension points | 1,304 | 993 |
| points | 2,260 | 2,176 |
| admitted today | 1,099 / 1,304 fns, 1,728 / 2,260 pts | 724 / 993 fns, 1,344 / 2,176 pts |
| sync-generator fns | **0** (0 pts) | **49** (98 pts) |
| async-generator fns | **2** (7 pts) | **37** (78 pts) |
| consumer fns (non-generator, holding a resume point) | **1** (2 pts) | **38** |
| `yieldExpr` pts | 5 | 154 |
| `genResume` pts | 0 | 146 |
| `agenResume` pts | 1 | 59 |
| **blocked ONLY by a generator cause** | **0 fns, 0 pts** | **47 fns, 114 pts** |

The lift priced in that last row is stated in full, because one third of it is
masked: it removes `fn.generator`, the three `kind=` point blockers, **and**
`fn.async !== true` for a generator only. A sync generator probed with only
`generator` deleted is still refused by its own yield points, so a probe for
the async gate can never fire and the gate would be attributed to nothing.

### The solo ladder -- the cleanest demonstration of section 0

| cause | corpus solo | app182 solo |
|---|---|---|
| **gen** | **47** | **0** |
| loop | 38 | 29 |
| moduleInitCache | 26 | 0 |
| fiberOnlyLib | 23 | 16 |
| rootOk | 18 | 39 |
| `kind=awaitUnionExpr` | 8 | 25 |
| **finally** | **4** | **64** |
| switch | 0 | 3 |
| solo total | 164 of 269 blocked | 176 of 205 blocked |

**`gen` is the largest solo blocker on the corpus and the smallest on app182,
and `finally` is the exact mirror.** The exclusion did not look cheap because
it is cheap. It looked cheap because it was priced on the one program that
barely uses generators -- and the family that looks enormous there, `finally`,
is nearly absent from the corpus.

## 8. The 9 points -- RECONCILED, and the 8 is retracted

`stackless-llvm-port.md:135` says out-of-scope collapses to **"3 functions and
9 points"**. I reported 8 and could not source the 9. **The 9 is correct and
my 8 was wrong.** Enumerated:

| function | generator | points | gen-kind points |
|---|---|---|---|
| `%%m41.ProtoStreamReader.ensure` | no | 2 | 1 |
| `%m193.zipChunks` | yes | 5 | 4 |
| `%stream.asyncIter%Readable$asyncGenerator<dyn,void,dyn>` | yes | 2 | 1 |
| | | **9** | **6** |

2 + 5 + 2 = 9 points in the three functions; 6 of them are generator-kind.
My 8 was **7 + 1**: all points in the two generator functions, plus the
*generator-kind* points of the consumer, whose other point is a plain
`awaitExpr`. Two different columns summed as one -- a right measurement
carried past its scope, which is this front's most common error and was mine
here.

The honest pair is **3 functions, 9 points, of which 6 are generator-kind**.

## 9. One family, three pieces, and the order is forced

The 47 split **42 producer / 5 consumer-only / 0 both**; the producers split
**24 sync / 18 async**.

| piece | corpus | mechanism | depends on |
|---|---|---|---|
| sync generators | 24 | `scr_gen_yield_switch` only: no promise, no ready queue, no hop | nothing |
| async generators | 18 | the yield settles a request promise **and takes the hop** | the hop front |
| consumers | 5 | no caller suspension; a classification plus the `scr_current` question | nothing |

A stackless **sync** generator is structurally *simpler* than the `await`
lowering already shipped: it never touches `ScrPromise`. It is independent of
both other pieces and of the hop. The consumers are independent of the sync
producers. **Only the async producers are downstream, and what they are
downstream of is not a generator question.**

## 10. The `for await` crossing: a lever for the work, not for the count

`lowerForOfGenerator` (`lower-generators.ts:424`) and
`lowerForAwaitAsyncGenerator` (`:649`) both synthesise
`try { loop } finally { close }`, so generators already cross the `finally`
machinery by another path. Measured by structural signature -- a `tryCatch`
with `catchBody === null` whose `finallyBody` holds a `genResume`/`agenResume`
in mode `"return"`:

| | app182 | corpus |
|---|---|---|
| try/finally nodes in finally-blocked fns | 78 | 118 |
| of which iterator-close | **0** | **52** (44%) |
| finally-blocked fns whose finallys are ALL iterator-close | 0 | 26 of 77 |
| point-blocker-solo `finally` fns | 64 | 4 |
| ...of those, all-iterator-close | 0 | **0** |

So D4's machinery is genuinely reusable for generators -- and it unblocks
**zero** generator functions on its own, in either population. A lever for the
work, not for the count. It is also why D4 priced on app182 contains no
generator content whatsoever: **0 of 78**.

## 11. MECHANICAL vs DECISION

**MECHANICAL -- a pair exists, it is translation (5):**

1. The yield park/resume label and its state case. Pair: the `awaitExpr` arm in
   `emit-coro.ts`.
2. The spill/reload set at a yield. Liveness **already** records `live` for
   `yieldExpr` points; nothing new is computed.
3. The spawn wrapper and `mangleGenDrop`. Pair: `mangleGenSpawn`
   (`emit-async.ts:190-267`), same argpack shape, a frame instead of a fiber.
4. The two interned thunks (`genResultThunkFor`, `agenSettleThunkFor`): typed
   record builders, indifferent to how the body suspends.
5. The LLVM twin of each, by the port's own rules.

**DECISION -- someone chooses (5):**

1. **Does a stackless generator keep `ScrGen` as its handle?** One discriminated
   handle costs a branch per resume but keeps **one** consumer emission; two
   handles double the consumer emission and reintroduce exactly the drift
   `ir/suspends.ts` was built to prevent. Chosen by failure mode, that argues
   for the discriminator.
2. **The resume return protocol**: widen `ScrCoroParkKind` to three answers, or
   an out-param.
3. **Who owns the yielded value**: the `ScrGen` OUT slot, or a frame field.
4. **Who maintains the exception cell across a mixed stackless/fiber boundary**
   (section 6).
5. **Does a sync generator sit on `ScrCoroBase` at all**, given it needs no
   promise and `ScrCoroBase` embeds one?

## 12. THE TWO LANES INTERSECT

The three emission cases exist on **both** backends:

| | C lane | LLVM lane |
|---|---|---|
| `yieldExpr` | `emit-exprs.ts:7957-8002` (46 lines) | `llvm/emitter.ts:7364` |
| `genResume` | `emit-exprs.ts:8003-8072` (70) | `llvm/emitter.ts:7425` |
| `agenResume` | `emit-exprs.ts:8073-8139` (67) | `llvm/emitter.ts:8617` |

**This front and the LLVM port intersect, and neither subsumes the other.**
The port moves the existing stackless emission to LLVM; this front adds new
emission that both lanes will then owe. Planning consequence: they can run in
parallel only while the generator work is in the shared analysis and the
runtime. The moment it reaches emission, one of them lands first and the other
rebases onto it -- and the C lane is where stackless emission lives today, so
the C side landing first is the cheaper order.

## 13. NOT DETERMINED

- Whether the `scr_current` hazard **manifests**. The path never runs today.
  Needs a build.
- Frame size for a generator, and whether a yield point needs the fat
  (`ScrCoroExc`) frame. Not derivable from the ladder.
- Whether a stackless async generator can reproduce node's
  `AsyncGeneratorYield` tick count exactly. That is the hop front's question.
- Whether any of the 24 sync-generator gains survive **emission**. Everything
  here is admissible.
- `yield*` (`lowerYieldStarStatement`, `lower-generators.ts:670`) and the
  native-sink path (`g->sink`, `scr_agen_sink_schedule`) were read but not
  sized.
- The corpus is 244 dumps, not the whole corpus.
