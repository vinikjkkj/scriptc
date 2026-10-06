# Extending the value guard to the LLVM lane

**Status: specification, not implementation. Nothing here has been built.**

Sibling to `stackless-llvm-design.md` (how the lowering would be built) and
`stackless-frame-contract.md` (what the runtime provides). A sibling rather
than a section because the design file was in contention the hour this was
written -- a commit with a new parent and an old tree nearly deleted it -- so
a disjoint file set is cheaper than an argument about merge order.

## 0. The lesson this guard exists for

> A lane can be **green and wrong**. A `bool`-returning coroutine was
> fulfilled through the promise's `f64` member, leaving `b` zero, so every
> `await` of it answered `false` whatever it returned. A wrong **answer**,
> not a crash -- which is why a green corpus never saw it.

`tests/harness/stackless-values.test.ts` exists because of that, and it has
already earned its keep once: its ledger made the boxed-param shapes appear
as `['wbf','wbb','wbs']` *not converted* before the lowering landed, i.e. it
refused to let the largest blocker on the ladder join the lane with no value
coverage.

**The LLVM lane has none of this.** The guard builds two arms, both
`backend: "c"`. A coro lowering landing on the LLVM lane today would land
without a net, and the defect class it would land without protection against
is precisely the one that has cost this front the most.

## 1. What the C-lane guard already does

| mechanism | what it catches |
|---|---|
| `buildArm(knob)` -> `{ exe, cSource }`, `backend: "c"` | two arms, knob on and off |
| `WRAPPERS` ledger: `{ name, take, finish, converted }` | the per-shape contract |
| `off.cSource` must contain no `scr_coro_(take|finish)_` | the arming check: the knob reached the emitter |
| `on.cSource` must contain `scr_coro_finish_` | ditto, other direction |
| per-kind `scr_coro_take_<k>` / `finish_<k>` presence | a kind silently dropping off the lane, which makes the two arms MORE equal and so is invisible to the output comparison |
| `sc_cr_<name>(` present for every `converted: true` | a shape claiming coverage it does not have |
| the inverse: `converted: false` but on-lane -> **fail by name** | a shape joining the lane with no coverage |
| no fiber primitive inside an admitted body, checked in the artifact | the `async.hop` / `async.awaitDyn` class |
| temps established before a resume label and read after it | a value lost across a park |
| `expect(run(on.exe)).toEqual(run(off.exe))` | **the wrong-answer class** |
| reference sanity pins on `off.exe`'s output | a reference that is itself wrong, which would make a matching arm look right |

The last two are the teeth. Everything above them is structural and can be
green while the program answers wrongly.

## 2. The arm matrix: two lanes, two knob states, **one** reference

Today: 2 arms. Needed: **4**.

| arm | role |
|---|---|
| **C, knob off** | **THE REFERENCE.** C is the reference backend "forever" per `how-it-works`; it is the only arm with no coroutine lowering in it at all |
| C, knob on | compared byte-for-byte to the reference |
| LLVM, knob off | compared byte-for-byte to the reference |
| LLVM, knob on | compared byte-for-byte to the reference |

**Every arm is compared to the C-off reference, never to its own lane's other
arm.** That choice is the whole point: comparing LLVM-on against LLVM-off is
blind to any defect present in both, and the bool bug would have been exactly
that -- a shared `scr_promise_fulfill_*` mistake reachable from either knob
state. Comparing LLVM-off to the C reference also buys a free check the
project does not currently have in this file: that the LLVM lane's *fiber*
path agrees with C.

The reference's sanity pins (`bool   true false`, `rej   boom true`, `done`)
**stay and must grow with every shape added**, because an arm matching a
broken reference reads as a pass.

**Cache keying.** The existing file already warns that the knob is not part
of the compiler's own cache key, so two arms sharing an output directory
"would share one binary and the comparison would pass by being the same
program twice". With four arms the **backend** joins the knob in that key.
Getting this wrong produces a guard that cannot fail -- the ninth instance of
that shape in this front's history.

## 3. The ledger becomes per-lane, and that is not cosmetic

```
converted: boolean          ->    converted: { c: boolean; llvm: boolean }
```

Because the port's entire duration is a state where a shape converts on C and
not on LLVM. A single boolean would make the ledger either fail spuriously
for every shape on day one, or be loosened until it asserts nothing -- and a
loosened ledger is how a shape joins a lane unguarded.

Per-lane on-lane predicate, because the two lanes spell a converted body
differently:

- C: `on.cSource.includes("sc_cr_" + name + "(")`
- LLVM: `on.llSource.includes("define internal void @sc_cr_" + name + "(")`

and the two-way assertion runs **per lane**. So flipping `llvm: true` is the
same edit that switches that lane's value coverage on -- which is the
property that made the boxed-param shapes announce themselves, preserved
rather than reinvented.

A shape that is `{ c: true, llvm: false }` and appears on the LLVM lane fails
by name. A shape that is `{ c: true, llvm: true }` and does *not* appear
fails by name. Neither can be satisfied by loosening one flag.

## 4. What makes the guard fail when the lowering is wrong but compiles

