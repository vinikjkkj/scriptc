/* The D1 slice of the stackless lowering: an async function whose every
 * suspension point is straight-line becomes a state machine over a heap
 * frame instead of a function body on a fiber stack.
 *
 * WHAT THE CALL SITE SEES: nothing. The spawn wrapper keeps its name, its
 * signature and its `ScrPromise *` return, so a stackless function can call
 * a fiber one and vice versa and neither knows which it got. That identity
 * is the whole hybrid, and it is why the choice can be per FUNCTION.
 *
 * THE SHAPE, which is scr_coro.h's documented one:
 *
 *     typedef struct { ScrCoroBase base; <params> <live locals> ScrPromise *awaited; } Frame;
 *
 *     static void resume(ScrCoroBase *b) {
 *       Frame *sc_f = (Frame *)b;
 *       <all locals declared, exactly as the fiber body declares them>
 *       switch (b->state) { case 0: goto S_entry; case 1: goto S_1; ... }
 *     S_entry:
 *       <params loaded from the frame>
 *       <body>
 *     }
 *
 *     ScrPromise *spawn(<params>) {
 *       Frame *f = scr_coro_alloc(sizeof *f, &resume, false);
 *       f-><param> = <param>; ...
 *       return scr_coro_spawn(&f->base);
 *     }
 *
 * WHY SPILL/RELOAD RATHER THAN NAMING LOCALS THROUGH THE FRAME. Rewriting
 * every local reference to `sc_f->x` would mean touching all 29 mangleLocal
 * call sites across the statement and expression emitters, and any one
 * missed is a local that silently stops being shared with the frame. Instead
 * the locals keep their ordinary C names and the frame is written at the
 * park and read back at the label. Only the await site changes, and a local
 * the liveness pass did not put in the frame is simply never spilled —
 * nothing else in the emitter has to know this function is a coroutine.
 *
 * THIS IS SOUND ONLY BECAUSE `IrFunction.locals` IS SCOPE-FLAT. emit-stmts
 * declares every local at the top of the function body, so the dispatch
 * `goto` into the middle of the body never crosses a declaration. With
 * locals declared at their `varDecl` instead, every jump would be a jump
 * past an initialiser into a scope the label cannot see, and the whole
 * transformation would need the body restructured first. */
import { appendLines, type CEmitter, type Temp } from "./emitter.js";
import { mangleGlobal, mangleCoroField, mangleCoroFrame, mangleCoroResume, mangleAsyncSpawn, mangleLocal, mangleRawParam } from "../mangle.js";
import { boxAccess, cDecl, cType, vAdapters } from "./emit-types.js";
import { type IrFunction, type IrType, isRefCounted } from "../../ir/nodes.js";
// `coroPlans` moved to ir/coro-plans.ts: it is backend-agnostic policy and
// only looked C-specific because it lived here. The TYPE is still needed.
import { type StacklessPlan } from "../../ir/liveness.js";
import { singleWriterLocals } from "../../ir/analysis.js";
import { poisonFinishArm, poisonSpillOrder, poisonTakeArm } from "./coro-poison.js";

/** The frame's field name for a local. The naming lives in mangle.ts beside
 * every other mangler, and WHY it has to use mangleLocal's sanitiser rather
 * than a weaker one of its own is recorded there. */
/** An ASYNC GENERATOR's frame parks and hops through its own entries (scr_agen_coro_park / scr_agen_coro_hop): they queue the generator's
 * resume, which reads the handle's four outcomes, so the ordinary resume entry and release carry no generator test. Chosen here, at emission. */
export function coroParkFn(fn: IrFunction): string {
  return fn.generator !== undefined && fn.async === true ? "scr_agen_coro_park" : "scr_coro_park";
}
export function coroHopFn(fn: IrFunction): string {
  return fn.generator !== undefined && fn.async === true ? "scr_agen_coro_hop" : "scr_coro_hop";
}

export function coroField(localId: string): string {
  return mangleCoroField(localId);
}

/** The state machine's label for suspension point `i` (0-based). */
export function coroLabel(i: number): string {
  return `sc_S${i + 1}`;
}


/** The locals the frame carries: everything live across a suspension, plus
 * every parameter (the resume function has no parameters of its own, so a
 * param is reached only through the frame). */
