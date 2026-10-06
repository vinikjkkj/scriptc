# Porting the stackless lane to the LLVM backend

Companion to `stackless-frame-contract.md`, which specifies the C lane's
emitted shape. This file answers a different question: what it costs to give
the LLVM backend the same lowering, and why that is owed rather than
optional.

**Every number below names its lane.** Three lanes appear and they are not
interchangeable:

- **IR (lane-independent)** — produced by `ir/liveness.ts` over the
  `IrModule`, which both backends consume unchanged.
- **C lane** — read off the C emitter's output or source.
- **LLVM lane** — read off the LLVM emitter's output or source.

Measurements are on `tests/perf/zapo-rest/app182` (zapo-js 1.8.2, the real
load) at `f30d0d146` unless stated. A number without a lane and a
denominator is not a number; percentages never appear bare.

## 0. Why this is owed

`SCRIPTC_STACKLESS` exists only in the C emitter. The nine files under
`packages/compiler/src/backend/llvm/` contain **0 occurrences** of
`coroPlans`, `STACKLESS`, `stackless`, `scr_coro`, `ScrCoroBase`,
`coro_park`, `stacklessPlan`, `suspends.js` or `liveness.js`
(LLVM-lane source scan, positive-controlled: 226 `promise` hits in the same
file set, so the scan was capable of matching).

LLVM is the **default** backend (`packages/cli/src/main.ts:26`;
`index.ts:1205` tries it and falls back to C transparently). And the real
load takes it: **`app182` is on the LLVM tier at `f30d0d146`** — measured,
not inferred. `--backend llvm`, the fail-loud pin whose purpose is to raise
SC3001 naming the first out-of-tier construct, produced `zapo-rest.ll`
(229,342,779 bytes) and **no `.c`**, and raised no diagnostic. Lane read off
the artifact, never off a log line.

So today the entire measured stackless benefit lands on a lane the real
workload does not take. Either the LLVM lane gets the lowering, or the knob
never becomes the default and the two lanes keep permanently different
memory characteristics.

## 1. What needs no work: the analysis is already running on the LLVM lane

`coroPlans` is called at `index.ts:1249 -> :783` for **both** backends. The
LLVM lane already computes the full admissible set on every build and then
discards it on a link flag. The analysis is not "reusable"; it is already
there.

Nothing under `ir/` imports anything under `backend/`. `ir/liveness.ts`
imports only `./nodes.js` (types only) and `./suspends.js`. Neither backend
assigns any of the eight `IrFunction` fields `stacklessPlan` reads
(`.async`, `.generator`, `.asyncCacheGlobal`, `.asyncCycleCacheGlobal`,
`.boxed`, `.body`, `.params`, `.locals` — 0 hits each in both backends,
with a positive control firing on a field that is assigned). So the
admissible set cannot differ by backend.

**Admissible set (IR, lane-independent):**

| column | value | denominator |
|---|---|---|
| admissible functions | **990** | 1,304 functions that contain at least one suspension point (75.9%) |
| admissible suspension points | **1,555** | 2,260 suspension points in the module (68.8%) |

`1,304` is *functions with at least one suspension point*, not *suspendable
functions*: 1,489 functions are suspendable (1,487 async + 2 async
generators) and 185 of those contain no await at all.

### Two ladders that must never share a column

- **admissible (IR, lane-independent)** — 990/1,304 functions, 1,555/2,260
  points, above.
- **emitted conversion (C lane)** — a different column. `stackless-frame-contract.md`
  section 6 reports 533 of 1,489 suspendable functions and 753 of 2,270
  emitted await sites; **that table predates the split-TU fix and the
  nesting admission** and is stale. Section 8 of the same file reports
  **990 frame structs emitted (C lane, knob ON)**, i.e. 990 of 1,489
  suspendable functions.

### The headline memory figures, and what each one is allowed to support

Two different measurements get quoted interchangeably. They are not the
same claim and neither is reproducible from this repository as it stands.

