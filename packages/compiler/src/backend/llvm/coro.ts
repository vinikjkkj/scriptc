/* THE STACKLESS LOWERING, LLVM FLAVOURED -- emit-coro.ts's shape, emitted as
 * .ll instead of C.
 *
 * WHAT IS THE SAME AND WHY THAT MATTERS: the frame layout, the dispatch, the
 * spill/reload discipline and the four completion paths are the C lane's,
 * symbol for symbol. The runtime is not ported (scr_coro.c is linked by both
 * lanes), so a frame this file lays out wrong is not a compile error -- it is
 * scr_coro_alloc under-allocating, silently, on a host whose toolchain runs no
 * IR verifier at all (`zig cc` passes -disable-llvm-verifier). Every field
 * position here is pinned by runtime-layout.ts and proved against the real
 * header by runtime-layout.test.ts.
 *
 * WHAT IS CHEAPER HERE THAN IN C, because it changes what the slice has to
 * build. The C dispatch is a `switch`/`goto` into the middle of a function
 * body, and emit-coro.ts's header records that this is sound ONLY because
 * IrFunction.locals is scope-flat -- a jump past an initialiser would need the
 * body restructured first. LLVM has no lexical scopes and no declarations to
 * jump past: a function is a flat list of basic blocks and any terminator may
 * target any block. Both of the C lane's admission arguments are vacuous here.
 * Likewise the spill/reload: every IR local is ALREADY an `alloca` in the entry
 * block (blocks.ts's "clang -O0 style" model), and the entry block dominates
 * every resume block, so a spill is a `load` from the slot and a `store` to the
 * frame and a reload is the reverse. No renaming, no consumers to update, no
 * dominance question.
 *
 * WHAT IS HARDER HERE, and it is the reason this slice is narrow. C's reload
 * can redefine a name -- `x = sc_f->sc_v_x;` -- so a temp that dies across a
 * park comes back under its own spelling. An SSA `%tN` cannot be redefined: a
 * value minted before the park is not dominated by a use after it, because the
 * resume block is reachable only from the dispatch. blocks.ts carries the
 * invariant that fails the BUILD on exactly that, and the admission below keeps
 * out the shapes that would trip it rather than lowering them wrong. */
import type { IrFunction, IrLocal, IrStmt, IrType } from "../../ir/nodes.js";
import { isRefCounted } from "../../ir/nodes.js";
import type { StacklessPlan } from "../../ir/liveness.js";
import {
  libCallPointKind,
  STACKLESS_LOWERABLE_LIB_CALL_LIST,
  type SuspensionPointKind,
} from "../../ir/suspends.js";
import { mangleCoroField, mangleCoroFrame, mangleCoroResume } from "../mangle.js";

/** A function the STRUCTURAL predicate admitted and the EMISSION then refused.
 *
 * WHY THERE ARE TWO LAYERS AND NOT ONE. `llvmCoroLowers` reads the plan and the
 * IR; some of what disqualifies a shape is only knowable while emitting it --
 * whether anything is still OWNED at the moment the park is reached. The
 * analysis's own `nestedInExpression` flag is close but NOT sufficient, and the
 * counterexample is in the corpus rather than hypothetical: a one-field record
 * literal (`return { v: await p(n) }`) reports nestedInExpression === false --
 * a recordLit's `fields` are entries carrying no `kind`, so the literal counts
 * zero operands and never becomes "nested" -- while the emitter has already
 * allocated the record and is holding it owned when the await runs.
 *
 * So the emission refuses, the function keeps its FIBER lowering, and the build
 * stays green. That is the right outcome rather than a weaker one: the two
 * lowerings are interchangeable at the call site by construction, so a refusal
 * costs coverage and nothing else. What it must NOT do is leave the trial's
 * side effects behind -- see emitFunction's declare snapshot. */
export class CoroRefusedError extends Error {
  constructor(
    readonly fnName: string,
    readonly reason: string,
  ) {
    super(`llvm coro: ${fnName} refused at emission: ${reason}`);
    this.name = "CoroRefusedError";
  }
}

/** The state machine's block label for suspension point `i` (0-based) --
 * `coroLabel`'s twin, and deliberately the same spelling so an artifact from
 * either lane reads the same way. */
