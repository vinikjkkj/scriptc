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

## 5. The missing mechanism: there is no **value** poison

`SCR_TICK_POISON` plants an extra microtask **turn**. Nothing in the tree
plants a wrong **value**. So on the day the LLVM arms are added, nothing
proves the output comparison can fail *on the lane being added* -- and a
guard whose failure path has never been exercised is the shape this project
has been bitten by repeatedly, most recently a battery whose runner never
executed the binary while reporting genuine `converted=true` flags.

**Specified: a value poison.**

- **What it does.** Makes exactly one `take` arm return a plausible wrong
  value -- `take_bool` answering `false` unconditionally is the historical
  defect and therefore the right one to plant.
- **The guard must go RED with it set, on each lane, and the assertion must
  name the lane.** A poison that reddens the C arm and silently leaves the
  LLVM arm green is worse than none: it would certify the new lane on the old
  lane's evidence.
- **It must be build-time, not an env var.** The tick poison is runtime
  because it lives in the runtime; a wrong `take` arm is *emitted code*, so
  the poison lives in the emitter. Which means it inherits the hazard the RC
  audit already demonstrated: that audit "was inert on its first run" because
  it is a build-time flag and nobody knew. So the poison owes a self-test
  that asserts **it moved something**, not merely that the build succeeded.
- **It must be gated on the knob being ON.** A value poison compiled into the
  emitter that changed knob-absent output would break the embarkation
  criterion -- knob-absent C must stay byte-identical -- and would do so
  quietly, since nothing in the poison's own test looks at the knob-off arm.
  This is the one requirement most likely to be missed, because it is a
  constraint on a debugging tool rather than on the feature.

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
