# What D4 is, and what D4 costs

Companion to `stackless-frame-contract.md` (the runtime contract) and
`stackless-llvm-port.md` (the admissible set, the ceiling, and the LLVM
parity inventory). Referenced by link rather than merged into either, so the
three files stay a disjoint set.

**SCOPE, on every line.** Unless a line says otherwise, every figure here is
measured on `tests/perf/zapo-rest/app182` and **app182 only**. Where a figure
comes from the IR liveness pass it is a **ceiling on reach and a floor on
work**, because three kinds of frame state are invisible to that pass:
`sc_pret`, the finally stash, and a `forOf`'s cursor. None is an `IrLocal`,
so `coroFrameLocals` cannot see them.

## 0. The rule this file exists to obey

> **A measurement that matters is persisted in the same turn that produces
> it, with lane, arms, column, denominator, host regime and build -- or it is
> hearsay the next time it is cited, however real it was when taken.**

That rule is already written in `stackless-llvm-port.md` section 1. It was
then broken for six consecutive rounds of D4 work, and this file is the
repair.

**The proof is attached, and it is not hypothetical.** An "app182 versus
corpus inversion" was measured, reported, and recorded as durable fact on the
coordinating side. It was wrong -- it compared app182's *solo* set against the
corpus's *all-blocked* set -- and it was caught only because two numbers from
two files disagreed. Had it lived only in messages on both sides, nobody
would have had anything to disagree with. See section 10.

## 1. D4 is a family, not a blocker

`liveness.ts` raises `finallyDepth` in **two** places, and the blocker
construction at `liveness.ts:388` emits one label for both:

- `liveness.ts:678` -- walking the **finally body** itself.
- `liveness.ts:689` -- walking the **try and catch bodies**, when the try has
  a finally. The comment there states the reason: *"A try that HAS a finally
  also blocks its try/catch bodies: unwinding out of them runs the finally
  with the exception still pending."*

So `pt:finally` spans two shapes with different work (app182, all 77
finally-blocked functions; liveness-derived, ceiling/floor):

| shape | points | functions | what it needs |
|---|---|---|---|
| (1) suspension **inside** a finally body | **8** | **6** | fat frame **and** a distinct state per emitted copy |
| (2) suspension in a try/catch **guarded by** a finally | **98** | **71** have only this | fat frame; the body is emitted once |

The runtime half of the fat frame is already built: `scr_coro_resume_entry`
installs the frame's own cell with `scr_exc_swap_cell(mine)` and restores the
previous one on the way out (`scr_coro.c`, around the resume call).

## 2. The four pieces

| | piece | where it attaches | what is missing |
|---|---|---|---|
| (a) | fat frame | per function | `has_exc` is **hardcoded `false`** at `emit-coro.ts:188`; the frame struct always embeds `ScrCoroBase`. `ScrCoroExc` is 96 B against `ScrCoroBase`'s 40 B -- a 56 B `ScrExcCell` of its own |
| (b) | `sc_pret` spill | per function (the slot is declared once, when any return crosses any finally) | an emitter-invented local, **not an `IrLocal`** |
| (c) | stash spill | per try-with-finally **region** -- `ScrCaught *sc_fexc_N = scr_exc_take()` is emitted on the finally's exception-path copy, so it exists per region and not only where a catch binding does | also not an `IrLocal` |
| (d) | per-copy state | shape (1) only | the finally body is emitted **three times** (normal, exception, pending-return), so one IR point becomes three emitted sites |

## 3. The internal ladder -- two predicates, and the spread is the finding

Over the **strict** solo set: `finally` is the only blocker, counting both
point-level blockers **and** function-level gates. That set is **56
functions, 117 points** (app182; liveness-derived, ceiling/floor).

Exclusive buckets: rung (a) only **2**, needs (b) **41**, needs (c) **8**,
shape (1) **5** -- summing to 56.

| rung | functions, cumulative |
|---|---|
| (a) fat frame alone | **2** |
| (a)+(b) `sc_pret` | 43 |
| (a)+(b)+(c) stash | 51 |
| (a)+(b)+(c)+(d) | 56 |

**Those cumulative numbers rest on a predicate that is not settled.** Two
compete:

- **P1, "the slot exists in this function."** Any function whose return
  crosses a finally needs (b). Rung (a) is then **2**.
- **P2, "the slot must survive a park."** A slot only needs the frame if a
  park sits between its write and its read -- and for both `sc_pret` and the
  stash those spans lie inside the finally body, i.e. shape (1). Rung (a) is
  then **51**.

The emission code argues for P2: every local is re-initialised before the
dispatch on each resume, so a slot that no park crosses is harmless. But
that is a code-reading, and reading the runtime pointed the wrong way twice
in one session. **Rung (a) is therefore recorded as between 2 and 51
functions, unresolved.**