export function coroLabel(i: number): string {
  return `sc_S${i + 1}`;
}

/** `state` is field 3 of `%ScrCoroBase = type { ptr, ptr, ptr, i32, i32, i64 }`
 * -- offset 24, the one field this lowering addresses by GEP, pinned by
 * SCR_CORO_BASE_STATE_OFFSET in runtime-layout.ts and asserted against
 * scr_coro.h by runtime-layout.test.ts.
 *
 * The GEP is through %ScrCoroBase even for a FAT frame, and that is sound
 * rather than lucky: ScrCoroExc embeds ScrCoroBase as its FIRST member, so the
 * frame pointer, the base pointer and the exception-carrying base pointer are
 * all the same address. scr_coro.h states the same property for the C cast. */
export const CORO_STATE_FIELD = 3;

/** Does this frame need its own exception cell? TRUE when the body holds a
 * `try` that owns a `finally` -- a point inside such a try can resume with an
 * exception pending, and the cell a lean frame borrows belongs to whoever is on
 * the main stack at that moment, not to this frame.
 *
 * A TRANSCRIPTION OF coroNeedsExcCell, not an import, and the duplication is
 * deliberate: the C one takes a CEmitter-shaped walk over the same IR and
 * exporting it would couple the LLVM backend to the C emitter's module for one
 * boolean. The two must agree, and what makes them agree is that both ask the
 * IR the same question -- "is there a tryCatch with a finallyBody" -- rather
 * than keeping a list. */
export function coroNeedsExcCell(fn: IrFunction): boolean {
  let found = false;
  const walk = (v: unknown): void => {
    if (found || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const rec = v as Record<string, unknown>;
    if (rec["kind"] === "tryCatch" && rec["finallyBody"] !== null && rec["finallyBody"] !== undefined) {
      found = true;
      return;
    }
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      walk(rec[k]);
    }
  };
  walk(fn.body);
  return found;
}

/** True when some SUSPENSION sits inside a `finallyBody`, at any depth.
 *
 * THE ONE SHAPE THE REST OF THE PREDICATE WOULD ADMIT, and the reason is an
 * alloca slot rather than a temp. A `return` crossing a finally snapshots its
 * value into `%pretSlot` (emitter.ts's return case) and reads it back after the
 * finally copies have run. That slot is `alloca` memory of the RESUME CALL, and
 * every resume is a fresh call -- so a suspension BETWEEN the write and the
 * read reads garbage, silently, with the verifier happy because the slot is
 * dominance-legal. The C lane met this and moved the slot into the frame
 * (`sc_pret`); doing the same here is the cross-park ALLOCA mechanism, which is
 * a separate slice.
 *
 * A suspension in a try or catch body is fine and stays admitted: the snapshot
 * happens after the resume on every path, so nothing crosses. Only one INSIDE
 * the finally body inverts that order.
 *
 * THE HOP COUNTS, AND IT DID NOT USED TO. This read `awaitExpr ||
 * awaitUnionExpr` while the hop was unlowerable, which made it correct by
 * accident: a function carrying one was refused by KIND before this was ever
 * consulted. Admitting the hop voids that argument -- "a hop is a park", and
 * `%pretSlot` cannot tell them apart, because what breaks the slot is the
 * RETURN TO THE SCHEDULER and both do that. Widening the predicate without
 * widening this would have opened a silent wrong answer in the one position
 * whose defect no invariant on this lane can see. The precondition that made
 * the narrow spelling safe was owned somewhere else, and it was retired by the
 * same edit that needed it. */
export function suspensionInsideFinally(fn: IrFunction): boolean {
  let found = false;
  const hasSuspension = (v: unknown): boolean => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(hasSuspension);
    const rec = v as Record<string, unknown>;
    if (rec["kind"] === "awaitExpr" || rec["kind"] === "awaitUnionExpr") return true;
    // The hop is not a node kind -- it is an ordinary-looking libCall -- which
    // is exactly why a walk keyed on node kinds could not see it. Asked against
    // the authoritative list in ir/suspends.ts rather than a remembered name.
    if (rec["kind"] === "libCall" && typeof rec["fn"] === "string"
        && LLVM_LOWERABLE_LIB_CALLS.has(rec["fn"])) {
      return true;
    }
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      if (hasSuspension(rec[k])) return true;
    }
    return false;
  };
  const walk = (v: unknown): void => {
    if (found || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const rec = v as Record<string, unknown>;
    if (rec["kind"] === "tryCatch" && rec["finallyBody"] != null && hasSuspension(rec["finallyBody"])) {
      found = true;
      return;
    }
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      walk(rec[k]);
    }
  };
  walk(fn.body);
  return found;
}