export function coroFrameLocals(fn: IrFunction, plan: StacklessPlan): string[] {
  const ids = new Set<string>(plan.frameLocals);
  for (const p of fn.params) ids.add(p.localId);
  /* EVERY LOCAL THE RELEASE PATH WILL TOUCH, not only the ones a park has to
   * carry forward.
   *
   * `plan.frameLocals` is liveness's LIVE SET, and live means "will be read
   * again". The RC discipline asks a different question -- "does this still
   * own a reference" -- and the two disagree exactly where a local is never
   * read after the suspension but still has to be released at function end.
   * A resume RE-ENTERS the function, so its C locals run their `= NULL`
   * declarations again before the dispatch goto; an unspilled owned local is
   * therefore NULL by the time the release runs, the release is a no-op, and
   * the whole graph it owned leaks.
   *
   * Measured on six lines: `const o = new Holder(...); const s = o.name;
   * await p(1); console.log(s.length)` leaked 1 object, 2 strings and 1
   * array, because `s` is read after the park and `o` is not -- so `s` was
   * spilled and `o` was not. Reading `o.name` AFTER the park instead made it
   * live, put it in the frame, and the leak vanished; that is the control
   * this rule has to explain, and it does.
   *
   * It is the MIRROR of the temp spill one layer down: there a
   * non-refcounted temp never entered the frame, here a refcounted local
   * that liveness called dead never entered it. Both are "the frame must
   * hold what something later touches", and both ask the TYPE rather than
   * keeping a list. */
  for (const l of fn.locals) if (l.boxed === true || isRefCounted(l.type)) ids.add(l.id);
  // Capture boxes come back from `sc_env->caps[i]` on every resume, so they
  // must NOT also get frame slots — two sources for one binding is how a
  // shared box silently stops being shared.
  for (const c of fn.captures ?? []) ids.delete(c.localId);
  // Deterministic order: declaration order, so the struct layout is stable
  // across runs and two builds of the same source produce the same bytes.
  return fn.locals.filter((l) => ids.has(l.id)).map((l) => l.id);
}

/** Does this frame need its own exception cell?
 *
 * TRUE when the body holds a try that OWNS a finally. A point inside such a
 * try can resume with an exception pending, and the cell a lean frame borrows
 * belongs to whoever is on the main stack at that moment, not to this frame.
 *
 * Deliberately a SHAPE question about the whole function rather than a
 * per-point one: a frame is ONE allocation and cannot be fat for some of its
 * states. Over-approximating costs 56 bytes on a frame that already owes most
 * of them, and under-approximating is a wrong cell.
 *
 * WHICH LANE THIS IS INVISIBLE TO: the knob-absent one, entirely. Every
 * caller is inside the coro frame builder, which only runs for a function in
 * coroPlans, and coroPlans returns empty without the knob. */
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