This is the question that matters, so it is answered per defect class, with
the classes no structural scan can see marked.

| defect | caught by | structural scan sufficient? |
|---|---|---|
| **wrong value, right type** (the bool bug: `finish_f64` leaves `b` zero) | **only** the output comparison against the C-off reference | **no** |
| a kind silently dropping off the lane | per-kind `take`/`finish` presence + the ledger's two-way assertion | yes -- and necessary, because dropping makes the arms *more* equal |
| a fiber primitive emitted inside an admitted body | the artifact scan, per-lane spelling | yes |
| a value lost across a park | the temps scan. On LLVM the verifier rejects a non-dominating use -- but **a value spilled to the wrong slot dominates fine and is still wrong**, so the scan is still owed | partly |
| a frame field addressed at the wrong offset | **not this guard** -- `runtime-layout.test.ts` `_Static_assert` | n/a |
| microtask-turn divergence | the turns ruler, `microtask-turns.test.ts` | **no**; and see the prerequisite below |

## 5. The value poison, specified

`SCR_TICK_POISON` plants an extra microtask **turn**. `SCR_CORO_ALS_BLIND`
plants a wrong **ambient context** (the frame's ALS not reinstalled on
resume). Nothing in the tree plants a wrong **answer**. So on the day the
LLVM arms are added, nothing proves the output comparison can fail *on the
lane being added* -- and certifying a new lane on the old lane's evidence is
the shape that produced a 38-line battery whose runner never executed the
binary while reporting genuine `converted=true` flags.

### 5.1 What it corrupts -- three poisons, each by a defect that happened

"Wrong value" is a category, not a mechanism. Each poison below reproduces a
**confirmed** defect of this front, cited from the code that records it, and
each names the shapes it must redden. A poison that reddens everything
localises nothing; one that reddens a single shape does not cover.

**Poison A -- `finish-arm`: fulfil through the wrong promise member.**

> *"NOT finish_f64. ScrPromise keeps `f64` and `b` as separate members with
> distinct payload kinds, and every awaiter -- stackless and fiber -- reads
> `b`. Fulfilling through f64 left `b` zero, so an `await` of a
> bool-returning coroutine answered false whatever it returned: a wrong
> ANSWER, not a crash, which is why a green corpus never saw it."*
> -- `emit-coro.ts`, `coroFinish`

Mechanism: make `coroFinish` emit `scr_coro_finish_f64` where the return type
owes `finish_bool`.
**Expected RED:** every shape whose `finish` is `bool` -- today `wb`, `wbb`.
**Expected GREEN:** every `f64`, `ref`, `void` finish shape. Both halves are
asserted; a poison that reddens the f64 shapes too is mis-targeted, not
merely noisy.

**Poison B -- `park-spill`: send one value to the wrong frame slot.**

The confirmed defect is the unspilled non-refcounted temp: a `double` or
`bool` evaluated before a nested suspension sat in no frame, was never
spilled, and came back indeterminate -- *"the park loses these, and the
answer is a plausible wrong number"* (`stackless-values.test.ts:597`).

Mechanism, and the variant matters: **misdirect** the spill (write the value
into a neighbouring frame field of the same type) rather than **drop** it.
Chosen by failure mode, not by convenience -- a dropped value is a
non-dominating use that the **LLVM verifier rejects at build time**, so the
drop variant cannot exercise the output comparison on the lane this guard is
being added for. A misdirected value dominates fine and is silently wrong on
both lanes, which is exactly the case only execution catches.
**Expected RED:** the nested shapes -- the `call.args` / `bin.right` family
(`wna`, `wnv`, `wnn`, `wns`, `wnb`, `wnx`, `wnf`, `wnr`, `wnm`).
**Expected GREEN:** every statement-root shape, which has nothing crossing
the park to misdirect.

**Poison C -- `take-arm`: read the settled value through the wrong accessor.**

Poison A's mirror on the resume side: `scr_coro_take_f64` where the result
type owes `take_bool`. Same defect family, opposite direction, and separately
testable because the guard already asserts per-kind `take` presence.
**Expected RED:** shapes whose `take` is `bool`.
**Expected GREEN:** the rest.

**What is deliberately NOT poisoned, so nobody expects it here.** The
owned-local defect -- *"leaked 1 object, 2 strings and 1 array"*
(`emit-coro.ts`) -- is a **leak**, not a wrong answer: the release ran as a
no-op on a local the resume had re-initialised. Output comparison cannot see
it and never will. It belongs to the RC audit, a different instrument, and
conflating the two would leave a real class uncovered while looking covered.

### 5.2 How it does not leak to production

**Mechanism: a build-time environment read inside the emitter**, the same
shape as `SCRIPTC_STACKLESS` itself and as `SCRIPTC_RC_AUDIT`
(`cc.ts:669`).

Why not the two existing poisons' mechanisms, since both are precedents:
`SCR_TICK_POISON` is a **runtime** env var read by `scr_async.c`, and
`SCR_CORO_ALS_BLIND` is a `-D` at **C compile** time (`run-mixed.sh
--als-blind`). Both perturb runtime C. A wrong `finish` arm is *emitted
code*, so the perturbation has to happen at emission -- a different layer,
therefore a different mechanism. Neither precedent transfers; both are sane
for what they do.

