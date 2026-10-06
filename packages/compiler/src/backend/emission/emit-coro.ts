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
import { mangleCoroField, mangleCoroFrame, mangleCoroResume, mangleAsyncSpawn, mangleLocal, mangleRawParam } from "../mangle.js";
import { boxAccess, cDecl, cType, vAdapters } from "./emit-types.js";
import { type IrFunction, type IrType, isRefCounted } from "../../ir/nodes.js";
// `coroPlans` moved to ir/coro-plans.ts: it is backend-agnostic policy and
// only looked C-specific because it lived here. The TYPE is still needed.
import { type StacklessPlan } from "../../ir/liveness.js";
import { poisonFinishArm, poisonSpillOrder, poisonTakeArm } from "./coro-poison.js";

/** The frame's field name for a local. The naming lives in mangle.ts beside
 * every other mangler, and WHY it has to use mangleLocal's sanitiser rather
 * than a weaker one of its own is recorded there. */
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

/** The frame struct and the resume function's forward declaration. */
export function emitCoroFrames(E: CEmitter, out: string[], plans: Map<string, StacklessPlan>): void {
  for (const fn of E.mod.functions) {
    const plan = plans.get(fn.name);
    if (plan === undefined) continue;
    const frame = mangleCoroFrame(fn.name);
    const fields: string[] = ["ScrCoroBase base;"];
    // A lifted body's closure environment: ONE field, and the capture
    // bindings are re-derived from it before the dispatch rather than
    // spilled, so no capture needs a frame slot of its own.
    if (fn.captures !== undefined) fields.push("ScrClosure *sc_env; /* lifted */");
    const byId = new Map(fn.locals.map((l) => [l.id, l]));
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
    appendLines(out, [
      ``,
      `${E.link}${sig} {`,
      `  ${frame} *sc_f = (${frame} *)scr_coro_alloc(sizeof *sc_f, &${mangleCoroResume(fn.name)}, /*has_exc=*/false);`,
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
      `  return scr_coro_spawn(&sc_f->base);`,
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
export function coroDispatch(plan: StacklessPlan): string[] {
  return [
    `switch (sc_b->state) {`,
    `  case 0: goto sc_S0;`,
    ...plan.points.map((_p, i) => `  case ${i + 1}: goto ${coroLabel(i)};`),
    `  default: abort();`,
    `}`,
    `sc_S0:;`,
  ];
}

/** The reload of the frame's locals into their C names, emitted right after
 * a resume label and at the entry label. */
export function coroReload(fn: IrFunction, plan: StacklessPlan): string[] {
  const byId = new Map(fn.locals.map((l) => [l.id, l]));
  return coroFrameLocals(fn, plan).map((id) => {
    const l = byId.get(id)!;
    const name = l.boxed === true ? mangleLocal(id) : mangleLocal(id);
    return `${name} = sc_f->${coroField(id)};`;
  });
}

/** The spill of the frame's locals, emitted immediately before a park. */
export function coroSpill(fn: IrFunction, plan: StacklessPlan): string[] {
  const ids = coroFrameLocals(fn, plan);
  // The value poison's park-spill arm permutes the TARGETS while the
  // sources stay, so two same-typed locals land in each other's slots:
  // a real value of the right type in the wrong field. Identity unless
  // SCRIPTC_CORO_VALUE_POISON=park-spill. See coro-poison.ts.
  const targets = poisonSpillOrder(fn, ids);
  return ids.map((id, i) => `sc_f->${coroField(targets[i]!)} = ${mangleLocal(id)};`);
}

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
  for (const line of coroSpill(fn, plan)) E.line(line);
  E.line(`sc_f->sc_awaited = ${promiseTemp.name};`);
  E.line(`sc_b->state = ${index + 1};`);
  E.line(`scr_coro_park(sc_b, sc_f->sc_awaited);`);
  E.line(`return; /* to the scheduler — one ready_push charged */`);
  E.line(`${coroLabel(index)}:;`);
  for (const t of owned) E.line(`${t.name} = sc_f->sc_tmp_${t.name};`);
  for (const line of coroReload(fn, plan)) E.line(line);
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