**(a) Real load, C lane — `-17.9% to -29.5%` peak working set.**
Column: peak working set. Arms: knob ON against knob OFF. Lane: C. Host:
one machine, four runs arranged as two pairs of opposite arm order (peak
RSS on this rig is bimodal and order-sensitive, so arm order is rotated and
pairs are compared, never single runs). Taken at the C-lane emitted
conversion *of that moment*.

**This figure is NOT REPRODUCIBLE FROM THIS REPOSITORY and is PENDING
RE-DERIVATION.** It was measured during the session that produced this
document and was never persisted anywhere -- not in `docs/`, not in a
commit message, not in a rig output under `tests/perf/`. It is recorded
here, with its provenance stated as exactly that, so it stops circulating
as though it were on file. The emitted conversion has moved substantially
since it was taken (the split-TU fix and the nesting admission both
landed), so it is at best a **lower bound** on what the knob delivers on
the C lane today. Re-derive before quoting; see section 11.

**(b) Conversion ceiling, synthetic -- `-89.5%` peak privateCommit.**
From `fe60c3267`: `peak privateCommit 192.21 -> 20.22 MiB  -89.5%` and
`live fiber stacks 9,004 -> 3`, `stack commit 142.1 MiB -> 56 KiB`. This is
the **100% conversion ceiling, not the real load.** It answers "what would
the transform be worth if every suspension converted", and it must never be
quoted as a measurement of zapo-rest.

The lesson this paragraph exists to enforce: a measurement that matters is
persisted in the same turn that produces it, with lane, arms, column,
denominator, host regime and build -- or it is hearsay the next time it is
cited, however real it was when taken.

## 2. Construct-by-construct

`emit-coro.ts` (C lane) is 354 lines, **189 non-comment lines**, 13 exports,
plus ~20 hook sites elsewhere in the C emitter (emitter.ts 8,
emit-stmts.ts 8, emit-exprs.ts 1, emit-async.ts 1, index.ts 1, cc.ts 1, and
2 symbols in mangle.ts).

| C-lane construct | LLVM-lane counterpart | note |
|---|---|---|
| frame `typedef struct {ScrCoroBase base; …}` | declared `%coro_frame_*` type with typed GEPs | see section 5 |
| per-local spill field | typed GEP | direct |
| `protoOut` / `E.link` / `stripStatic` placement | **nothing** | the LLVM lane never splits a translation unit (`programUnits` is C-lane-only). An entire bug class disappears — misplacing the frame struct is what stopped the first split C build from compiling at all |
| `static void resume(ScrCoroBase *)` | `define internal void @resume(ptr %sc_b)` | direct |
| `switch (state) { case N: goto L; }` plus labels | `switch i32 … [ … ]` plus basic blocks | **simpler on the LLVM lane**, which needs the switch alone where C needs switch *and* gotos |
| dispatch must not jump past declarations | already satisfied | `BlockBuilder.entryAllocas` renders into the entry block, so every block is dominated by every alloca. The C lane's scope-flat-locals precondition is structural here |
| `coroReload` / `coroSpill` | load/store the allocas that already hold every local | direct: the LLVM lane is clang `-O0` style, every local is already memory |
| `scr_coro_alloc(sizeof *f, …)` | `ptrtoint getelementptr(null, i32 1)` | precedent exists — the fiber argpack already sizes itself this way |
| `coroFinish` (5 arms) and `coroUnwind` | the same runtime calls | direct |
| 12 `scr_coro_*` symbols | 12 `declare` lines | all are exported symbols: `scr_coro.h` contains **zero** `static inline`, so no `_v` twins are needed. And they are **pre-guarded** — `scr_coro.h` is already in `llvm-runtime-abi.test.ts`'s `HEADER_FILES`, so the ABI test checks any declare the emitter grows against the real prototype |

## 3. The hard part, sized

An SSA value that crosses a park. A park is `ret void`, so the resume block
is entered from the dispatch and **no value defined before the park
dominates it**.

**Nesting split of the admissible set (IR, lane-independent):**

| column | value | denominator |
|---|---|---|
| admissible points **not** nested in an expression | **1,509** | 1,555 admissible points (97.0%) |
| admissible points nested in an expression | 46 | 1,555 admissible points (3.0%) |
| admissible functions with **zero** nested points | **953** | 990 admissible functions (96.3%) |
| admissible functions with at least one nested point | 37 | 990 admissible functions (3.7%) |