/** The locals the frame carries: everything live across a suspension, plus
 * every parameter (the resume function has no parameters of its own, so a param
 * is reached only through the frame), plus every refcounted or boxed local
 * whether or not liveness called it live.
 *
 * THE THIRD RULE IS THE RC DISCIPLINE AND IT IS LOAD-BEARING, for the same
 * reason it is on the C lane. `plan.frameLocals` is liveness's LIVE set, and
 * live means "will be read again"; the RC discipline asks "does this still own
 * a reference", and the two disagree exactly where a local is never read after
 * the suspension but still has to be released at function end. A resume
 * RE-ENTERS the function, so the entry block's `store ptr null` runs again
 * before the dispatch -- an unspilled owned local is therefore NULL by the time
 * the release runs, the release is a no-op, and the whole graph it owned leaks.
 * Measured on the C lane at six lines of source: 1 object, 2 strings and 1
 * array.
 *
 * Capture boxes are REMOVED: they come back from `sc_env->caps[i]` on every
 * resume, and two sources for one binding is how a shared box silently stops
 * being shared. */
export function coroFrameLocals(fn: IrFunction, plan: StacklessPlan): string[] {
  const ids = new Set<string>(plan.frameLocals);
  for (const p of fn.params) ids.add(p.localId);
  for (const l of fn.locals) if (l.boxed === true || isRefCounted(l.type)) ids.add(l.id);
  for (const c of fn.captures ?? []) ids.delete(c.localId);
  // Declaration order, so the struct layout is stable across runs and two
  // builds of the same source produce the same bytes.
  return fn.locals.filter((l) => ids.has(l.id)).map((l) => l.id);
}

/** One frame field: its LLVM type and the GEP index it sits at. */
export interface CoroFrameField {
  index: number;
  llType: string;
  comment: string;
}

/** The whole frame layout, computed ONCE and consulted by the type emission,
 * the spawn wrapper, the spill and the reload.
 *
 * ONE SOURCE FOR THE INDICES, and that is the point of returning a map rather
 * than letting each of those four recompute the order. A frame field addressed
 * by a GEP whose index disagrees with the type body is not a compile error on
 * this host -- it is a load of the wrong field, of a plausible type, at
 * runtime. cc.ts states the same rule for the link line in as many words: two
 * sources for one fact is what makes the faces. */
export interface CoroFrameLayout {
  /** The `%sc_cf_<fn>` type body, as the `type { ... }` text. */
  typeBody: string;
  /** localId -> field. */
  fields: Map<string, CoroFrameField>;
  /** The GEP index of `sc_awaited`. */
  awaitedIndex: number;
  /** True when the base is `%ScrCoroExc` rather than `%ScrCoroBase`. */
  fat: boolean;
  /** The ordered local ids the spill and the reload walk. */
  localIds: string[];
}

export function coroFrameLayout(
  fn: IrFunction,
  plan: StacklessPlan,
  localsById: Map<string, IrLocal>,
  llType: (t: IrType) => string,
): CoroFrameLayout {
  const fat = coroNeedsExcCell(fn);
  const members: string[] = [fat ? "%ScrCoroExc" : "%ScrCoroBase"];
  const comments: string[] = ["base"];
  const fields = new Map<string, CoroFrameField>();
  if (fn.captures !== undefined) {
    members.push("ptr");
    comments.push("sc_env (lifted)");
  }
  const localIds = coroFrameLocals(fn, plan);
  for (const id of localIds) {
    const l = localsById.get(id)!;
    // A boxed local is a ScrBox* in the body; the frame carries the same
    // pointer, so the shared binding survives the suspension unchanged. A
    // caught-typed local holds the ScrCaught snapshot box, also a pointer.
    const ty = l.boxed === true || l.type.kind === "caught" ? "ptr" : llType(l.type);
    fields.set(id, { index: members.length, llType: ty, comment: l.name });
    members.push(ty);
    comments.push(l.name);
  }
  const awaitedIndex = members.length;
  members.push("ptr");
  comments.push("sc_awaited");
  return {
    typeBody: `%${mangleCoroFrame(fn.name)} = type { ${members.join(", ")} } ; ${comments.join(", ")}`,
    fields,
    awaitedIndex,
    fat,
    localIds,
  };
}