The probe that settles it, designed and not yet run: compile
`tests/corpus/2432-generic-member-fields-async.ts` with the finally fence
lifted and read the emitted C for whether `sc_pret` is spilled into the
frame. Subject chosen because it is user-written (section 6), shape (2), and
return-crossing, so it actually exercises the slot.
`tests/corpus/1022-async-exceptions.ts` is the control: same shape, no
return, so no slot should appear at all. Either outcome is informative, which
is the property five controls lacked earlier in the same session.

## 4. The intersection of (b) and (c)

Over the strict 56 (app182; liveness-derived, ceiling/floor):

```
return-crossing 48    catch-binding 9    BOTH 3
return only     45    binding only  6    neither 2
```

Neither set contains the other, so **(b) and (c) are two rungs, not one.**
The `neither` count of 2 independently reproduces rung (a) = 2 under P1.

## 5. Frame cost -- real, and not disproportionate

Over the strict 56 (app182; liveness-derived, so a floor on the real frame --
the frame contract warns real frames are larger by the owned temps at each
park):

| | total | mean | median | max |
|---|---|---|---|---|
| as **fat** frames (96 B base) | 7,457 B | 133.2 B | 120 B | 296 B |
| as **lean** counterfactual (40 B base) | 4,321 B | 77.2 B | -- | -- |
| **the D4 penalty alone** | **3,136 B** | = 56 x 56 | | |

Their payloads are **below** the admitted population's average -- 77.2 B
against 84.5 B. These are small functions carrying a large base, so the fat
frame is the whole story and not their contents.

Measured on the earlier 64-function population, converting them cost +9.2%
frame bytes for +5.8% functions and +8.2% points: **1.59x per function but
1.12x per point.** The benefit scales with points, so per point this is
essentially proportional, as `boxedParam` was. **"Fat frame" is a real +56 B
and is not disproportionate.** The exclusion is about lowering work not yet
built, which is an honest statement, rather than about cost, which was
folklore.

## 6. Two lowering facts -- structural, not counts

**`for await` and generators lower to a try/finally.** Seven sites synthesise
one: `lower-containers.ts` x4, `lower-generators.ts` x2, `lower-stmts.ts` x1.
Consequence measured across 227 corpus IR dumps: of the 41 carrying a
finally-blocked point, **30 have no `finally` anywhere in their own source**.
`1746-stream-for-await` has zero `finally` blocks, one import, and
finally-blocked points.

**So the D4 population cannot be scoped from source at all.** Only lowering
reveals it. A source-level scan reported 11 candidate programs where the IR
says 41.

**The synthesised skeleton is fixed**, which makes a positive test possible:

```
tryCatch { tryBody: [<one loop>], catchBody: null,
           catchLocalId: null, finallyBody: [<one close stmt>] }
```

Classifier controlled both ways: `1746-stream-for-await` (no source
`finally`) classifies synthesised; `1452-return-through-finally` classifies
other. It is a **positive test for one family**, so "other" is a residual,
not a claim of authorship.

**Origin split (app182):** of the strict 56 reachable, **0 are synthesised --
all 56 are user-written.** Of all 77 finally-blocked, 6 are synthesised-only,
and every one of those 6 is **also** blocked by `pt:loop`.

That co-blocking is structural, not a coincidence: the lowering emits
`tryBody: [loop]`, so a suspension inside a synthesised iterator-close is
always simultaneously loop-blocked. **The synthesised family can never be
reached by closing `finally` alone, nor by closing `loop` alone.**

## 7. The joint `loop` + synthesised family

Strict solo filter throughout. app182 is app182; the corpus column is 227
dumps and is small **by exhaustion, not by sampling** (section 8).

| | `loop` solo | ...enclosing a `forOf` | joint `loop`+synthesised | ...enclosing a `forOf` |
|---|---|---|---|---|
| app182 | **24** fns, 42 pts | 5 | **3** fns, 3 pts | **0** |
| corpus | 33 fns, 96 pts | 15 | **24** fns, 48 pts | **0** |

**27 of 27 joint-family functions are plain `while`, zero enclose a
`forOf`.** That matters because of what `liveness.ts` says about `forOf`:

> *"A `forOf` names ONLY its binding -- its iterable reference and cursor are
> backend-internal and are not `IrLocal`s, so they cannot appear in `live`
> however correct the dataflow is. Each one is nevertheless real frame state
> a resumed body needs."*

That hidden cursor is the hard half of `loop`, the same class of invisible
state as `sc_pret` and the stash. The joint family never has it: its loop
state is ordinary `IrLocal`s the existing spill already handles.

**So the synthesised finally is neither a standalone slice nor the general
`loop` case renamed.** It rides on the *easy half* of `loop` -- plain
`while`, state in `IrLocal`s. In app182 that easy half is 19 of the 24
loop-solo functions; in the corpus, 18 of 33. The durable consequence:
**`loop` is two rungs, not one** -- plain `while` and `forOf` -- and that
split is a fact about the lowering rather than a count.