A statement-root await materialises no operand temp across the park, so for
1,509 of the 1,555 admissible points **the crossing SSA set is empty by
construction**.

**LLVM-lane source counts**, for scale: `BlockBuilder.tmp()` has **1,480**
call sites and returns a bare untyped string, so there is no single typed
mint point to hook — but it is a problem for **37 of 990** admissible
functions, not for the port.

## 4. Options, costed in sites touched

| | mechanism | sites | reach | cost and risk |
|---|---|---|---|---|
| **C′** | refuse `nestedInExpression` in slice 1 | **0** | 953 of 990 admissible functions; 1,509 of 1,555 admissible points | the flag is already computed by the fence. Introduces an asymmetry — see below |
| **A** | spill at the `emitExpr` choke point: `llvm/emitter.ts:5303`, **one** `private emitExpr(e: IrExpr): LlValue` returning an already-typed `{name, type, slot?}` | **1** | all 990 admissible functions, all 1,555 admissible points | pays alloca + store + load on every expression result inside admissible functions: frame and code bloat, unmeasured. Gateable to coroutine bodies so nothing else moves |
| **B** | drop the `isRefCounted` filter in `own()` | 1 line | partial | **barred — see section 6** |
| **D** | give `BlockBuilder.tmp()` a type and a registry | **1,480** | all | dominated by A; most sites are GEPs and loads that cannot cross a park |
| **C** | derive the crossing set from the liveness pass that already runs | — | — | **not possible as posed.** Temps carry no `IrLocal` id, so liveness cannot name them — the same reason `SuspensionPoint.enclosingForOf` exists ("backend-internal and are not IrLocals, so they cannot appear in `live`"). Would need a new IR concept |

**LLVM-lane ownership choke points**, for reference: `own(` 209 call sites,
`ownSlot(` 3, `ownImmortal(` 1, `currentFrame()` 4, `moveTemp(` 92, and
`emitExpr(` 336 call sites against **one** definition. The C-lane analogue
`newTemp` has 312 call sites and registers **every** temp, refcounted or
not.

**Sequencing: C′ for slice 1, then A for the remaining 37 functions.**

### The C′ asymmetry is explicit and carries its own removal condition

C′ makes the admission fence backend-aware, which cuts against the property
that currently gives the LLVM lane its 990 for free: one analysis, two
lanes. It must therefore not be a silent parameter. Write it the way the
scaffolding assertions are written — the asymmetry stated, and the
condition for deleting it stated beside it:

> The LLVM slice-1 fence additionally refuses `nestedInExpression`. This is
> **not** a semantic difference between the lanes: the C lane lowers those
> 46 points because its temps are stack slots the spill can name by
> `newTemp`, while on the LLVM lane they are SSA values with no typed mint
> point. **Remove this clause when option A lands** — spill at the
> `emitExpr` choke point — at which moment the two lanes admit the same set
> again and this parameter must be **deleted, not defaulted**.

## 5. `%ScrCoroBase` is the 19th hand-declared struct, and `_Static_assert` ships with it

The dispatch reads `ScrCoroBase.state` (offset 24) and `.flags` (offset 28).
On the LLVM lane a struct field access is a hand-written constant that no
compiler checks: `runtime-layout.ts` says so in as many words, and covers
exactly **4 fields** (`ScrBytes.len`, `ScrBytes.data`, `ScrStr.len`,
`ScrStr.data`) while eighteen further struct bodies are declared by hand in
`llvm/emitter.ts` with **none** verified.

A wrong offset here is silent corruption of *coroutine state* — strictly
worse than any defect fixed to date on this front, because the frame would
resume at the wrong label rather than crash.

So: add `ScrCoroBase.state`, `.flags`, `.resume`, `.promise`, `.als` and
`.rc` to `RUNTIME_FIELD_OFFSETS` in the **same change** that emits the first
GEP against it. `runtime-layout.test.ts` already generates one
`_Static_assert(offsetof(…) == N)` per entry and compiles it through the
real driver with the real target flags, so the toolchain that builds the
runtime adjudicates rather than a layout model in TypeScript. If this is
the first of the 19 to gain verification, better — it opens the path for
the other 18.