**Gating, requirement 4.** The read happens only inside the coroutine
emission path, i.e. only where `coroPlans` is non-empty. With the knob absent
no code path consults it, so the flag cannot reach knob-off output by
construction rather than by discipline.

**The test that proves it, and it is the point of this subsection.** Build
one program twice with the knob **absent**, once with the poison set and once
unset, and assert the emitted C is **byte-identical**. That is the
embarkation criterion, and a debugging tool is exactly what would break it
without anyone noticing.

That test alone is not enough -- it is green when the poison does nothing at
all. So it is paired with a **must-change line**: the same two builds with the
knob **ON** must **differ**. Without that pair, a poison that was never wired
up passes the byte-identity test perfectly.

**The cache-key hazard, which is the likeliest way this is got wrong.** The
poison changes emitted C, so it must be part of the build cache key. If it is
not, a poisoned build is served the unpoisoned binary from cache and the
guard goes green while the poison is live -- the instrument landing inside
the system it measures, which has bitten this project repeatedly. The
existing guard already warns of the knob's version of this: two arms sharing
an output directory *"would share one binary and the comparison would pass by
being the same program twice."*

### 5.3 The self-test: a count, not a pass

`SCRIPTC_RC_AUDIT` was born inert -- it passed without having looked at
anything, because it is a build-time flag and nothing asserted that it had
engaged. The cure is a number.

The emitter increments a counter every time it substitutes an arm or
misdirects a spill, and reports it:

```
POISON-SITES  poison=finish-arm  sites=7
```

and the harness **refuses at `sites=0`**, by name, rather than reporting a
pass. "The build succeeded" is not evidence the poison engaged.

The count is the **liveness** assertion. It is not the **coverage**
assertion, because a poison that hits one site where twelve are owed passes a
`> 0` check while under-covering. Coverage is the expected-RED / expected-GREEN
shape sets of 5.1, asserted as sets. Both are required, and they fail
differently: `sites=0` means the poison is not wired; a red set that does not
match means it is wired to the wrong place.

## 6. Which shapes must be exercised on both lanes

All `WRAPPERS` shapes carry per-lane flags; these are the ones whose
`llvm: true` is load-bearing for a first LLVM slice:

- **the three box-access flavours** -- `take f64` / `bool` / `ref`. Mandatory
  because `boxAccess` is the shared helper (`emit-types.ts:692`,
  `llvm/shapes.ts:455`) and a shared helper used by two emitters is exactly
  where a divergence hides.
- **`take void` and `finish void`** -- the two arms with no value to compare,
  so the only evidence they work is the surrounding output.
- **the rejection path** -- `finish_throw`, because a swallowed rejection is
  a wrong answer that looks like success.
- **the boxed-param shapes** `wbf` / `wbb` / `wbs` -- the lowering the LLVM
  lane would inherit, and the one whose own guard gap was found by this
  ledger.
- **`bool` specifically, twice** -- once returned and once awaited -- because
  the historical defect was invisible to a program that only *returned* a
  bool without an `await` reading it back.

Shapes a C-prime first slice does **not** convert (anything
`nestedInExpression`) stay `llvm: false`, and the ledger records that by name
rather than leaving the gap unnamed -- which is the same scope-ledger
discipline the C lane already uses for the shapes it has not reached.

## 7. Not determined by reading

- **The exact `.ll` spelling of a converted body.** The C predicate is
  `sc_cr_<name>(`; the LLVM one is assumed to be
  `define internal void @sc_cr_<name>(`, but the emitted attribute group and
  parameter spelling were not read off a real `.ll` with a coroutine in it,
  because none exists yet. If the scan's pattern is wrong it matches nothing
  and reports every shape unguarded -- loud, but for the wrong reason.
- **Whether a spill misdirect is expressible at all.** Poison B needs a
  frame carrying two fields of the same type across one park. Whether the
  guard program's nested shapes produce such a frame was not checked; if none
  does, B needs a shape written for it, and that shape joins the ledger with
  its own flags.
- **Whether the poison can enter the build cache key without invalidating
  every warm cache.** It must be in the key when set, or a poisoned build is
  served an unpoisoned binary. It must be absent from the key when unset, or
  adding the flag invalidates every existing cached build on this host. Both
  halves are required and only the first is obvious.
- **The cost of four arms.** Each is a full build of the guard program; the
  current two take a few seconds each, but that is C-only and
  knob-cache-warm.
- **Whether a value poison can be confined to the knob-on path** in the
  emitter without touching the knob-off emission at all. Stated above as a
  requirement; not verified to be achievable.
- **Whether the tick poison can reach an LLVM coro path.** It reaches the C
  one through `scr_coro_tick_poison()`. The LLVM lane has no coro path to
  reach, so this is a prerequisite for turn-count coverage rather than a
  question -- but the order matters: turns coverage cannot be claimed for the
  LLVM lane until it exists.
- Everything about scale and timing. This file reads source and specifies; it
  measures nothing.