/** The frame struct and the resume function's forward declaration. */
export function emitCoroFrames(E: CEmitter, out: string[], plans: Map<string, StacklessPlan>): void {
  for (const fn of E.mod.functions) {
    const plan = plans.get(fn.name);
    if (plan === undefined) continue;
    const frame = mangleCoroFrame(fn.name);
    // ScrCoroExc embeds ScrCoroBase as its FIRST member, so every existing
    // `(sc_cf_X *)sc_b` cast stays address-identical and every scr_coro_*
    // call keeps working unchanged. The discriminant is STORED
    // (SCR_CORO_HAS_EXC, set by scr_coro_alloc from the flag below), never
    // inferred from a pointer -- scr_coro.h says why in as many words.
    const fat = coroNeedsExcCell(fn);
    const fields: string[] = [fat ? "ScrCoroExc base;" : "ScrCoroBase base;"];
    // A lifted body's closure environment: ONE field, and the capture
    // bindings are re-derived from it before the dispatch rather than
    // spilled, so no capture needs a frame slot of its own.
    if (fn.captures !== undefined) fields.push("ScrClosure *sc_env; /* lifted */");
    const byId = new Map(fn.locals.map((l) => [l.id, l]));
    // THE PENDING-RETURN SLOT, when a park can sit between its write and its
    // read. See CEmitter.coroPretType: through shape (2) the park always
    // preceded the write so a C local sufficed; a suspension INSIDE a finally
    // body falls between them.
    const pret = E.coroPretByFn.get(fn.name);
    if (pret !== undefined) {
      fields.push(`${cDecl(pret, "sc_pret")}; /* pending return, across a park */`);
    }
    // THE FINALLY STASHES, for the same reason: a `yield`/`await` inside a
    // finally body sits between the take and the re-raise. See
    // CEmitter.coroFinExcIds.
    for (const i of E.coroFinExcByFn.get(fn.name) ?? []) {
      fields.push(`ScrCaught *sc_fexc_${i}; /* finally stash, across a park */`);
    }
    for (const id of coroFrameLocals(fn, plan)) {
      const l = byId.get(id)!;
      // A boxed local is a ScrBox* in the body; the frame carries the same
      // pointer, so the shared binding survives the suspension unchanged.
      const t = l.boxed === true ? "ScrBox *" + coroField(id) : cDecl(l.type, coroField(id));
      fields.push(`${t}; /* ${l.name} */`);
    }
    // A GENERATOR frame carries its own handle. The yield and finish arms
    // reach the OUT slot through it, and the slot lives on the handle
    // because the native sink in scr_stream.c reads it from C with no
    // knowledge of frames.
    //
    // ONE FIELD, AND ONLY ON GENERATORS. The alternative is a back-pointer
    // on ScrCoroBase, which is 8 bytes on EVERY frame -- including the 95%
    // that are ordinary awaits and will never be a generator -- to serve the
    // few that are. Same reasoning that keeps the exception cell out of the
    // lean frame: pay the cost where it is owed.
    if (fn.generator !== undefined) {
      fields.push("ScrGen *sc_gen; /* the handle this frame is behind */");
    }
    // sc_awaited is emitted for a generator too, though a SYNCHRONOUS one
    // never parks on a promise. Conditioning it on the plan carrying an
    // awaitExpr point would save 8 bytes and introduce a way for the await
    // path to find the field missing; 8 bytes on a shape that barely exists
    // is not worth a branch that can be wrong. Deliberate, not overlooked.
    fields.push("ScrPromise *sc_awaited; /* the operand being awaited */");
    for (const t of E.coroTempSpills.get(fn.name) ?? []) {
      fields.push(`${cDecl(t.type, "sc_tmp_" + t.name)}; /* owned across a park */`);
    }
    // BOTH of these go where PROTOTYPES go, which is the shared header when
    // the program splits and `out` when it does not -- so a single TU keeps
    // the historical bytes in the historical position.
    //
    // The previous note here said the declaration must sit in `out` because
    // the spawn wrapper takes the resume function's ADDRESS and so needs it
    // to precede the wrapper in the same section. That is true of the
    // FORWARD DECLARATION and false of the frame STRUCT, which has no
    // ordering constraint against the wrapper at all -- and applying it to
    // the struct is why a split program did not compile: all 533 structs
    // landed in the main TU while all 533 resume functions landed in
    // part1..part6, with nothing in the header to bridge them. A single-TU
    // probe cannot see this, because nothing is split.
    const proto = E.protoOut(out);
    proto.push(
      ``,
      `typedef struct {`,
      ...fields.map((f) => `  ${f}`),
      `} ${frame};`,
    );
    // E.link is "static " in one TU and "" when split -- and when it splits,
    // the DEFINITION loses its `static` with every other body (stripStatic),
    // so a `static` declaration here would contradict it.
    proto.push(`${E.link}void ${mangleCoroResume(fn.name)}(ScrCoroBase *sc_b);`);
  }
}