## 6. Option B is barred

Dropping the `isRefCounted` filter in the LLVM lane's `own()` covers only
the 209 sites that reach it and leaves non-refcounted intermediates out of
the frame. That **reproduces exactly the pre-`aded31c96` C-lane defect**: a
`double` or `bool` evaluated before a nested suspension sat in no frame, was
never spilled, and came back indeterminate after the resume. It cost a
three-round bisect.

B is not a cheaper A. It is A with a hole, and the hole is a defect this
project has already paid for once.

## 7. Why the port is stageable: the failure is loud

An unspilled SSA value used after a resume label does not dominate its use,
and **the LLVM verifier rejects it at build time**. The identical mistake on
the C lane was a segfault, found by cutting a corpus program down in three
rounds.

That property is the staging rationale, not a footnote:

- **D** is tedious rather than dangerous: 1,480 sites that fail loudly are
  a better problem than 3 that fail silently.
- **A** can ship before its frame cost is tuned, because a miss cannot
  reach a binary.
- **C′** is safe to start from, because widening it later cannot silently
  regress — anything it wrongly admits fails the verifier.

## 8. Defects the port must not inherit

`async.awaitDyn` was a suspending libCall registered nowhere: it lowers to
`scr_await_dyn_value`, which reaches `scr_await_dyn`, whose first statement
is the fiber wait `scr_promise_await_settled`. Fixed for the C lane in
`bf1143f06`. **The
LLVM lane emits it too** (`LIB_FN_SYMS: "async.awaitDyn" ->
scr_await_dyn_value`), so the port must not re-open it.

Separately, **16 suspending nodes are emitted twice by the C emitter**, in 6
functions, all **outside** the admissible set (section 10). Latent, with a
named arming condition: if any of those 6 becomes admissible, it arms an
`abort()`, because `coroPointIndex++` (`emit-exprs.ts:8140`) has no bound
against `plan.points.length` while `coroDispatch` emits only
`case 1..points.length` plus `default: abort()`. Any port that reuses
`coroPointIndex` inherits this. **Bound the index against
`plan.points.length` rather than trusting the two to stay in step.**

## 9. The await ledger, so no denominator is left unattributed

**IR (lane-independent), 2,260 suspension points:** `awaitExpr` 2,223,
`awaitUnionExpr` 31, `yieldExpr` 5, `agenResume` 1. Plus suspending
libCalls, which are *not* points: `async.hop` 21, `async.awaitDyn` 1.
Verified complete: textual counts over the whole 480 MB IR dump equal the
deduplicated graph walk exactly, and nothing suspends inside the dump's
`classes`, `records` or `globals`.

**C lane, knob OFF, 2,325 emitted `scr_await_*` call sites:** `ref` 1,302,
`void` 796, `hop` 54, `bool` 51, `f64` 46, `str` 44, `dyn` 31,
`dyn_value` 1. The emitted shared header holds none.

The two sets **do not contain each other** and must never share a
denominator: `yieldExpr` and `agenResume` are points that emit
`scr_gen_*` / `scr_agen_*` rather than `scr_await_*`, while `hop` and
`dyn_value` are emitted for libCalls that are not points.

Exact bindings: `awaitUnionExpr` 31 ↔ `scr_await_dyn` 31, and
`async.awaitDyn` 1 ↔ `scr_await_dyn_value` 1. Every `awaitUnionExpr` emits
exactly one typed await plus one hop (`emit-exprs.ts:8198` for the
void-result shape; 8222–8239 for the value-result shape, whose count is 0
on this program).

### `2,270` is retracted

**This retraction SUPERSEDES two sources that use `2,270` as a
denominator**, and both are named so the next reader does not resolve the
disagreement against this file:

1. `docs/stackless-frame-contract.md` section 6, the row
   `suspension points on fibers | 2,270`, and the `33.2%` derived from it.
