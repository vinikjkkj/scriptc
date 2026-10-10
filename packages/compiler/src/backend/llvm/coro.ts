/* THE STACKLESS LOWERING, LLVM FLAVOURED -- emit-coro.ts's shape, emitted as
 * .ll instead of C.
 *
 * WHAT IS THE SAME AND WHY THAT MATTERS: the frame layout, the dispatch, the
 * spill/reload discipline and the four completion paths are the C lane's,
 * symbol for symbol. The runtime is not ported (scr_coro.c is linked by both
 * lanes), so a frame this file lays out wrong is not a compile error -- it is
 * scr_coro_alloc under-allocating, silently.
 *
 * THE REASON IS NOT "THIS HOST RUNS NO IR VERIFIER". It does. That premise was
 * stated here and in three other places, and it is corrected rather than
 * quietly dropped because it was load-bearing in blocks.ts, where the
 * correction changes what a rule is FOR. `-disable-llvm-verifier` turns off the
 * verifier pass in the OPTIMISATION pipeline, not the check `zig cc` runs when
 * it PARSES `.ll` text: measured on this tree's own artifact, a dominance
 * violation exits 1 with "Instruction does not dominate all uses!" while the
 * unmodified file exits 0.
 *
 * THE CONCLUSION SURVIVES ANYWAY, BY A DIFFERENT MECHANISM, and both halves of
 * the sentence have to travel together because either alone misleads. The
 * oracle sees DOMINANCE; a frame struct that is too short is well-formed IR in
 * every respect it checks. Measured on the same artifact: narrowing
 * %ScrCoroBase's last field from i64 to i32 -- every GEP index still in range,
 * every type still legal -- compiles to exit 0 with no diagnostic and
 * under-allocates every frame. So there is still no external oracle for THIS
 * class, and every field position here is pinned by runtime-layout.ts and
 * proved against the real header by runtime-layout.test.ts.
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

/* `suspensionInsideFinally` STOOD HERE AND IS GONE, deleted rather than left
 * exported with no reader.
 *
 * ITS LAST JOB WAS TO CLASSIFY AN OVERFLOW THAT CAN NO LONGER HAPPEN. It began
 * as condition 4 -- no function holding a suspension inside a `finally` body
 * was lowered at all -- was demoted to the classifier that told a
 * `finally-body-copied-past-its-state` refusal apart from the emitter bug the
 * same overflow is for every other function, and is now unemployed: states are
 * drawn PER EMITTED SITE, so a body written once per completion path takes one
 * state per copy and nothing overflows. See emitter.ts's coroDrawState.
 *
 * IT IS DELETED AND NOT KEPT FOR LATER because an exported structural walk no
 * caller reads is a counter reading zero mechanically, and this file has
 * already paid for one of those. Re-deriving it is twenty lines; carrying it
 * dead costs a reader on every pass and reads as a live guard.
 *
 * THE HAZARD IT NAMED IS STILL GUARDED, by the mechanism that always actually
 * held it: `%pretSlot` comes from `B.slot()`, so it is a registered
 * resume-call-private slot and blocks.ts's cross-park SLOT rule sees a read
 * after a park that did not re-write it -- carrying it in the frame or
 * refusing the function. That is no longer an argument on paper: `wfy7`
 * returns a refcounted value THROUGH a suspending finally, lowers, and its
 * artifact carries `%s12 = alloca ptr ; pending return (through finally)`
 * through the coroutine frame. */

/** The locals the frame carries:}

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
  /** `%tN` -> the field carrying it across a park, in discovery order. The C
   * lane's `sc_tmp_` fields by another name. */
  tempFields: Map<string, CoroFrameField>;
  /** `%sN` -> the field carrying the SLOT across a park. Unlike tempFields
   * these need no rename on the far side: the reload stores back through the
   * same alloca, so every use keeps its spelling. */
  slotFields: Map<string, CoroFrameField>;
}