/** The spawn wrapper: allocate, copy the arguments in, start the body. */
export function emitCoroSpawns(E: CEmitter, out: string[], plans: Map<string, StacklessPlan>): void {
  for (const fn of E.mod.functions) {
    const plan = plans.get(fn.name);
    if (plan === undefined) continue;
    // A GENERATOR's spawn is emitted by emitGenCoroSpawn instead, and this
    // skip is load-bearing rather than tidy: generators entered `plans` in
    // the same slice that opened admission, so without it BOTH wrappers are
    // emitted -- one returning ScrPromise * and one returning ScrGen * -- and
    // the promise one calls scr_coro_spawn, which RUNS THE BODY. Calling a
    // generator function must run nothing.
    if (fn.generator !== undefined) continue;
    const frame = mangleCoroFrame(fn.name);
    const boxedIds = new Set(fn.locals.filter((l) => l.boxed === true).map((l) => l.id));
    // A boxed param arrives raw and is boxed by the body, exactly as the
    // fiber path does — so the frame carries the RAW value under the param's
    // raw name and the body's prologue builds the box.
    const pname = (p: { localId: string }): string =>
      boxedIds.has(p.localId) ? mangleRawParam(p.localId) : mangleLocal(p.localId);
    const lifted = fn.captures !== undefined;
    const params = [
      ...(lifted ? ["ScrClosure *sc_env"] : []),
      ...fn.params.map((p) => cDecl(p.type, pname(p))),
    ];
    const sig = `ScrPromise *${mangleAsyncSpawn(fn.name)}(${params.join(", ") || "void"})`;
    E.decl(`${sig};`);
    // A MODULE INITIALISER's evaluation promise is cached (asyncCacheGlobal) and, for an async import cycle, so is the
    // cycle root's (asyncCycleCacheGlobal): the wrapper is entered once per importer and every later entry gets the
    // first one's promise. The same wrapper logic as the fiber spawn (emit-async.ts); scr_coro_spawn runs the body
    // eagerly just as scr_async_spawn did, so an admitted cycle can re-enter this wrapper after its guard sets but
    // before this outer spawn returns, and the inner entry's temporary cache fill is replaced by the real promise.
    const cache = fn.asyncCacheGlobal !== undefined ? mangleGlobal(fn.asyncCacheGlobal) : null;
    const cycleCache = fn.asyncCycleCacheGlobal !== undefined ? mangleGlobal(fn.asyncCycleCacheGlobal) : null;
    appendLines(out, [
      ``,
      `${E.link}${sig} {`,
      ...(cache !== null ? [`  if (${cache}) return scr_promise_retain(${cache});`] : []),
      `  ${frame} *sc_f = (${frame} *)scr_coro_alloc(sizeof *sc_f, &${mangleCoroResume(fn.name)}, /*has_exc=*/${coroNeedsExcCell(fn) ? "true" : "false"});`,
      ...(lifted ? [`  sc_f->sc_env = scr_closure_retain(sc_env);`] : []),
      ...fn.params.flatMap((p) => {
        const f = coroField(p.localId);
        if (!boxedIds.has(p.localId)) return [`  sc_f->${f} = ${pname(p)};`];
        // THE BOX IS BUILT HERE, and that is the whole fix for a boxed param.
        //
        // It used to be built by the body prologue, which cannot work in a
        // resume function for two independent reasons, both hard: the body
        // declares every local at the TOP (params included, for a coroutine),
        // so the prologue's `ScrBox *x = ...` was a REDECLARATION; and this
        // frame slot is typed `ScrBox *` by emitCoroFrames, so storing the raw
        // value here put a double or a bool into a pointer slot for the f64
        // and bool params. One slot, two different things at two times.
        //
        // Building it in the spawn wrapper fixes both and costs NOTHING: the
        // slot was already `ScrBox *`, so no field is added. It also makes
        // "constructed exactly once" STRUCTURAL rather than a thing to get
        // right -- the spawn wrapper runs once, on the caller's stack, before
        // any suspension exists; the dispatch's param reload then restores the
        // box pointer on every resume like any other frame local.
        return [
          `  sc_f->${f} = ${E.boxNewC(p.type)}; /* ${p.name} (boxed param) */`,
          `  scr_box_set_${boxAccess(p.type)}(sc_f->${f}, ${pname(p)}); /* moves the +1 in */`,
        ];
      }),
      // INV-2: the body runs synchronously up to its first suspension, so a
      // function that never awaits has already settled by the time this
      // returns — same observable timing as scr_async_spawn's fiber switch.
      ...(cache === null && cycleCache === null
        ? [`  return scr_coro_spawn(&sc_f->base);`]
        : [
            `  ScrPromise *sc_p = scr_coro_spawn(&sc_f->base);`,
            // Loader-owned from the moment evaluation starts: even a pending rejection must not become an unrelated
            // unhandled rejection when a later sibling initializer throws before the dependency wait is built.
            ...(cache !== null ? [`  scr_promise_mark_handled(sc_p);`] : []),
            ...(cache !== null
              ? [
                  `  ScrPromise *sc_cache_owned = scr_promise_retain(sc_p);`,
                  `  scr_promise_release(${cache});`,
                  `  ${cache} = sc_cache_owned;`,
                ]
              : []),
            ...(cycleCache !== null
              ? [
                  `  ScrPromise *sc_cycle_cache_owned = scr_promise_retain(sc_p);`,
                  `  scr_promise_release(${cycleCache});`,
                  `  ${cycleCache} = sc_cycle_cache_owned;`,
                ]
              : []),
            `  return sc_p;`,
          ]),
      `}`,
    ]);
  }
}

/** The dispatch that opens a resume function's body, emitted by emitFunction
 * in place of the ordinary signature line. */