/** `sizeof *frame` on the .ll side. The frame allocation is
 * `scr_coro_alloc(sizeof *frame, ...)`, and C computes it for the C lane; here
 * it is the null-GEP idiom the async arg-pack already uses. A `%ScrCoroBase`
 * body that is too short therefore under-allocates EVERY frame of this
 * function, silently -- which is why the body is pinned by a table proved
 * against the real header rather than written out here. */
export function coroFrameSizeOf(fnName: string): string {
  return `ptrtoint (ptr getelementptr (%${mangleCoroFrame(fnName)}, ptr null, i32 1) to i64)`;
}

export { mangleCoroFrame, mangleCoroResume, mangleCoroField };

/** Fails to compile unless T is `never`. The reverse half of the binding
 * below. Spelled here rather than imported because it is a one-line type
 * helper, not a fact: ir/suspends.ts keeps its own for the same purpose, and
 * two copies of a helper do not drift the way two copies of a LIST do. */
type AssertNever<T extends never> = T;

/** THE POINT KINDS THIS BACKEND LOWERS, and the ones it does not -- CLASSIFIED,
 * not filtered.
 *
 * BOUND IN BOTH DIRECTIONS, and that is the whole reason there are two lists
 * instead of one set and an `else`. Each is `satisfies readonly
 * SuspensionPointKind[]` (nothing in a list that is not a real point kind) and
 * together they are passed through `AssertNever` against the union (nothing in
 * the union that is in neither list). So registering a new suspension point
 * kind in ir/suspends.ts FAILS TO COMPILE HERE until someone says which side it
 * is on. The alternative -- a lowerable set and everything else refused -- makes
 * a new kind default to "refused" in silence, which is the exact failure
 * suspends.ts's own header was written against: a union member that compiles
 * clean and is rejected by every consumer without anyone deciding it.
 *
 * WHY EACH ABSENTEE IS ABSENT. These are reasons, and a reason that stops being
 * true is a slice:
 *
 *   awaitUnionExpr -- ONE point, TWO ways in: the promise arm parks and the
 *     unit arm hops, sharing one state and one resume label. The block shape is
 *     not the blocker; the UNION TEMP is. It is a refcounted `ScrUnion *`, so
 *     `own()` records it, and it is still owned when the suspension is reached
 *     AND read again after the resume -- measured in the fiber lowering of
 *     `wav`, where `%t6` is released on both far-side paths. It cannot ride
 *     `sc_awaited` either, because that field is the arm DISCRIMINATOR (the hop
 *     arm stores NULL there). So this kind is blocked on the cross-park owned
 *     temp mechanism -- the `sc_tmp_` frame fields the C lane lays out -- and
 *     not on anything in this file.
 *
 *   yieldExpr -- a generator. emitAsyncScaffolding does not own one.
 *   genResume / agenResume -- the CONSUMER side, refused on the C lane too. */
export const LLVM_LOWERABLE_POINT_KIND_LIST = [
  "awaitExpr",
  // Spelled through libCallPointKind so the `libCall:` prefix has one author.
  libCallPointKind("async.hop"),
] as const satisfies readonly SuspensionPointKind[];

export const LLVM_UNLOWERABLE_POINT_KIND_LIST = [
  "awaitUnionExpr",
  "yieldExpr",
  "genResume",
  "agenResume",
] as const satisfies readonly SuspensionPointKind[];

type _Lowerable = (typeof LLVM_LOWERABLE_POINT_KIND_LIST)[number];
type _Unlowerable = (typeof LLVM_UNLOWERABLE_POINT_KIND_LIST)[number];
/** Every point kind is on exactly one side: nothing unclassified ... */
type _PointKindsClassified = AssertNever<Exclude<SuspensionPointKind, _Lowerable | _Unlowerable>>;
/** ... and nothing on both, which `satisfies` alone cannot catch. */
type _PointKindsDisjoint = AssertNever<Extract<_Lowerable, _Unlowerable>>;