/** A temp the emission discovered must survive a park, with the type its
 * defining instruction gave it. Discovered by re-emitting the body (see
 * emitFunction's fixpoint), so it is an INPUT to the layout of the next pass
 * rather than something the analysis could have supplied. */
export interface CoroTempSpill {
  name: string;
  llType: string;
}

/** A SLOT the emission discovered must survive a park -- the alloca class,
 * which no SSA rule can see (blocks.ts's CrossParkSlotError says why).
 *
 * WHY IT IS A SEPARATE KIND FROM CoroTempSpill even though both end in a
 * frame field. A temp is an SSA VALUE: carrying it means spilling the value
 * and reloading it into a FRESH name, so every later use has to be renamed.
 * A slot is MEMORY: carrying it means storing through the same alloca on the
 * far side, and not one use changes. That is also why a slot can cross SEVERAL
 * suspensions while a temp cannot -- the reload writes memory every path can
 * see, which is exactly the mechanism emitCoroTempSpill's refusal names as
 * the one it does not have. */
export interface CoroSlotSpill {
  name: string;
  llType: string;
}

export function coroFrameLayout(
  fn: IrFunction,
  plan: StacklessPlan,
  localsById: Map<string, IrLocal>,
  llType: (t: IrType) => string,
  tempSpills: readonly CoroTempSpill[] = [],
  slotSpills: readonly CoroSlotSpill[] = [],
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
  // THE TEMP FIELDS GO LAST, AFTER sc_awaited, and that is deliberate: the set
  // is discovered by re-emitting, so it GROWS between passes, and appending
  // keeps every index the earlier members already had. A temp field inserted
  // in the middle would renumber `sc_awaited` on the second pass -- the same
  // GEP index addressing a different member, which on this host is a load of
  // the wrong field of a plausible type rather than any kind of error.
  const tempFields = new Map<string, CoroFrameField>();
  for (const t of tempSpills) {
    tempFields.set(t.name, { index: members.length, llType: t.llType, comment: `sc_tmp_${t.name.slice(1)}` });
    members.push(t.llType);
    comments.push(`sc_tmp_${t.name.slice(1)}`);
  }
  // THE SLOT FIELDS GO LAST, for the same reason the temp fields go after
  // sc_awaited: the set is discovered by re-emitting and therefore GROWS
  // between passes, and appending is what keeps every index an earlier member
  // already had. Slots are appended after temps rather than before so that a
  // pass which discovers a new TEMP does not renumber the slot fields.
  const slotFields = new Map<string, CoroFrameField>();
  for (const s of slotSpills) {
    slotFields.set(s.name, { index: members.length, llType: s.llType, comment: `sc_slot_${s.name.slice(1)}` });
    members.push(s.llType);
    comments.push(`sc_slot_${s.name.slice(1)}`);
  }
  return {
    typeBody: `%${mangleCoroFrame(fn.name)} = type { ${members.join(", ")} } ; ${comments.join(", ")}`,
    fields,
    awaitedIndex,
    fat,
    localIds,
    tempFields,
    slotFields,
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
 *   [awaitUnionExpr HAS MOVED to the lowerable list, and the reason it was
 *     here is recorded because it is how the absentee list is meant to work.
 *     It said: the block shape is not the blocker, the UNION TEMP is -- a
 *     refcounted `ScrUnion *` that `own()` records, still owned when the
 *     suspension is reached and read again after the resume, and unable to ride
 *     `sc_awaited` because that field is the arm DISCRIMINATOR. That was true,
 *     and the cross-park temp mechanism retired it. Re-derived on THIS base
 *     rather than carried: the set is ONE temp (`%t6`, the union) in all three
 *     of wav/waun/waus, not the 2 and 3 the C lane reports -- those were
 *     `sc_tmp_` counts, and the C emitter frames every temp, refcounted or not.
 *     A number from another lane is a different population, not a smaller one.]
 *
 *   yieldExpr -- a generator. emitAsyncScaffolding does not own one.
 *   genResume / agenResume -- the CONSUMER side, refused on the C lane too. */
export const LLVM_LOWERABLE_POINT_KIND_LIST = [
  "awaitExpr",
  // Spelled through libCallPointKind so the `libCall:` prefix has one author.
  libCallPointKind("async.hop"),
  // ONE point, ONE state, ONE resume label, TWO suspension calls. Being on
  // this list is not the whole admission for it: a result union with more than
  // one unit arm is still refused, at emission, with its own census reason --
  // see emitCoroUnionAwait.
  "awaitUnionExpr",
] as const satisfies readonly SuspensionPointKind[];

export const LLVM_UNLOWERABLE_POINT_KIND_LIST = [
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
 * side. Not a second list: `assertBareSuspendingLibCalls` walks raw IR, where a
 * hop is a `libCall` node with an `fn` string and no point kind attached, so it
 * needs the question in that vocabulary -- and deriving it means admitting a
 * new libCall point kind cannot leave that walk blind to it.
 *
 * IT HAD TWO READERS AND HAS ONE. `suspensionInsideFinally` was the other; it
 * was deleted when states stopped being drawn per plan point. The derivation
 * is kept for the reader that remains, and for the same reason. */
const LLVM_LOWERABLE_LIB_CALLS: ReadonlySet<string> = new Set(
  STACKLESS_LOWERABLE_LIB_CALL_LIST.filter((f) => LLVM_LOWERABLE_POINT_KINDS.has(libCallPointKind(f))),
);

const _pointKindBindingUsed: readonly unknown[] = [
  null as unknown as _PointKindsClassified,
  null as unknown as _PointKindsDisjoint,
];
void _pointKindBindingUsed;


/** A suspending libCall this backend exempted from the nesting pre-filter has
 * turned out to carry an operand. See assertBareSuspendingLibCalls. */
export class HopOperandFenceError extends Error {
  constructor(readonly fnName: string, readonly sites: readonly string[]) {
    super(
      `llvm coro: ${fnName} holds a suspending libCall WITH OPERANDS (${sites.join(", ")}), ` +
        `but this backend exempts that point kind from the nested-in-expression pre-filter ` +
        `precisely because it carries none. The exemption's precondition no longer holds, so ` +
        `the pre-filter is now admitting a point whose operands may be materialised in SSA ` +
        `temporaries across the suspension. Either give the operand-bearing form its own ` +
        `point kind, or remove the kind from POINT_KINDS_WITHOUT_AN_OPERAND and let the ` +
        `pre-filter refuse it.`,
    );
    this.name = "HopOperandFenceError";
  }
}

/** Every suspending libCall in this body that carries operands, as
 * `fn(argCount)` strings. Empty is the expected answer.
 *
 * PURE AND EXPORTED so its own guard can feed it a one-operand hop and require
 * a complaint back -- a fence with no way to fire is a comment. */
export function operandBearingSuspendingLibCalls(fn: IrFunction): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    const rec = v as Record<string, unknown>;
    if (rec["kind"] === "libCall" && typeof rec["fn"] === "string"
        && LLVM_LOWERABLE_LIB_CALLS.has(rec["fn"])) {
      const args = rec["args"];
      if (Array.isArray(args) && args.length > 0) out.push(`${rec["fn"]}(${args.length})`);
    }
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      walk(rec[k]);
    }
  };
  walk(fn.body);
  return out;
}