The two populations disagree about which half dominates (app182: 19 easy-loop
against 3 joint; corpus: 18 against 24), and the corpus cannot settle it.

## 8. The corpus is exhausted, not under-sampled

227 IR dumps already cover **226 of the 257** suspendable corpus entries. An
`--emit-ir` sweep of the remaining **31** costs ~0.1 GB and 3-4 minutes
single-threaded -- affordable, and nearly worthless: it cannot move the
D4-reachable corpus population materially above **n = 4**.

Every `scriptc-tests` build cache was checked across four worktrees (6,166 /
3,254 / 1,764 / 6,158 directories) and holds **zero** `.ir.json`: the caches
keep binaries, not IR.

**So D4 sequencing rests on one program by corpus exhaustion, not by
choice.** That is a stronger limitation than "we sampled 12%", and it is the
one that belongs in any ordering proposal. A second column needs programs
that do not exist yet -- another real application, or corpus programs written
for the purpose.

## 9. The three-copy mechanism, solved

The C emitter emits **16 suspending nodes twice** across 6 functions. The
cause: the finally body is emitted three times, so every suspending site
lexically inside one appears 3x in the C while the IR counts it once.

Excess = 2 x (emitted await sites inside a finally body), where an
`awaitUnionExpr` contributes a typed await **and** a hop:

```
predicted typed=16 hop=2     OBSERVED typed=+16 hop=+2
per function: [awaitExpr] -> 2/0 x3,  [awaitExpr,awaitExpr] -> 4/0 x2,
              [awaitUnionExpr] -> 2/2
```

All six match. The hypothesis was first tested against
`p.blockers.includes("finally")` -- which spans both shapes of section 1 --
so it counted awaits in the guarded try body, which are emitted once, and
over-predicted 4/8/6/10/6/6 against 2/2/2/4/2/4. Restricting to sites
lexically inside the `finallyBody` matches exactly.

**Consequence for D4:** all 6 double-emitters are blocked on `pt:finally`, so
they arm together **when D4 lands**, not one at a time. `coroPointIndex++`
has no bound against `plan.points.length` while `coroDispatch` emits only
`case 1..points.length` plus `default: abort()`. The bound landed separately;
any D4 work must keep it, and state numbering must become per-emitted-site
rather than per-IR-point.

## 10. Retractions, by name

A retraction that is not in the document comes back as fact. Two already did:
the `2,270` denominator (retracted in `stackless-llvm-port.md` section 9) and
the `-17.9% to -29.5%` peak-working-set pair, which was repeated for a whole
session and existed in no file at all.

- **The app182-versus-corpus inversion is RETRACTED.** It reported the corpus
  as dominated by shape (1) where app182 was dominated by return-crossing. It
  compared app182's **solo** set against the corpus's **all-blocked** set.
  The corpus's 32 shape-(1) functions are overwhelmingly generators, which
  carry `fn:generator`, are in the deliberately-out set, and **D4 would never
  admit them whatever it does** -- they were never in the reachable
  population. On matched populations the corpus has **n = 4** and agrees with
  app182 on the dominant piece (return-crossing 75% against 88%), supporting
  no claim in either direction.
- **The solo set is 56, not 64.** RETRACTED.
- **`loop` solo is 24, not 29.** RETRACTED.
- **Common cause of all three: a "solo" filter that read only POINT-level
  blockers and missed FUNCTION-level gates** (`fn:generator`,
  `fn:boxedParam`, a module-init cache). It is the same blindness that hid
  `fn:boxedParam` from the original ladder -- the largest blocker on it --
  for as long as that ladder listed only point blockers. Any future solo
  filter must include both, and the ladder instrument now asks
  `stacklessPlan` directly and aborts if its own attribution disagrees.

## 11. Not measured

- **Which slot predicate holds** -- the 2-versus-51 spread on rung (a). The
  probe in section 3 is designed and authorised, not run.
- Whether the 31-program `--emit-ir` sweep moves n above 4 at all.
- Whether shape (2) is a viable slice without shape (1): the fence is one
  flag today, and splitting it means distinguishing the two `finallyDepth`
  increment sites. That split is three lines (`liveness.ts:678`, `:689`,
  `:388`) and is cheap, but until it exists "shape (2) alone" is a count and
  not a slice.
- The blast radius of per-emitted-site state numbering.
- Whether the corpus's shape-(1) functions are concentrated or spread was
  measured (22 programs, top-3 holding 28%) but on the **unmatched**
  population, so it is not evidence about the reachable set.
- Everything in this file is app182 unless a line names the corpus, and every
  liveness-derived figure is a ceiling on reach and a floor on work.