2. Commit `fe60c3267`, which states `753 of 2,270 suspension points
   (33.2%)`.

`2,270` was never a population. It is the output of a regex alternation --
`scr_await_(f64|bool|str|ref|void|dyn)` -- i.e. the 2,325 emitted
`scr_await_*` sites minus `hop` (54) and minus `dyn_value` (1): a set with
no definition behind it, mixing emitted call sites with IR points while
excluding two suspending libCalls for no stated reason.

What the correct denominators are:

| intended question | correct denominator |
|---|---|
| share of IR suspension points converted | **2,260** IR points (lane-independent) |
| share of *await-kind* points converted | **2,254** (`awaitExpr` 2,223 + `awaitUnionExpr` 31) |
| share of emitted await call sites | **2,325** (C lane, knob OFF) |

And `2,270` is not merely undefined, it is **inflated by a defect**:
2,270 = 2,254 + the 16 double-emitted nodes of section 10. So the widely
quoted `33.2%` (753/2,270) is computed against a denominator that is both
undefined and 16 too large; against 2,254 the same numerator reads 33.4%.

Recorded at this length on purpose: a retraction that does not survive into
the document becomes a good number again in three months, and one that does
not name what it supersedes reads as a private disagreement.

## 10. The 6 double-emitting functions (C lane)

Per-function join of the IR expectation against the C lane's emitted TU,
same build, knob OFF:

| function | awaits IR → C | hops IR → C | admissible |
|---|---|---|---|
| `%m198.uploadMediaStream` | 6 → 10 | 0 → 0 | no |
| `%m268.uploadHqFromStream` | 6 → 10 | 0 → 0 | no |
| `%m198.buildMediaMessage` | 7 → 9 | 0 → 0 | no |
| `%m173.performPlaintextMediaUpload` | 5 → 7 | 1 → 3 | no |
| `%m173.readFileHead` | 3 → 5 | 0 → 0 | no |
| `%%m252.WaRetryCoordinator.handleIncomingRetryReceipt` | 3 → 5 | 0 → 0 | no |

Excess sums to exactly **+16 awaits and +2 hops**, closing the ledger
against section 9. All six are media-upload and retry paths and **none is
admissible**, which is why a park-count-against-dispatch-case-count check
over the 990 converted C-lane bodies reads 0 divergences: the two
measurements agree rather than conflict, and together they localise the
defect.

Controls that make that zero mean something: per-function attribution sums
to the global totals exactly (awaits 2,270 of 2,270 attributed, hops 54 of
54 — nothing orphaned, which is what a body extractor that loses functions
would fail); 1,304 of 1,304 await-bearing IR functions were located in the
C, independently equal to the `withPoints` count from a separate liveness
census; and a fabricated mangled symbol was absent. The name mangling was
derived from `mangle.ts` rather than assumed.

## 11. Not measured

- **Re-derivation of the real-load peak working set at the CURRENT C-lane
  conversion.** The `-17.9% to -29.5%` pair in section 1 was measured but
  never persisted, and the conversion has moved since; it is a lower bound
  pending a fresh pair of opposite-order runs on a quiet host, with the
  worker count of any concurrent gate declared beside the number.
- The frame cost of option A, in bytes per admissible frame.
- Whether the two `fix(stack)` LLVM-lane commits of 2026-10-02 changed tier
  membership.
- The **mechanism** of the double emission in section 10. Per-TU
  duplication of a `static` helper was tested and **refuted**: awaits are
  concentrated in parts 1–6 and 14 rather than forming a per-TU baseline,
  and the shared header holds none.
- Whether any of the 6 functions in section 10 is reachable at runtime.
- A complete linked `app182` artifact (rc = 0). The lane was read off the
  emitted `.ll`; the link was interrupted during the zig phase. The zig
  available on the measuring host was 0.15.2, not the 0.16.0 of the earlier
  size record, so **no binary-size claim is possible from that run**.
- Emitted **point-level** conversion on the C lane today; only the function
  count (990 frames) is current.
- The LLVM census arm — `SCRIPTC_LLVM_CENSUS=1` enumerates every remaining
  tier gap, against the single bit the fail-loud pin provided.