/** THE FENCE UNDER THE HOP EXEMPTION, and it exists because this slice just
 * fixed a defect of exactly this shape one function away.
 *
 * `awaitInsideFinally` tested for `awaitExpr || awaitUnionExpr` and was correct
 * ONLY because the hop was refused by KIND before it was ever consulted. When
 * the hop became lowerable, the precondition that made the narrow spelling safe
 * was retired BY THE SAME EDIT THAT NEEDED IT, and nothing failed. It had to be
 * read for.
 *
 * POINT_KINDS_WITHOUT_AN_OPERAND has the identical structure. It rests on a
 * property liveness.ts states about itself in PROSE -- "a bare hop carries no
 * operand at all, so there is no promise to own across the park and nothing to
 * take on the far side" -- which is true today and is owned by the FRONTEND's
 * desugar, not by this file. Give the hop an operand in some future lowering
 * and this backend silently starts exempting a point whose operands really are
 * materialised in `%tN` temporaries across the suspension. No build failure, no
 * test, a wrong answer on a host that verifies no IR.
 *
 * So the precondition is CHECKED where it is RELIED ON, and it fails the BUILD
 * rather than refusing quietly: a CoroRefusedError here would drop the function
 * to the fiber lane and read as a coverage dip, which is the wrong signal
 * entirely. This throws out through llvmCoroPlans, which sits outside
 * emitFunction's trial catch, so nothing downgrades it.
 *
 * WHAT SITS IN FRONT OF IT, learned by trying to make it fire and failing the
 * first time. Giving the hop an operand ONLY in the desugar does not reach here
 * at all: `LIB_FN_SIGS` declares `async.hop` as `{ argTypes: [], result: VOID }`
 * and validateModule rejects the call as SC9001 before any backend runs. So the
 * realistic defect is the TWO-STEP one -- a lowering that adds the operand and
 * updates the signature together, which is what anyone actually making that
 * change would do -- and that is the shape this fence catches. Proved by
 * planting both halves: `HopOperandFenceError: llvm coro: h holds a suspending
 * libCall WITH OPERANDS (async.hop(1))`. Worth writing down because the first,
 * unfaithful plant came back SC9001 and looked like the fence working when it
 * was a different check entirely -- a control that passes for the wrong reason
 * reads exactly like one that passes. */