export function coroPrologue(E: CEmitter, fn: IrFunction, plan: StacklessPlan): string[] {
  const frame = mangleCoroFrame(fn.name);
  const cases = plan.points.map((_p, i) => `    case ${i + 1}: goto ${coroLabel(i)};`);
  return [
    `static void ${mangleCoroResume(fn.name)}(ScrCoroBase *sc_b) {`,
    `  ${frame} *sc_f = (${frame} *)sc_b;`,
    // Before the dispatch on purpose: the capture prologue below reads it,
    // and every resume has to see the same environment.
    ...(fn.captures !== undefined ? [`  ScrClosure *sc_env = sc_f->sc_env;`] : []),
  ].concat(
    // The switch is emitted AFTER the local declarations (the caller splices
    // it in), because C requires the declarations to dominate the labels.
    [],
    cases.length === 0 ? [] : [],
  );
}

/** The dispatch switch, emitted after the local declarations. */
export function coroDispatch(stateCount: number): string[] {
  return [
    `switch (sc_b->state) {`,
    `  case 0: goto sc_S0;`,
    ...Array.from({ length: stateCount }, (_v, i) => `  case ${i + 1}: goto ${coroLabel(i)};`),
    `  default: abort();`,
    `}`,
    `sc_S0:;`,
  ];
}

/** The reload of the frame's locals into their C names, emitted right after
 * a resume label and at the entry label. */
export function coroReload(E: CEmitter, fn: IrFunction, plan: StacklessPlan): string[] {
  const byId = new Map(fn.locals.map((l) => [l.id, l]));
  const out = coroFrameLocals(fn, plan).map((id) => {
    const l = byId.get(id)!;
    const name = l.boxed === true ? mangleLocal(id) : mangleLocal(id);
    return `${name} = sc_f->${coroField(id)};`;
  });
  if (E.coroPretType !== null) out.push(`sc_pret = sc_f->sc_pret;`);
  for (const i of E.coroFinExcIds) out.push(`sc_fexc_${i} = sc_f->sc_fexc_${i};`);
  return out;
}

/** The spill of the frame's locals, emitted immediately before a park. */
export function coroSpill(E: CEmitter, fn: IrFunction, plan: StacklessPlan): string[] {
  const ids = coroFrameLocals(fn, plan);
  // The value poison's park-spill arm permutes the TARGETS while the
  // sources stay, so two same-typed locals land in each other's slots:
  // a real value of the right type in the wrong field. Identity unless
  // SCRIPTC_CORO_VALUE_POISON=park-spill. See coro-poison.ts.
  const targets = poisonSpillOrder(fn, ids);
  const out = ids.map((id, i) => `sc_f->${coroField(targets[i]!)} = ${mangleLocal(id)};`);
  // THE PENDING-RETURN SLOT IS NOT PART OF THE PERMUTATION, and that is not
  // an oversight. The poison permutes frame slots among the FRAME LOCALS to
  // plant a right-typed value in a wrong field; `sc_pret` is not one of them
  // -- it is a single slot with no sibling to be confused with, so permuting
  // it could only mean dropping it. It is appended after the permuted set so
  // the poison arm keeps testing exactly what it was written to test, and the
  // pending return keeps surviving the park either way.
  if (E.coroPretType !== null) out.push(`sc_f->sc_pret = sc_pret;`);
  // The stashes are appended after the permuted set for the same reason
  // `sc_pret` is: each is a single slot with no sibling to be confused
  // with, so permuting one could only mean dropping it.
  for (const i of E.coroFinExcIds) out.push(`sc_f->sc_fexc_${i} = sc_fexc_${i};`);
  return out;
}

/** RELEASE, BEFORE THE PARK, EVERY OWNED LOCAL THE RESUME NEVER READS AGAIN.
 *
 * The frame carries every refcounted local to function end (coroFrameLocals: the release path must find its owner
 * after a resume re-enters the function), so a local whose last use was an argument of the awaited call kept its
 * whole graph alive for the whole wait -- zapo's getSessionsBatch held 1000 padded parameter arrays for as long as
 * 1000 queued queries were pending. A local the plan says is dead across THIS point (SuspensionPoint.keepAtPark: not
 * live, not read by the enclosing expression outside this await's own operand, not handed to a runtime call there)
 * is released here and set NULL, so the spill below writes NULL into its frame slot and every later release (scope
 * exit, function end, an unwind) is the NULL-tolerant no-op it already is.
 *
 * ONLY ENTRIES OF THE OPEN SCOPES ARE TOUCHED: a local whose varDecl has not been emitted yet (or whose scope has
 * exited) is not in `E.scopes` and may hold a stale pointer from a previous loop iteration, which must not be released
 * twice. Boxed (closure-captured) locals, captures and the lowering's hidden `%` locals are never released here. */