const LLVM_LOWERABLE_POINT_KINDS: ReadonlySet<string> = new Set<SuspensionPointKind>(
  LLVM_LOWERABLE_POINT_KIND_LIST,
);

/** The point kinds the `nestedInExpression` PRE-FILTER does not apply to,
 * because the property that flag stands in for cannot hold of them.
 *
 * WHAT THE FLAG MEANS, and it is a different question from what this backend
 * asks of it. liveness sets `nested` when a suspension sits at depth inside a
 * larger expression, and uses it to WIDEN THE LIVE SET conservatively. This
 * backend borrowed it as a cheap proxy for "a temporary is already materialised
 * and owned when the suspension is reached" -- and coro.ts's own header already
 * records that the proxy is "close but NOT sufficient". It is also NOT
 * NECESSARY, which is what this set is about.
 *
 * WHY THE BARE HOP IS EXEMPT, and the reason is a property of the construct
 * rather than of this program. liveness.ts states it in its own words: "a bare
 * hop carries no operand at all, so there is no promise to own across the park
 * and nothing to take on the far side." A point with NO OPERANDS cannot have
 * operands materialised before it. Its `nested` flag is nevertheless TRUE for
 * every hop in every program, unconditionally, because the frontend desugars
 * `await <non-promise>` into a `seqExpr` holding a hidden-local `varDecl`, the
 * `async.hop` libCall and a read of that local (lower-exprs.ts). The hop is
 * therefore at depth inside the scaffolding THE DESUGAR ITSELF BUILT -- the
 * flag is reporting the shape of the lowering, not a materialised temporary.
 *
 * MEASURED, not reasoned: the whole hop bucket (whn, whs, wha, whu, whv and
 * hopsteps) refused as `nested-in-expression` the moment the point count
 * opened, while their fiber lowerings show every owned temp released BEFORE
 * `scr_await_hop` and the hidden `%awaited` living in an IrLocal alloca that
 * the frame already carries. Zero temps owned at the hop, six refusals.
 *
 * WHY DROPPING THE PRE-FILTER HERE IS SAFE, which is the part that matters:
 * what it was standing in for is measured EXACTLY, one layer down, by the
 * emitter's own `owned > 0` check at the hop, and anything it still misses is
 * caught by blocks.ts's cross-park temp invariant. BOTH are recoverable --
 * emitFunction catches CoroRefusedError and CrossParkTempError alike, restores
 * the declare snapshot and re-emits the body on the fiber lane -- so the worst
 * outcome of being wrong here is a function that keeps the lowering it already
 * had. That is a loss of coverage and nothing else; the two lowerings are
 * interchangeable at the call site.
 *
 * AND WHY IT IS NOT JUST "ADJUSTING UNTIL THE LIST LOOKS RIGHT". It is keyed on
 * the KIND, not on names, and on a property (`no operands`) that is true of the
 * construct everywhere rather than true of these six wrappers. An `awaitExpr`
 * stays filtered: it HAS an operand, the promise, and a nested one really does
 * sit in a temporary. The nested-await bucket is untouched by this and remains
 * the cross-park temp slice's subject. */
const POINT_KINDS_WITHOUT_AN_OPERAND: ReadonlySet<string> = new Set<SuspensionPointKind>([
  libCallPointKind("async.hop"),
]);

/** The suspending libCalls this backend lowers, DERIVED from the list above by
 * asking which of the stackless-lowerable ones has a point kind on the admitted
 * side. Not a second list: `suspensionInsideFinally` walks raw IR, where a hop
 * is a `libCall` node with an `fn` string and no point kind attached, so it
 * needs the question in that vocabulary -- and deriving it means admitting a
 * new libCall point kind cannot leave this walk blind to it. */
const LLVM_LOWERABLE_LIB_CALLS: ReadonlySet<string> = new Set(
  STACKLESS_LOWERABLE_LIB_CALL_LIST.filter((f) => LLVM_LOWERABLE_POINT_KINDS.has(libCallPointKind(f))),
);

const _pointKindBindingUsed: readonly unknown[] = [
  null as unknown as _PointKindsClassified,
  null as unknown as _PointKindsDisjoint,
];
void _pointKindBindingUsed;