export function assertBareSuspendingLibCalls(fn: IrFunction): void {
  const sites = operandBearingSuspendingLibCalls(fn);
  if (sites.length > 0) throw new HopOperandFenceError(fn.name, sites);
}

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
 *   3. [DELETED, and the deletion is the cross-park temp slice.] This condition
 *      used to read "no point is nested in a larger expression", keeping out
 *      the shapes whose earlier operands are already materialised in `%tN`
 *      temporaries when the suspension is reached. Those are now SPILLED into
 *      the frame and reloaded into fresh names, which is what the condition
 *      existed to postpone.
 *
 *      IT IS RECORDED AS DELETED RATHER THAN REMOVED SILENTLY because the
 *      analysis flag it read, `nestedInExpression`, still exists and still
 *      means what it meant; what changed is that this backend no longer needs
 *      to care. A reader who finds the flag and wonders why nothing here
 *      consults it should find the answer at the condition's own number.
 *
 *      ITS EXEMPTION DIED WITH IT; THE FENCE UNDER THE EXEMPTION DID NOT.
 *      `POINT_KINDS_WITHOUT_AN_OPERAND` existed to wave the bare hop past this
 *      filter, and with the filter gone there is nothing to wave past. But the
 *      PROPERTY it asserted is still relied on one layer down -- emitCoroHop
 *      lowers `scr_coro_hop(sc_b)` and has nowhere to put an operand, so a hop
 *      that acquired one would have it computed and silently DROPPED. That is a
 *      different defect from the one the spill fixes, and it survives this
 *      deletion. So the fence is re-keyed to the kinds themselves rather than
 *      deleted along with the exemption that first motivated it.
 *
 *   4. [MOVED TO EMISSION, and narrowed by the move.] This condition used to
 *      read "no suspension inside a `finally` BODY", on the strength of the
 *      cross-park ALLOCA (`%pretSlot`) that the SSA rule cannot see. It was
 *      WIDER THAN THE HAZARD. What breaks is a finally body the emitter
 *      copies once per completion path, each copy drawing a state the plan
 *      allotted once; a finally body with a single copy lowers correctly, and
 *      `%pretSlot` has its own general detector in blocks.ts either way.
 *      The verdict is now taken where the copies are COUNTED -- see the
 *      comment at the condition's own position below.
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