function coroReleaseDead(E: CEmitter, fn: IrFunction, plan: StacklessPlan, node: object): void {
  const pt = plan.points.find((p) => p.node === node);
  if (pt === undefined || pt.keepAtPark === undefined) return;
  const byName = new Map(fn.locals.map((l) => [mangleLocal(l.id), l]));
  const captured = new Set((fn.captures ?? []).map((c) => c.localId));
  const done = new Set<string>();
  // A root-of-statement await in the scope that owns the local, and the local written only by its declaration: every path
  // from the declaration to this scope's exit passes this park (a jump out of the scope before it was emitted before it,
  // with the entry still in place), so the exit release is a certain no-op and the entry is dropped -- the release moves
  // to the park instead of being paid twice.
  const innermost = E.scopes.length - 1;
  const single = pt.nestedInExpression ? null : singleWriterLocals(fn);
  for (let si = 0; si < E.scopes.length; si++) {
    const scope = E.scopes[si]!;
    const drop: ScopeEntryLike[] = [];
    for (const ent of scope) {
      if (ent.boxed === true || ent.immortal === true || !isRefCounted(ent.type)) continue;
      const l = byName.get(ent.name);
      if (l === undefined || l.boxed === true || l.name.startsWith("%")) continue;
      if (captured.has(l.id) || pt.keepAtPark.has(l.id) || done.has(ent.name)) continue;
      done.add(ent.name);
      E.releaseValue(ent.name, ent.type);
      E.line(`${ent.name} = NULL;`);
      if (single !== null && si === innermost && single.has(l.id)) drop.push(ent);
    }
    for (const ent of drop) scope.splice(scope.indexOf(ent as never), 1);
  }
}
type ScopeEntryLike = object;

/** The await site: spill, park, return to the scheduler, and on re-entry
 * reload and take the settled value.
 *
 * EXACTLY ONE scr_coro_park PER AWAIT, and scr_coro_park charges exactly one
 * scr_ready_push on exactly one of its two arms. The invariant is therefore
 * countable by grepping the emitted TU: the number of scr_coro_park calls
 * must equal the number of awaitExpr nodes in the function's IR. */
export function emitCoroAwait(
  E: CEmitter,
  fn: IrFunction,
  plan: StacklessPlan,
  index: number,
  promiseTemp: Temp,
  resultType: IrType,
  dynAdopt = false,
  node?: object,
): string {
  // THE OPERAND PROMISE MOVES INTO THE FRAME, and that is not a nicety.
  // `promiseTemp` is a C local in the resume function. The park RETURNS to
  // the scheduler, so by the time the label is reached that local is dead
  // and its value indeterminate — the emitter's ordinary scope release would
  // then release a garbage pointer. Striking it from the RC frame and
  // handing its +1 to `sc_awaited` makes the frame the single owner across
  // the suspension, released once at the take below. (Found by segfault: the
  // first version left the temp in the frame and it was released twice, once
  // through a dangling local.)
  E.moveTemp(promiseTemp);
  if (node !== undefined) coroReleaseDead(E, fn, plan, node);
  // Every OTHER temp the RC frames still own has the same dangling-local
  // problem, so it goes in the frame too. Recorded for the struct, which is
  // emitted after the bodies.
  const owned: Temp[] = [];
  for (const fr of E.frames) for (const t of fr) owned.push(t);
  if (owned.length > 0) {
    const seen = E.coroTempSpills.get(fn.name) ?? [];
    for (const t of owned) if (!seen.some((x) => x.name === t.name)) seen.push(t);
    E.coroTempSpills.set(fn.name, seen);
  }
  for (const t of owned) E.line(`sc_f->sc_tmp_${t.name} = ${t.name};`);
  for (const line of coroSpill(E, fn, plan)) E.line(line);
  E.line(`sc_f->sc_awaited = ${promiseTemp.name};`);
  E.line(`sc_b->state = ${index + 1};`);
  E.line(`${coroParkFn(fn)}(sc_b, sc_f->sc_awaited);`);
  E.line(`return; /* to the scheduler — one ready_push charged */`);
  E.line(`${coroLabel(index)}:;`);
  for (const t of owned) E.line(`${t.name} = sc_f->sc_tmp_${t.name};`);
  for (const line of coroReload(E, fn, plan)) E.line(line);
  // A dyn await over Promise.resolve(v) (dyn.adoptPromise) reads its payload dyn-aware: the adopted promise may carry a number, a string or a
  // reference, not only a dyn reference (scr_await_dyn does the same on the fiber lane).
  if (dynAdopt && resultType.kind === "dyn") {
    const td = E.newTemp(resultType, `scr_coro_take_dyn(sc_b, sc_f->sc_awaited)`);
    E.line(`scr_promise_release(sc_f->sc_awaited); sc_f->sc_awaited = NULL;`);
    return td.name;
  }
  const take0 =
    resultType.kind === "void"
      ? null
      : resultType.kind === "f64"
        ? "scr_coro_take_f64"
        : resultType.kind === "bool"
          ? "scr_coro_take_bool"
          : "scr_coro_take_ref";
  // Identity unless SCRIPTC_CORO_VALUE_POISON=take-arm.
  const take = take0 === null ? null : poisonTakeArm(resultType, take0);
  if (take === null) {
    E.line(`scr_coro_take_void(sc_b, sc_f->sc_awaited);`);
    E.line(`scr_promise_release(sc_f->sc_awaited); sc_f->sc_awaited = NULL;`);
    return "";
  }
  const cast = take === "scr_coro_take_ref" ? `(${cType(resultType).trim()})` : "";
  const t = E.newTemp(resultType, `${cast}${take}(sc_b, sc_f->sc_awaited)`);
  E.line(`scr_promise_release(sc_f->sc_awaited); sc_f->sc_awaited = NULL;`);
  return t.name;
}