/** THE ADMISSION PREDICATE -- which planned functions THIS backend lowers.
 *
 * It is deliberately NARROWER than `coroPlans`, and the gap is the whole shape
 * of this slice. The C emitter lowers every function the plan admits, so there
 * plan membership and lowering are the same set; here they are not, and
 * everything downstream -- the declare set, the link switch, the test ledger --
 * has to key on what was LOWERED rather than on what was planned.
 *
 * THE CONDITIONS, each with the mechanism it keeps out:
 *
 *   1. AT LEAST ONE suspension point. The count is otherwise FREE: a second
 *      point is a second state, a second resume block and a second spill site,
 *      and the dispatch has been built from `plan.points.length` since S1. What
 *      a multi-point body costs is carried by conditions 2 and 3, which is why
 *      they are quantified over every point rather than asked of the first.
 *
 *   2. EVERY POINT IS A KIND THIS BACKEND LOWERS -- see the classified lists
 *      below. `awaitExpr` and the bare microtask hop (`libCall:async.hop`) are
 *      in; `awaitUnionExpr` is not, and the reason is stated where it is
 *      classified rather than here.
 *
 *   3. NO POINT IS NESTED IN A LARGER EXPRESSION. `nestedInExpression` is the
 *      analysis's own flag for "operands evaluated BEFORE this point are
 *      already materialised in temporaries the frame must also hold". Those
 *      temporaries are `%tN` SSA values on this lane, and an SSA value cannot
 *      be reloaded under its own name -- carrying one across a park is the
 *      cross-park temp mechanism, which is a separate slice. blocks.ts's
 *      invariant fails the build if one ever slips through, so this condition
 *      is the thing that keeps the build green rather than the thing that keeps
 *      it correct.
 *
 *   4. NO SUSPENSION INSIDE A `finally` BODY -- see suspensionInsideFinally:
 *      that is the cross-park ALLOCA mechanism (`%pretSlot`), which no
 *      invariant on this lane can see.
 *
 * ONE SOURCE FOR THE VERDICT. This function is `coroRefusalReason(...) === null`
 * and nothing else. They were two parallel condition lists reading the same
 * fields in the same order, which is the shape that drifts: the census would
 * have gone on reporting the OLD reason for a function the predicate now
 * admits, and a census that disagrees with the predicate mis-orders every
 * slice that reads it. Opening the point count is exactly the edit that would
 * have desynchronised them.
 *
 * WHAT THIS IS NOT: a list of function names. The membership is recomputed from
 * the plan on every build, so a liveness change that admits a new shape shows
 * up here as coverage rather than as a list that quietly went stale. */
export function llvmCoroLowers(fn: IrFunction, plan: StacklessPlan): boolean {
  return coroRefusalReason(fn, plan) === null;
}

/** The subset of a module's stackless plans that the LLVM backend lowers. */
export function llvmCoroPlans(
  fns: readonly IrFunction[],
  plans: Map<string, StacklessPlan>,
): Map<string, StacklessPlan> {
  const out = new Map<string, StacklessPlan>();
  for (const fn of fns) {
    const plan = plans.get(fn.name);
    if (plan !== undefined && llvmCoroLowers(fn, plan)) out.set(fn.name, plan);
  }
  return out;
}

/** The suspension points this body contains, by IR node kind, for the census
 * the harness reads. Exported so a scope question ("what would widening
 * condition N buy?") is answered by running the compiler rather than by
 * reading this file. */
export function coroRefusalReason(fn: IrFunction, plan: StacklessPlan): string | null {
  if (fn.generator !== undefined) return "generator";
  if (fn.async !== true) return "not-async";
  // A plan with no point has no state and no dispatch to build. It cannot
  // arrive today -- `suspensionLiveness` returns null when it finds none, so
  // `stacklessPlan` bails before building one -- and the guard costs nothing
  // next to a dispatch whose `switch` would carry only the entry arm.
  if (plan.points.length === 0) return "points=0";
  // QUANTIFIED OVER EVERY POINT, and that is the whole hazard of opening the
  // count. Both tests below used to read `plan.points[0]` because there was
  // only ever one of them; leaving them that way while admitting a second
  // point would admit a function on the strength of its FIRST point and lower
  // its second one wrong -- a silent widening, which on this host is a silent
  // wrong answer.
  for (const pt of plan.points) {
    if (!LLVM_LOWERABLE_POINT_KINDS.has(pt.kind)) return `kind=${pt.kind}`;
  }
  for (const pt of plan.points) {
    if (pt.nestedInExpression && !POINT_KINDS_WITHOUT_AN_OPERAND.has(pt.kind)) {
      return "nested-in-expression";
    }
  }
  if (suspensionInsideFinally(fn)) return "suspension-inside-finally";
  return null;
}

