# The stackless coverage front, 2026-10-08

Eight commits on `coro/rootok-assign`, **not merged**. This file records what
was measured, what dissolved, what is committed, and the wall the front
stopped at.

**Population, on every figure below unless a line says otherwise:**
`tests/perf/zapo-rest/app182`, provenance `zapo-js@1.8.2` +
`@zapo-js/store-sqlite@1.2.0`, C lane **pinned** (the CLI default is llvm and
`index.ts` gates the lane on `backend === "c"`, so an unpinned build measures
nothing), zig **0.16.0**, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TARGET=x86_64-windows-gnu`, build node v22.18.0, gate node v25.9.0.
Base: `bb781e94c`.

**Denominators**, re-derived from the artifact rather than inherited:

- **1,304** functions holding at least one suspension point. Not 1,489 --
  that is *suspendable* functions (1,487 async + 2 async generators), and 185
  of those contain no await. The same numerator reads 35.8% over 1,489 and
  40.9% over 1,304, which is where the inherited ladder had got confused.
- **2,281** IR suspension points. Was 2,260 until the hop became a point.
  Never 2,270 -- a retracted regex artifact, reproduced here exactly as
  `parks + remaining await-kind sites` and shown to be 2,254 await-kind IR
  points plus 16 double-emitted nodes.

## The scoreboard

| | functions | share of 1,304 | points | share of 2,281 |
|---|---|---|---|---|
| base `bb781e94c` | 1,099 | 84.3% | 1,728 | 75.8%* |
| `rootOk:assign` | 1,124 | 86.2% | 1,812 | 79.4%* |
| the hop | 1,140 | 87.4% | 1,864 | 81.7% |
| `awaitUnionExpr` | 1,166 | 89.4% | 1,929 | 84.6% |
| plain loops | 1,192 | 91.4% | 1,977 | 86.7% |
| the four positions | 1,216 | 93.3% | 2,071 | 90.8% |
| `forOf` | 1,225 | 93.9% | 2,098 | 92.0% |
| `a0` (a fix, no gain) | 1,225 | -- | 2,098 | -- |
| **shape (2)** | **1,295** | **99.3%** | **2,242** | **98.3%** |

*the first two rows predate the hop, whose denominator was 2,260; against
that they read 76.5% and 80.2%. Stated rather than silently rescaled, because
the change that moved the numerator moved the denominator too.

**Every rung was predicted before any code and measured from the emitted C
afterwards. Seven coverage predictions, seven exact.** Where a prediction had
to change -- the hop's denominator, the `finally` piece boundaries -- it was
amended BEFORE the code, never reinterpreted after.

`a0` is the eighth commit and is not a rung: it predicted no coverage and
bought none. It carried a prediction of a different kind -- the `finally`
excess, `2 x in-finally points`, 16 against 16 -- and that one was exact **in
the population it was taken over, and only there.** Section 10b of
`stackless-llvm-port.md` now carries the scope caveat: the copy count is 1-3
rather than always 3 (89 regions, 87 exception copies, 64 pending-return
copies in this same C), so the general form is `(copies - 1) x in-finally
points` with copies measured. The number was right; the formula's shape
promised more reach than the measurement had. It is counted apart from the
seven because it is the one prediction on this front whose scope had to be
narrowed after the fact.

## What dissolved, and the pattern

Six pieces this front was told it needed turned out not to exist.

| piece | said to need | actually |
|---|---|---|
| `nested` | +417 points | already merged, `4e93997eb`, +28/+66 |
| `forOf` cursor | a new frame mechanism | one `double`; the iterable was already carried |
| finally stash (c) | a per-region spill | needs the frame only for shape (1) |
| catch binding | its own piece | an `IrLocal`; ordinary liveness carries it |
| `sc_pret` (b) | a frame field | the park precedes the write, by construction |
| promise / class returns | distinct lowerings | both take the default `coroFinish` arm, 653 occupants |

**Five of the six were boundaries inherited from a document. None of the
boundaries derived by reading the emitter dissolved.** The rule the front
ended with: *no piece boundary is accepted without being derived from the
emitter, however firmly a prior document asserts it.*

The mechanism behind several is one line: `newTemp()` pushes EVERY temp into
the RC frame and a park spills all of `E.frames`, independently of the live
set. So "frame state the analysis cannot name" was true and "therefore needs a
new mechanism" did not follow -- the frame could always hold it; three pieces
were merely declared with a raw `E.line` instead of through the allocator.

## What is committed

| commit | rung |
|---|---|
| `5c09ceefe` | `x = await f()` -- five store routes, not three |
| `cb3724ec6` | the microtask hop -- a libCall becomes a suspension point |
| `32313bbe8` | await of a promise-or-unit union -- one point, one state, two ways in |
| `3f6cffae8` | plain loops -- blocker narrows from `loop` to `forOf` |
| `2859f7d4a` | `if` / `switch` / `recordSet` / `bytesSet` -- disjoint, additive exactly |
| `99c66ef46` | `forOf` -- the whole gap was the cursor |
| `4f6d55ef3` | **a shipped defect**: a `return` crossing a `finally` emitted a value-return into a void resume |
| `3385ee493` | shape (2) -- a point in a try guarded by a finally, on a fat frame |

Every one: knob-absent emission **byte-identical, 16/16**, with the comparison
shown able to separate knob-off from knob-on; every guard **red by name** on
revert; a clean pass AFTER a fix, never as the first pass.

**And one more change ships with this write-up: the closing half of the
dispatch invariant** (`emit-stmts.ts`). The dispatch emits
`case 1..plan.points.length` and the await sites draw from `coroPointIndex`.
The bound check at the await already caught OVER-emission; UNDER-emission had
no check at all, and it is silent -- a state with a case and no label, or a
plan entry nothing consumed, produces a coroutine that can never be resumed
into one of its states while every count in the table above still adds up.
The assertion compares what the emitter DID against what the analysis
PLANNED, rather than binding both sides to a shared constant, which would tie
declared intent to declared intent. It did not fire across any of the 1,295
converted functions, and it emits no C: knob-absent emission is
byte-identical 16/16 with it in the tree, against a comparator shown in the
same run to read 16/16 DIFFERENT for the knob-on arm.

## The wall

**9 functions / 39 points remain**, and they are not blocked by admission:

- **6 fns / 30 pts -- `finally:body`**, a suspension INSIDE a finally body,
  blocked by a structural property of how the dispatch is built. No previous
  rung was.
- **3 fns / 9 pts -- the generator family** (2 async generators, 1
  `agenResume`), out of scope by decision. The hop -- their real gate per
  `stackless-generators.md` section 3 -- now exists.

### Why shape (1) needs its own slice: D1 is refuted

A finally body is emitted once per completion path, so one IR point becomes
several emitted sites, each needing its own state and label. The obvious fix
-- have the plan carry one entry per copy -- cannot work. The three emission
sites in `emit-stmts.ts` are: the normal path, always; the exception path,
only when `excHandler.used`; the pending-return path, only when
`retEntry.used`. Both flags are set by the emitter WHILE EMITTING, so the
analysis would have to predict what has not happened yet.

And the count genuinely varies -- measured on the knob-absent C of app182:
**89 try-with-finally regions, 87 exception copies, 64 pending-return
copies.** If it were always three, both of the latter would read 89. One
region emits the normal copy alone.

The alternative -- let the emitter size the dispatch from what it emitted --
is worse, and the reason is the front's own lesson: **an invariant the emitter
feeds from both sides is green forever.** The point-count equality is what has
tied analysis to artifact through all eight rungs.

**D4, as the next slice's design:** emit the body into a buffer, prepend the
prologue once the state count is known, and replace the equality with two
inclusions -- every plan point emitted at least once, every allocated state
sited at a plan point. That keeps both directions and keeps the analysis as
the independent side, at the cost of restructuring how the prologue is
emitted. **It trades a count for a pair of inclusions -- a permanent reduction
in verification strength -- for 0.5% of points.** That trade is why the front
stopped here rather than taking it.

## AMENDMENT: D4 was taken, and the trade was made with its eyes open

The section above records the front stopping at 99.3% / 98.3% because D4's
price -- the point-count equality replaced by two inclusions -- was judged too
high for 0.5% of points. **That decision was revisited and reversed by the
user, with the cost restated and accepted, and D4 has landed.** The reversal
is recorded here rather than by editing the paragraph above, because what the
front believed at the time is part of the record.

**1,301 of 1,304 functions (99.8%) and 2,272 of 2,281 points (99.6%).** What
remains is 3 functions / 9 points, all generator-family, out of scope by
decision. The point-blocker vocabulary is now EMPTY.

**What was sold, in one line:** two inclusions cannot tell three copies of a
plan point from four. Multiplicity left the compiler's own assertion and moved
into a harness guard that MEASURES the copy count rather than assuming three.

**And the slice paid for itself before it landed.** Admitting shape (1) put a
park between `sc_pret`'s snapshot and its read for the first time, and the
pending-return path answered 0 where the fiber lane answered 1 -- a wrong
answer, on a path every previous slice had left unreachable. `4f6d55ef3` had
flagged exactly this: it answered the question for one shape and said in as
many words that another shape "gets re-derived rather than inheriting this".
It was re-derived, by a guard that drove all three completion paths, and
`sc_pret` is now a frame field.

## Method findings worth keeping

- **A coverage number over a corpus is a statement about that corpus.** It
  cannot distinguish "this lowering is correct" from "no input exercised this
  lowering". `4f6d55ef3` was a shipped defect that survived six rungs, every
  gate and every measurement because app182 contains no function of its shape
  -- occupancy zero, capacity live. A zero-occupancy sweep over the axes the
  emitter branches on found four shapes with no occupants, two of which were
  not distinct lowerings at all.
- **The knob-absent comparison is the only check that looks at the other
  lane.** Every guard here examines the lane the change exists FOR. The
  `forOf` cursor hoist was applied more broadly than the need and six of
  sixteen files differed with the knob absent, while value rows, RC rows and
  the conversion count were all green. *For every change, ask which lane it
  should be invisible to, and check that lane.*
- **A guard's failure modes are asymmetric.** A guard that passes has shown
  that IT passed; a guard that breaks has shown the system doing something.
  Three guards this session were green by construction; the one that refused
  to compile found the real defect.
- **"Absent by construction" is not "guarded."** When a named risk is
  structurally impossible, say so -- do not let a guard imply coverage it does
  not give.
- **Eliminating beats deriving.** Two fences that must agree can
  desynchronise; one fence cannot.
- **Measure the plausible explanation, do not narrate it.** A benign reason
  why a defect cannot have touched earlier results produces a coincidence of
  identical shape to a real contamination.
- **A control must be chosen by evidence that its target is present.** One
  positive control here was picked by plausibility, read zero, and would have
  made an entire sweep vacuous while looking like a clean confirmation.

## Reproducibility, and where evidence was spent

Figures here are reproducible from artifacts under `G:\blocks\stlcov` --
`out-off` (the ruler every byte-identity check compares against), `out-on`
(the base), `qout-on` and `qout-off` (the final rung), and
`out-ir/zapo-rest.ir.json` (the census input) -- with `count.sh` and
`census.mjs`.

**Seven superseded knob-ON arms were purged on 2026-10-08.** Each arm's
converted count was re-derived from its own emitted C and checked against the
figure its commit published -- **9 of 9 match** -- BEFORE deletion. After
deletion, each of those counts is attested by its commit plus that
cross-check, **not re-derivable from disk**; the independence of
re-measurement was spent deliberately, at that point, to recover 2.1 GB, and
the cross-check was run first precisely so that what was spent is known.
Recovering an independent reading costs a rebuild, roughly 13 minutes per arm.

Knob-absent arms are interchangeable -- they are byte-identical, so one
verification covers all of them. Knob-ON arms are not: each is the evidence
for its own rung.