/** The owned RC temps at a suspension, registered for the frame struct.
 * Factored out because THREE suspension shapes now need the same set and a
 * fourth would too: a park, a bare hop, and the two-armed union suspension
 * below, whose two arms must spill the SAME temps or the resume reloads
 * whichever arm ran last. */
function coroOwnedTemps(E: CEmitter, fn: IrFunction): Temp[] {
  const owned: Temp[] = [];
  for (const fr of E.frames) for (const t of fr) owned.push(t);
  if (owned.length > 0) {
    const seen = E.coroTempSpills.get(fn.name) ?? [];
    for (const t of owned) if (!seen.some((x) => x.name === t.name)) seen.push(t);
    E.coroTempSpills.set(fn.name, seen);
  }
  return owned;
}

/** A two-armed suspension: ONE point, ONE state, ONE resume label, and two
 * different ways of getting there.
 *
 * `await u` on a promise-or-absent union suspends on BOTH arms -- the promise
 * arm parks on the operand, the unit arm takes a bare microtask hop -- and
 * which one runs is not known until runtime. Giving them two states would be
 * wrong twice over: the dispatch would need a case for a label that cannot be
 * reached from the other arm, and `coroPointIndex` counts POINTS, of which
 * this is one.
 *
 * THE COUNTABLE INVARIANT CHANGES SHAPE HERE, and it is the first time it
 * has. It was "one scr_coro_park per point", countable by grepping the TU.
 * It is now "one STATE per point, one resume LABEL per state" -- two
 * suspension calls can share a label. Anything counting park calls alone
 * reads this slice as emitting too many; the counter asserts distinct labels
 * instead.
 *
 * THE RESUME TELLS THE ARMS APART BY `sc_awaited`, which already exists in
 * every frame: the park arm stores the operand there and the hop arm stores
 * NULL. The caller branches on it to decide what to take. The promise is
 * BORROWED from the union (scr_union_peek does not retain, and the union temp
 * is itself in the frame), so the caller must not release it -- which is why
 * the take is the caller's and not this function's. */
export function emitCoroUnionSuspend(
  E: CEmitter,
  fn: IrFunction,
  plan: StacklessPlan,
  index: number,
  unionName: string,
  promiseTag: number,
  peek: string,
): void {
  const owned = coroOwnedTemps(E, fn);
  const spill = (): void => {
    for (const t of owned) E.line(`sc_f->sc_tmp_${t.name} = ${t.name};`);
    for (const line of coroSpill(E, fn, plan)) E.line(line);
  };
  E.line(`if (${unionName}->tag == ${promiseTag}) {`);
  E.indent++;
  spill();
  E.line(`sc_f->sc_awaited = ${peek}; /* BORROWED from the union, never released here */`);
  E.line(`sc_b->state = ${index + 1};`);
  E.line(`${coroParkFn(fn)}(sc_b, sc_f->sc_awaited);`);
  E.line(`return; /* to the scheduler -- one ready_push charged */`);
  E.indent--;
  E.line(`} else {`);
  E.indent++;
  spill();
  E.line(`sc_f->sc_awaited = NULL; /* the discriminator the resume reads */`);
  E.line(`sc_b->state = ${index + 1};`);
  E.line(`${coroHopFn(fn)}(sc_b);`);
  E.line(`return; /* to the scheduler -- one ready_push charged */`);
  E.indent--;
  E.line(`}`);
  E.line(`${coroLabel(index)}:;`);
  for (const t of owned) E.line(`${t.name} = sc_f->sc_tmp_${t.name};`);
  for (const line of coroReload(E, fn, plan)) E.line(line);
}