/** A statement body walk shared by the refusal checks above. Kept here rather
 * than imported from the C emitter so this module depends on the IR only. */
export type { IrStmt };

/** The suspension CALL SITES in a rendered resume body, counted out of the text
 * the function actually emitted.
 *
 * READ BACK OUT OF THE `.ll`, NOT TALLIED BESIDE THE EMISSION, and that is the
 * whole value of it. A counter incremented next to the `B.line` that emits the
 * call is a copy kept beside the thing it copies: it agrees with the emission
 * by construction and can only ever report that the emitter did what the
 * emitter did. Reading the rendered body is an independent measurement of what
 * came out, so a site emitted twice, or a state drawn with no site emitted at
 * all, moves one side and not the other. */
export function coroSuspensionSites(body: string): { parks: number; hops: number } {
  return {
    parks: (body.match(/call i32 @scr_coro_park\(/g) ?? []).length,
    hops: (body.match(/call void @scr_coro_hop\(/g) ?? []).length,
  };
}

/** THE SECOND COUNTABLE INVARIANT:
 *
 *     parkCalls + hopCalls === statesDrawn + unionPoints
 *
 * WHY THE FIRST ONE IS NOT ENOUGH. D5 in emitFunction asserts `boundaries ===
 * statesDrawn === plan.points.length`, and all three of those are counted at
 * the POINT: one draw, one boundary, one state. None of them can see whether a
 * suspension CALL was emitted at all. A point that drew its state, took its
 * boundary and emitted no `scr_coro_park`/`scr_coro_hop` is a function that
 * never returns to the scheduler and never suspends -- a wrong TURN COUNT with
 * every value still correct, which is invisible to a value comparison and, on
 * this host, invisible to everything else as well.
 *
 * WHY `unionPoints` IS IN THE FORMULA WHILE IT IS ALWAYS ZERO TODAY. An
 * `awaitUnionExpr` is ONE point and ONE state that emits TWO suspension calls
 * -- a park on the promise arm and a hop on the unit arm, sharing one resume
 * label. Measured in the C lane's own output for `wav`, `waun` and `waus`: one
 * park, one hop, ONE label, ONE dispatch case. So the spelling "parks + hops
 * equals the state count", which is TRUE for the bare hop and is stated that
 * way in emit-coro.ts, is FALSE for the union by exactly one per union point.
 * The universal spelling is the one emitCoroUnionSuspend's own header gives:
 * one STATE per point, one resume LABEL per state.
 *
 * The term is carried from the day the hop lands, with the backend passing
 * zero, so that when the union arrives the arithmetic is already right and
 * nobody meets a failing assertion and reaches for the loosening. That is the
 * failure mode a countable invariant has: the pressure at the moment it first
 * goes red is to widen it until it passes, which destroys it exactly as
 * thoroughly as never having written it. */
export function coroCheckSuspensionSites(
  fnName: string,
  body: string,
  statesDrawn: number,
  unionPoints: number,
): void {
  const { parks, hops } = coroSuspensionSites(body);
  const expected = statesDrawn + unionPoints;
  if (parks + hops !== expected) {
    throw new Error(
      `llvm emitter bug: ${fnName} emitted ${parks} park(s) and ${hops} hop(s) -- ${parks + hops} ` +
        `suspension call(s) -- but drew ${statesDrawn} state(s) with ${unionPoints} two-armed ` +
        `point(s), which requires ${expected}. Too few means a point drew a state and a resume ` +
        `label but never returns to the scheduler: every value stays correct and the TURN COUNT ` +
        `is wrong, which no value comparison can report. Too many means a point was emitted ` +
        `twice and the second write lands on a state the dispatch routes elsewhere.`,
    );
  }
}