/** A cross-park temp is live at a SECOND suspension: carry it in an alloca
 * instead of as an SSA reload.
 *
 * A SIGNAL, NOT A VERDICT, and that is the whole difference from the
 * CoroRefusedError this replaced. It is thrown by emitCoroTempSpill and caught
 * by emitFunction's fixpoint, which promotes the named temp and emits the body
 * again -- the same loop shape CrossParkTempError and CrossParkSlotError
 * already drive. It reaches the refusal handler only when the pass cap is hit,
 * and then it means what every other refusal means: the function keeps its
 * fiber lowering.
 *
 * THE TYPE IS NEVER NULL HERE, unlike the two discovery errors. It comes from
 * a CoroTempSpill the previous pass already recorded, and a temp with no
 * derivable type was refused before it could ever get into that set. */
export class CrossParkTempPromoteError extends Error {
  constructor(
    readonly temp: string,
    readonly llType: string,
  ) {
    super(
      `${temp} is live at a second suspension and must be carried in an alloca ` +
        `rather than as an SSA reload`,
    );
    this.name = "CrossParkTempPromoteError";
  }
}

/** The name a cross-suspension spill gives one of its own values.
 *
 * DERIVED FROM (ROLE, SUSPENSION INDEX, ORIGIN) AND FROM NOTHING ELSE, which
 * is the whole point: the spill is emitted a variable number of times as the
 * discovery passes find more temps, so any name drawn from a COUNTER would
 * shift every later name whenever the set grew.
 *
 * WHY THAT IS NOT A STYLE CHOICE. The fixpoint addresses temps BY NAME across
 * passes, and its termination argument was "everything the mechanism emits is
 * emitted at or after the suspension, so pre-suspension numbering is stable".
 * That argument held exactly as long as there was ONE suspension. With several,
 * a spill inserted at suspension 0 sits BEFORE the code that mints the temps of
 * suspension 1, so growing the set at 0 renumbers everything after it and the
 * set starts naming values it was not built from. Measured, not reasoned: on
 * `main` (100 suspension points) the determinism assertion in emitCoroTempSpill
 * fired on the first build after the multi-state dispatch landed.
 *
 * `role` is "s" for the spill pointer, "r" for the reload pointer and "" for
 * the reloaded value. Collision-safe by construction: `%cx` appears nowhere
 * else in backend/llvm, and the origin is already a unique `%tN`. */
export function crossName(role: "s" | "r" | "", index: number, origin: string): string {
  return `%cx${role}${index}_${origin.slice(1)}`;
}

/** The alloca a PROMOTED cross-park temp lives in, inside each resume call.
 *
 * WHY A TEMP IS EVER PROMOTED. The SSA carry (spill to the frame, reload into
 * a fresh name after the resume label, rename every later use) works for ONE
 * crossing and cannot work for two: the reload is defined in suspension k's
 * resume block, and re-spilling it at suspension k+1 asks that definition to
 * dominate a site the dispatch also enters directly. `zig cc` rejected exactly
 * that with "Instruction does not dominate all uses". Promotion answers it the
 * way IR locals already do -- the value goes to MEMORY every path can see --
 * and then the frame round-trip is the SLOT mechanism that already exists,
 * unchanged: this alloca is handed to `currentCoroSlotSpills` and spilled and
 * reloaded by emitCoroSlotSpill/emitCoroSlotReload like any carried slot.
 *
 * DERIVED FROM THE ORIGIN AND NOTHING ELSE, for the reason crossName gives:
 * a name drawn from a counter would shift whenever the promote set grew, and
 * the fixpoint addresses values across passes BY NAME. */
export function crossSlotName(origin: string): string {
  return `%cxa_${origin.slice(1)}`;
}

