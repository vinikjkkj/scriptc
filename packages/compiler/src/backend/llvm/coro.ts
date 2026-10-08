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

/** True when some `awaitExpr` sits inside a `finallyBody`, at any depth.
 *
 * THE ONE SHAPE S1 REFUSES THAT THE REST OF THE PREDICATE WOULD ADMIT, and the
 * reason is an alloca slot rather than a temp. A `return` crossing a finally
 * snapshots its value into `%pretSlot` (emitter.ts's return case) and reads it
 * back after the finally copies have run. That slot is `alloca` memory of the
 * RESUME CALL, and every resume is a fresh call -- so a park BETWEEN the write
 * and the read reads garbage, silently, with the verifier happy because the
 * slot is dominance-legal. The C lane met this and moved the slot into the
 * frame (`sc_pret`); doing the same here is the cross-park ALLOCA mechanism,
 * which is a later slice.
 *
 * A park in a try or catch body is fine and stays admitted: the snapshot
 * happens after the resume on every path, so nothing crosses. Only a park
 * INSIDE the finally body inverts that order. */
export function awaitInsideFinally(fn: IrFunction): boolean {
  let found = false;
  const hasAwait = (v: unknown): boolean => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return v.some(hasAwait);
    const rec = v as Record<string, unknown>;
    if (rec["kind"] === "awaitExpr" || rec["kind"] === "awaitUnionExpr") return true;
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      if (hasAwait(rec[k])) return true;
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
    if (rec["kind"] === "tryCatch" && rec["finallyBody"] != null && hasAwait(rec["finallyBody"])) {
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

/** THE ADMISSION PREDICATE -- which planned functions THIS backend lowers.
 *
 * It is deliberately NARROWER than `coroPlans`, and the gap is the whole shape
 * of this slice. The C emitter lowers every function the plan admits, so there
 * plan membership and lowering are the same set; here they are not, and
 * everything downstream -- the declare set, the link switch, the test ledger --
 * has to key on what was LOWERED rather than on what was planned.
 *
 * THE THREE CONDITIONS, each with the mechanism it keeps out:
 *
 *   1. EXACTLY ONE suspension point. A second point needs a second state, a
 *      second resume block and a second spill site; none of that is hard, but
 *      a multi-point body is also where a local's live range first spans two
 *      parks, and that is worth its own slice with its own value coverage.
 *
 *   2. THE POINT IS AN `awaitExpr`. Not a hop (`libCall:async.hop` draws a
 *      state from the same counter and emits scr_coro_hop, which this slice
 *      declares nothing for and therefore must not reach), and not a
 *      `yieldExpr` (a generator, which emitAsyncScaffolding does not own).
 *
 *   3. IT IS NOT NESTED IN A LARGER EXPRESSION. `nestedInExpression` is the
 *      analysis's own flag for "operands evaluated BEFORE this point are
 *      already materialised in temporaries the frame must also hold". Those
 *      temporaries are `%tN` SSA values on this lane, and an SSA value cannot
 *      be reloaded under its own name -- carrying one across a park is the
 *      cross-park temp mechanism, which is a later slice. blocks.ts's invariant
 *      fails the build if one ever slips through, so this condition is the
 *      thing that keeps the build green rather than the thing that keeps it
 *      correct.
 *
 *   4. NO PARK INSIDE A `finally` BODY -- see awaitInsideFinally: that is the
 *      cross-park ALLOCA mechanism (`%pretSlot`), which no invariant on this
 *      lane can see.
 *
 * WHAT THIS IS NOT: a list of function names. The membership is recomputed from
 * the plan on every build, so a liveness change that admits a new shape shows
 * up here as coverage rather than as a list that quietly went stale. */
export function llvmCoroLowers(fn: IrFunction, plan: StacklessPlan): boolean {
  if (fn.generator !== undefined) return false;
  if (fn.async !== true) return false;
  if (plan.points.length !== 1) return false;
  const pt = plan.points[0]!;
  if (pt.kind !== "awaitExpr") return false;
  if (pt.nestedInExpression) return false;
  if (awaitInsideFinally(fn)) return false;
  return true;
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
  if (plan.points.length !== 1) return `points=${plan.points.length}`;
  const pt = plan.points[0]!;
  if (pt.kind !== "awaitExpr") return `kind=${pt.kind}`;
  if (pt.nestedInExpression) return "nested-in-expression";
  if (awaitInsideFinally(fn)) return "park-inside-finally";
  return null;
}

/** A statement body walk shared by the refusal checks above. Kept here rather
 * than imported from the C emitter so this module depends on the IR only. */
export type { IrStmt };
