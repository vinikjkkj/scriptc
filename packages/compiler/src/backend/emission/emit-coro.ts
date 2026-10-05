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
import { mangleCoroFrame, mangleCoroResume, mangleAsyncSpawn, mangleLocal, mangleRawParam } from "../mangle.js";
import { cDecl, cType, vAdapters } from "./emit-types.js";
import { type IrFunction, type IrType, isRefCounted } from "../../ir/nodes.js";
import { stacklessPlan, type StacklessPlan } from "../../ir/liveness.js";

/** The frame's field name for a local. Deliberately not mangleLocal's name:
 * the frame field and the C local coexist in the resume function, and a
 * spill that read `x = x` would be a no-op nobody would notice. */
export function coroField(localId: string): string {
  return `sc_v_${localId.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** The state machine's label for suspension point `i` (0-based). */
export function coroLabel(i: number): string {
  return `sc_S${i + 1}`;
}

/** Which functions this slice lowers, keyed by IR name. Computed once per
 * module: the emitters below and emit-async.ts's fiber path both consult it,
 * and a function appearing in neither or both would emit a duplicate symbol
 * or none at all. */
export function coroPlans(fns: readonly IrFunction[]): Map<string, StacklessPlan> {
  const out = new Map<string, StacklessPlan>();
  if (process.env["SCRIPTC_STACKLESS"] !== "1") return out;
  for (const fn of fns) {
    const plan = stacklessPlan(fn);
    if (plan !== null) out.set(fn.name, plan);
  }
  return out;
}

/** The locals the frame carries: everything live across a suspension, plus
 * every parameter (the resume function has no parameters of its own, so a
 * param is reached only through the frame). */
export function coroFrameLocals(fn: IrFunction, plan: StacklessPlan): string[] {
  const ids = new Set<string>(plan.frameLocals);
  for (const p of fn.params) ids.add(p.localId);
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
    const byId = new Map(fn.locals.map((l) => [l.id, l]));
    for (const id of coroFrameLocals(fn, plan)) {
      const l = byId.get(id)!;
      // A boxed local is a ScrBox* in the body; the frame carries the same
      // pointer, so the shared binding survives the suspension unchanged.
      const t = l.boxed === true ? "ScrBox *" + coroField(id) : cDecl(l.type, coroField(id));
      fields.push(`${t}; /* ${l.name} */`);
    }
    fields.push("ScrPromise *sc_awaited; /* the operand being awaited */");
    for (const t of E.coroTempSpills.get(fn.name) ?? []) {
      fields.push(`${cDecl(t.type, "sc_tmp_" + t.name)}; /* owned across a park */`);
    }
    // The forward declaration goes in `out` beside the struct, not through
    // E.decl: the spawn wrapper below takes the resume function's ADDRESS,
    // so the declaration has to precede it in the same emitted section.
    out.push(
      ``,
      `typedef struct {`,
      ...fields.map((f) => `  ${f}`),
      `} ${frame};`,
      `static void ${mangleCoroResume(fn.name)}(ScrCoroBase *sc_b);`,
    );
  }
}

/** The spawn wrapper: allocate, copy the arguments in, start the body. */
export function emitCoroSpawns(E: CEmitter, out: string[], plans: Map<string, StacklessPlan>): void {
  for (const fn of E.mod.functions) {
    const plan = plans.get(fn.name);
    if (plan === undefined) continue;
    const frame = mangleCoroFrame(fn.name);
    const boxedIds = new Set(fn.locals.filter((l) => l.boxed === true).map((l) => l.id));
    // A boxed param arrives raw and is boxed by the body, exactly as the
    // fiber path does — so the frame carries the RAW value under the param's
    // raw name and the body's prologue builds the box.
    const pname = (p: { localId: string }): string =>
      boxedIds.has(p.localId) ? mangleRawParam(p.localId) : mangleLocal(p.localId);
    const params = fn.params.map((p) => cDecl(p.type, pname(p)));
    const sig = `ScrPromise *${mangleAsyncSpawn(fn.name)}(${params.join(", ") || "void"})`;
    E.decl(`${sig};`);
    appendLines(out, [
      ``,
      `${E.link}${sig} {`,
      `  ${frame} *sc_f = (${frame} *)scr_coro_alloc(sizeof *sc_f, &${mangleCoroResume(fn.name)}, /*has_exc=*/false);`,
      ...fn.params.map((p) => `  sc_f->${coroField(p.localId)} = ${pname(p)};`),
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
  return coroFrameLocals(fn, plan).map((id) => `sc_f->${coroField(id)} = ${mangleLocal(id)};`);
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
  const take =
    resultType.kind === "void"
      ? null
      : resultType.kind === "f64"
        ? "scr_coro_take_f64"
        : resultType.kind === "bool"
          ? "scr_coro_take_bool"
          : "scr_coro_take_ref";
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
export function coroFinish(E: CEmitter, retType: IrType, valueExpr: string | null): string[] {
  if (valueExpr === null || retType.kind === "void") {
    return [`scr_coro_finish_void(sc_b);`, `return;`];
  }
  switch (retType.kind) {
    case "f64":
      return [`scr_coro_finish_f64(sc_b, ${valueExpr});`, `return;`];
    case "bool":
      return [`scr_coro_finish_f64(sc_b, ${valueExpr} ? 1 : 0);`, `return;`];
    default: {
      const v = vAdapters(retType);
      return [
        `scr_coro_finish_ref(sc_b, (void *)${valueExpr}, ${v.retain}, ${v.release}, ${E.traceArgC(retType)});`,
        `return;`,
      ];
    }
  }
}

/** The unwind path: a pending exception becomes the promise's rejection. */
export function coroUnwind(): string[] {
  return [`scr_coro_finish_throw(sc_b);`, `return;`];
}

export { isRefCounted };