/** The name of the `load` that materialises a promoted temp at ONE use site.
 *
 * ONE LOAD PER USE, not one per block, and the choice is about dominance
 * rather than economy. A load hoisted to the first use of a generation does
 * not dominate a use on a sibling arm of a branch, and the back edge of a loop
 * makes emission order disagree with the CFG -- which is the very disagreement
 * that refused these functions in the first place. A load immediately before
 * its own use is dominated by construction, on every path, with no CFG
 * analysis in this backend to get wrong. LLVM's own mem2reg collapses the
 * repeats; a wrong answer would not collapse back.
 *
 * `k` is the use ORDINAL for this origin, which is stable across passes:
 * promoting some OTHER temp rewrites that temp's occurrences and adds its
 * loads, and neither adds nor removes a line mentioning this one. */
export function crossLoadName(origin: string, k: number): string {
  return `%cxl${k}_${origin.slice(1)}`;
}

/** The name of one instruction the SLOT carry emits at ONE suspension.

 * DERIVED FROM (role, SUSPENSION INDEX, SLOT) AND NOTHING ELSE, for the
 * reason crossName gives one rule up -- and this is the second instance of
 * that rule, not a restatement of it. coroFieldInto's header already says
 * what a counter-drawn name costs: "the cross-park spill is emitted a
 * variable number of times -- the set grows as passes discover it -- so if
 * its GEPs drew from `tmp()` they would advance the ordinary temp counter by
 * a different amount on every pass, renumbering every `%tN` minted after the
 * first suspension." The TEMP carry obeyed that; the SLOT carry did not, and
 * drew four `tmp()` names per carried slot per suspension.
 *
 * THAT WAS MEASURED, NOT INFERRED. emitCoroSlotReload's header argued the
 * fixpoint was safe because "everything this pair emits is emitted at or
 * after a suspension". That condition is sufficient for a body with ONE
 * suspension and false for a body with many: instructions added at suspension
 * 3 renumber every temp minted before suspension 21. On `main` -- 102
 * suspensions -- the violating temp sat at generation 21 behind 21 carried
 * suspensions, so each promotion shifted it by exactly 4*21 = 84 and the
 * fixpoint re-discovered the SAME `store double %tN, ptr %tM` in block
 * `exc.k108` under a new name, for ever. Four hundred passes found four
 * hundred names for one value. The cap was reported as "main has more than
 * twelve cross-park temps"; it had one the loop could not address twice. */
export function slotCarryName(
  role: "sv" | "sp" | "rp" | "rv",
  index: number,
  slot: string,
): string {
  return `%cxslot_${role}${index}_${slot.slice(1)}`;
}

/** How many times a body may be re-emitted to discover its cross-park temps
 * before the function is refused.
 *
 * THE BOUND IS NOT THE TERMINATION ARGUMENT. The loop terminates because the
 * set is monotone over a body's pre-park temps (emitFunction says why); this
 * cap is what holds if that argument is ever voided by a change in another
 * file -- a re-numbering of temps, say, or a spill that mints a temp before
 * the park. Twelve is far above the largest set measured on the corpus (4) and
 * far below anything a human would wait for.
 *
 * A function that hits it is refused and keeps its fiber lowering, which is
 * the same outcome as every other refusal: lost coverage, never a wrong
 * answer. */