/** The bare microtask hop at a lowerable suspending libCall.
 *
 * emitCoroAwait without the operand: no promise to move into the frame, no
 * `sc_awaited`, and nothing to take on the far side. Everything else is the
 * same park shape and MUST stay the same -- the owned-temp spill, the frame
 * spill, the state write, the return to the scheduler, the label, and both
 * reloads. A hop is a park: the C locals of the resume function are just as
 * dead across it as they are across an await, and the first version of
 * emitCoroAwait learned that by segfault.
 *
 * ONE scr_coro_hop per libCall point, so `parks + hops` is what must equal
 * the dispatch's case count -- the countable invariant now has two spellings
 * and `stackless-values` asserts their SUM rather than one of them. */
export function emitCoroHop(E: CEmitter, fn: IrFunction, plan: StacklessPlan, index: number): void {
  const owned: Temp[] = [];
  for (const fr of E.frames) for (const t of fr) owned.push(t);
  if (owned.length > 0) {
    const seen = E.coroTempSpills.get(fn.name) ?? [];
    for (const t of owned) if (!seen.some((x) => x.name === t.name)) seen.push(t);
    E.coroTempSpills.set(fn.name, seen);
  }
  for (const t of owned) E.line(`sc_f->sc_tmp_${t.name} = ${t.name};`);
  for (const line of coroSpill(E, fn, plan)) E.line(line);
  E.line(`sc_b->state = ${index + 1};`);
  E.line(`${coroHopFn(fn)}(sc_b);`);
  E.line(`return; /* to the scheduler -- one ready_push charged */`);
  E.line(`${coroLabel(index)}:;`);
  for (const t of owned) E.line(`${t.name} = sc_f->sc_tmp_${t.name};`);
  for (const line of coroReload(E, fn, plan)) E.line(line);
}

/** The completion path: what `return` and the top-level unwind emit instead
 * of a C return. */
export function coroFinish(
  E: CEmitter,
  retType: IrType,
  valueExpr: string | null,
  lifted = false,
): string[] {
  // The frame holds +1 on the closure (the fiber trampoline releases it
  // after the body for the same reason); every completion path drops it.
  const env = lifted ? [`scr_closure_release(sc_f->sc_env);`] : [];
  if (valueExpr === null || retType.kind === "void") {
    return [...env, `scr_coro_finish_void(sc_b);`, `return;`];
  }
  switch (retType.kind) {
    case "f64":
      return [...env, `scr_coro_finish_f64(sc_b, ${valueExpr});`, `return;`];
    case "bool":
      // NOT finish_f64. ScrPromise keeps `f64` and `b` as separate members
      // with distinct payload kinds, and every awaiter -- stackless and fiber
      // -- reads `b`. Fulfilling through f64 left `b` zero, so an `await` of
      // a bool-returning coroutine answered false whatever it returned: a
      // wrong ANSWER, not a crash, which is why a green corpus never saw it.
      // Identity unless SCRIPTC_CORO_VALUE_POISON=finish-arm, which
      // reinstates exactly the defect the comment above describes: the
      // bool converts to double, the call compiles, `b` stays zero.
      return [...env, `${poisonFinishArm(retType, "scr_coro_finish_bool")}(sc_b, ${valueExpr});`, `return;`];
    default: {
      const v = vAdapters(retType);
      return [
        ...env,
        `scr_coro_finish_ref(sc_b, (void *)${valueExpr}, ${v.retain}, ${v.release}, ${E.traceArgC(retType)});`,
        `return;`,
      ];
    }
  }
}

/** The unwind path: a pending exception becomes the promise's rejection. */
export function coroUnwind(lifted = false): string[] {
  return [
    ...(lifted ? [`scr_closure_release(sc_f->sc_env);`] : []),
    `scr_coro_finish_throw(sc_b);`,
    `return;`,
  ];
}

export { isRefCounted };