export const CORO_SPILL_PASS_CAP = 12;

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
  // A PLAN WITH NO POINT IS ADMITTED, and the paragraph that used to stand
  // here refused it on an argument that has since been retired by its own
  // premise. It said such a plan "cannot arrive today -- suspensionLiveness
  // returns null when it finds none, so stacklessPlan bails before building
  // one". stacklessPlan no longer bails: a null from suspensionLiveness means
  // exactly "no suspension point", which is a VERDICT and now yields the
  // empty plan. So the condition this guard described has become the largest
  // row of the frontier (184 functions on zapo-rest/app182), and refusing it
  // here would leave the SHIPPING lane spawning a fiber for every one of them
  // while the C lane converted them -- the two lanes disagreeing about which
  // functions touch fiber machinery at all.
  //
  // WHAT THE DISPATCH BECOMES. `switch` on the state with only the entry arm
  // plus the default abort. That is not a degenerate case to be afraid of:
  // state 0 is the only state such a frame can ever hold, because nothing in
  // the body can write another one. emitter.ts asserts the plan agrees with
  // the IR rather than assuming it, which is the check the old guard was
  // really standing in for.
  // QUANTIFIED OVER EVERY POINT, and that is the whole hazard of opening the
  // count. Both tests below used to read `plan.points[0]` because there was
  // only ever one of them; leaving them that way while admitting a second
  // point would admit a function on the strength of its FIRST point and lower
  // its second one wrong -- a silent widening, which on this host is a silent
  // wrong answer.
  for (const pt of plan.points) {
    if (!LLVM_LOWERABLE_POINT_KINDS.has(pt.kind)) return `kind=${pt.kind}`;
  }
  // THE NESTING PRE-FILTER IS GONE (condition 3). What stood here refused any
  // point whose operands were already materialised when the suspension was
  // reached; they are spilled now.
  //
  // THE FENCE IS RE-KEYED, NOT INHERITED. It used to run only when the filter
  // EXEMPTED a point, because the exemption was what rested on "a bare hop
  // carries no operand". With the filter deleted the exemption no longer
  // exists -- but emitCoroHop still has nowhere to put an operand, so the
  // property is now relied on by the EMITTER rather than by the filter. It is
  // therefore asked of every function carrying a kind this backend lowers as
  // bare, which is where the reliance actually is. Keeping the old `exempted`
  // key would have left the fence attached to a condition that no longer runs:
  // a counter reading zero mechanically, and this file has already paid for
  // one of those.
  if (plan.points.some((pt) => POINT_KINDS_WITHOUT_AN_OPERAND.has(pt.kind))) {
    assertBareSuspendingLibCalls(fn);
  }
  // CONDITION 4 IS GONE IN BOTH OF ITS FORMS, and the second removal is the
  // one this comment is for.
  //
  // IT WAS A BLANKET STRUCTURAL REFUSAL FIRST: no suspension anywhere inside a
  // `finally` body. That was wider than the hazard it named. The hazard is a
  // `return` crossing the region, which snapshots its value into `%pretSlot`
  // -- and `wfy6` (`try { s = 1; } finally { s = s + await pf(n); }`) has no
  // such return, mints no slot, is written ONCE, and lowers correctly. The
  // only wrapper filed under the condition was not an example of it, so no
  // test could report the gap.
  //
  // IT WAS THEN A COUNT AT EMISSION: the three draw sites bounded the state
  // they drew against `plan.points.length` and refused
  // `finally-body-copied-past-its-state` when a body written more than once
  // ran past it. That was honest about WHERE the copies are -- in the emitter,
  // not in the IR -- but it still refused a multiplicity the dispatch can
  // simply carry. `wfy7` (`try { return "w" + n; } finally { fobs = fobs +
  // await pf(n); }`) is the row that was written to exercise it, and it is the
  // row that bought the removal.
  //
  // WHAT REPLACED IT IS A STATE PER EMITTED SITE. A `finally` body copied on
  // three completion paths takes three states, three resume labels and three
  // dispatch cases; the one-state-per-point EQUALITY became the two inclusions
  // at the end of emitFunctionBody, exactly as it did on the C lane. Nothing
  // structural about `finally` is asked here any more, which is why the walk
  // that used to ask it is deleted above rather than kept.
  //
  // THE %pretSlot HAZARD IS NOT LEFT UNGUARDED BY EITHER REMOVAL, and it is no
  // longer an argument on paper. `%pretSlot` is minted through `B.slot()`, so
  // it is a registered resume-call-private slot and blocks.ts's cross-park
  // SLOT rule sees a read after a park that did not re-write it -- carrying it
  // in the frame or refusing the function. `wfy7` is that geometry and its
  // artifact carries the slot through the frame.
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
