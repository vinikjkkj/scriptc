/* The YIELD half of the stackless lowering: a suspension that returns to the
 * CONSUMER instead of to the scheduler.
 *
 * WHY A SEPARATE FILE AND NOT A SIBLING INSIDE emit-coro.ts. Two reasons,
 * and the weaker one is the branch layout. The stronger: emit-coro.ts emits
 * the machinery an AWAIT needs -- a promise field, a park, a ready push --
 * and a synchronous yield has none of those. Putting the two in one file
 * invites the next reader to reach for `sc_awaited` or `scr_coro_park`
 * because they are in scope, and neither exists on this path. Everything
 * genuinely shared -- the frame layout, the spill and reload sets, the
 * label naming, the state index -- is imported from there rather than
 * restated, so there is exactly one definition of each.
 *
 * HOW A YIELD DIFFERS FROM AN AWAIT, which is the whole content of this
 * file:
 *
 *   await                              yield
 *   ---------------------------------  ---------------------------------
 *   operand is a promise               operand is the yielded VALUE
 *   promise moves into sc_awaited      value moves into the handle's OUT
 *   scr_coro_park(sc_b, p)             nothing: the runtime marks YIELDED
 *   one scr_ready_push charged         ZERO pushes, ZERO microtask turns
 *   returns to the SCHEDULER           returns to the CONSUMER
 *   resumes with the settled value     resumes with the .next(v) argument
 *
 * THE TURN COUNT IS THE PART TO GET RIGHT. A synchronous yield consumes no
 * microtask turn in JS -- the consumer's .next() runs the body on its own
 * stack and gets a value back -- so charging a push here would put a turn
 * where the oracle has none, and the tick comparison would go red against
 * node for a reason that has nothing to do with the state machine. The
 * ASYNC yield does take a hop (scr_agen_yield_settle calls scr_await_hop),
 * which is exactly why async generators are blocked behind the hop and
 * these are not.
 *
 * THE SPILL IS IDENTICAL AND MUST STAY THAT WAY. Every C local live across
 * the suspension is dead after the return, for the same reason the await
 * path records: the resume function returns and its frame goes away. Both
 * paths therefore spill through coroSpill/coroReload and the same temp
 * table. This file does not have its own copy of that rule; it calls the
 * same functions, so a change to the spill set cannot apply to one
 * suspension kind and not the other.
 *
 * THE FRAME CARRIES ITS HANDLE. Emitted generator frames gain an `sc_gen`
 * field, which the yield and finish arms read. The alternative -- a
 * back-pointer on ScrCoroBase -- would put 8 bytes on EVERY frame,
 * including the 95% that are ordinary awaits, to serve the few that are
 * generators. That field is emitted by emitCoroFrames in emit-coro.ts,
 * which is one of the files this slice already had to touch.
 *
 * NOT EXECUTED. Written while a gate was in flight; nothing here has been
 * compiled or run, and the runtime entry points it names are declarations
 * without definitions. */
import type { IrFunction, IrType } from "../../ir/nodes.js";
import type { StacklessPlan } from "../../ir/liveness.js";
import type { CEmitter, Temp } from "./emitter.js";
import { boxAccess, cDecl, cType, releaseCallC, vAdapters } from "./emit-types.js";
import {
  mangleCoroFrame,
  mangleCoroResume,
  mangleGenDrop,
  mangleGenSpawn,
  mangleLocal,
  mangleRawParam,
} from "../mangle.js";
import { coroField, coroLabel, coroReload, coroSpill, isRefCounted } from "./emit-coro.js";
import { poisonYieldArm } from "./gen-poison.js";

/** The runtime entry point for each arm of the yield channel. Spelled in
 * full rather than built from a prefix, for the reason the fiber twin
 * records: a runtime symbol this backend can emit has to be findable by
 * reading the source. */
const YIELD_ARMS = {
  f64: "scr_gen_coro_yield_f64",
  bool: "scr_gen_coro_yield_bool",
  ref: "scr_gen_coro_yield_ref",
} as const;

/** Emit one `yield` inside a converted synchronous generator.
 *
 * Returns the C expression naming the resumed value -- the argument the
 * consumer passed to `.next(v)` -- or "" for an undefined next channel.
 *
 * `index` is the suspension's state number and MUST come from the same
 * counter the await path uses, because both kinds share one dispatch: the
 * caller increments E.coroPointIndex and bounds-checks it against
 * plan.points.length before calling here. Two counters kept in step by
 * convention is the shape this front has already been bitten by. */
export function emitCoroYield(
  E: CEmitter,
  fn: IrFunction,
  plan: StacklessPlan,
  index: number,
  valueTemp: Temp,
  valueType: IrType,
  resultType: IrType,
): string {
  /* THE YIELDED VALUE LEAVES THE RC FRAME. It is a C local in the resume
   * function; the return kills it, so the emitter's ordinary scope release
   * would later release a dangling pointer. The OUT slot takes the +1 and
   * becomes the single owner, exactly as the fiber lane's scr_gen_yield_ref
   * does and exactly as the await path does with its promise. */
  if (isRefCounted(valueType)) E.moveTemp(valueTemp);

  /* Every other temp still owned by an RC frame has the same problem, so it
   * is spilled too. Same table as the await path, deliberately. */
  const owned: Temp[] = [];
  for (const fr of E.frames) for (const t of fr) owned.push(t);
  if (owned.length > 0) {
    const seen = E.coroTempSpills.get(fn.name) ?? [];
    for (const t of owned) if (!seen.some((x) => x.name === t.name)) seen.push(t);
    E.coroTempSpills.set(fn.name, seen);
  }
  for (const t of owned) E.line(`sc_f->sc_tmp_${t.name} = ${t.name};`);
  for (const line of coroSpill(fn, plan)) E.line(line);

  /* The value into OUT. The scalar arm goes through the value guard so a
   * wrong-arm defect can be injected; unpoisoned this is the identity. The
   * ref arm is not routed through it -- its call takes a release adapter,
   * so a swap would fail at the C compiler rather than at the value. */
  if (valueType.kind === "f64" || valueType.kind === "bool") {
    const arm = poisonYieldArm(valueType.kind, YIELD_ARMS);
    E.line(`${arm}(sc_f->sc_gen, ${valueTemp.name});`);
  } else {
    E.line(`${YIELD_ARMS.ref}(sc_f->sc_gen, ${valueTemp.name}, ${vAdapters(valueType).release});`);
  }

  /* No park, no push. The runtime entry above marks the frame YIELDED --
   * the runtime and not the generated code, so the flag cannot be forgotten
   * at one of three arms -- and this returns to whoever resumed us, which
   * on this path is the consumer. */
  E.line(`sc_b->state = ${index + 1};`);
  E.line(`return; /* to the CONSUMER -- no ready push, no microtask turn */`);
  E.line(`${coroLabel(index)}:;`);
  for (const t of owned) E.line(`${t.name} = sc_f->sc_tmp_${t.name};`);
  for (const line of coroReload(fn, plan)) E.line(line);

  /* The resumed value is the consumer's .next(v) argument, taken out of the
   * IN slot. These are the SAME runtime entry points the fiber lane uses:
   * the slot lives on the handle, not in the frame, so neither the lowering
   * nor the native sink has to care which kind of generator produced it. */
  switch (resultType.kind) {
    case "void":
      return "";
    case "f64":
      return E.newTemp(resultType, `scr_gen_take_in_f64()`).name;
    case "bool":
      return E.newTemp(resultType, `scr_gen_take_in_bool()`).name;
    default:
      return E.newTemp(resultType, `(${cType(resultType).trim()})scr_gen_take_in_ref()`).name;
  }
}

/** The completion path for a synchronous generator: what `return` emits
 * instead of a C return.
 *
 * Deliberately not coroFinish. That one settles the frame's promise, and a
 * synchronous generator has none -- decision 3 keeps the base shared and
 * the lifecycle separate, and this is the finish half of that. The return
 * value goes to OUT, which is where a consumer resume reads a done-value
 * from. */
export function genCoroFinish(retType: IrType, valueName: string): string[] {
  switch (retType.kind) {
    case "void":
      return [`scr_gen_coro_finish_void(sc_f->sc_gen);`, `return;`];
    case "f64":
      return [`scr_gen_coro_finish_f64(sc_f->sc_gen, ${valueName});`, `return;`];
    case "bool":
      return [`scr_gen_coro_finish_bool(sc_f->sc_gen, ${valueName});`, `return;`];
    default:
      return [
        `scr_gen_coro_finish_ref(sc_f->sc_gen, ${valueName}, ${vAdapters(retType).release});`,
        `return;`,
      ];
  }
}

/** The spawn wrapper for a CONVERTED synchronous generator.
 *
 * Replaces all three pieces the fibre path emits -- the argument pack, the
 * trampoline and the never-started teardown -- with one function, because a
 * frame IS the argument pack: the parameters go straight into frame fields
 * that the state machine reloads on every resume, so there is nothing to
 * malloc and nothing to drop separately. The handle owns the frame.
 *
 * IT DOES NOT RUN THE BODY, and that is the one place this must NOT mirror
 * the async spawn. scr_coro_spawn exists to satisfy INV-2: an async
 * function runs synchronously up to its first suspension, so a function
 * that never awaits has already settled when the spawn returns. A generator
 * is the opposite and JS is explicit about it -- calling a generator
 * function runs NOTHING; the body starts at the first .next(). Calling
 * scr_coro_spawn here would execute the body one resume early and the
 * divergence would be invisible in any test whose generator has no side
 * effect before its first yield.
 *
 * The frame's own handle pointer is stored after the wrap, because the
 * yield and finish arms reach the OUT slot through it (see the header note
 * on why they take the handle rather than the frame). */
export function emitGenCoroSpawn(
  E: CEmitter,
  out: string[],
  fn: IrFunction,
  plan: StacklessPlan,
): void {
  const frame = mangleCoroFrame(fn.name);
  const boxedIds = new Set(fn.locals.filter((l) => l.boxed === true).map((l) => l.id));
  const pname = (q: { localId: string }): string =>
    boxedIds.has(q.localId) ? mangleRawParam(q.localId) : mangleLocal(q.localId);
  const lifted = fn.captures !== undefined;
  const params = [
    ...(lifted ? ["ScrClosure *sc_env"] : []),
    ...fn.params.map((q) => cDecl(q.type, pname(q))),
  ];
  /* THE ARGUMENT DROP, for a generator that is released or returned before
   * its body ever runs. It releases what the frame holds and does NOT free
   * the frame: scr_gen_release and scr_gen_resume_return own that, and
   * splitting it the other way would give two owners of one allocation.
   *
   * A boxed param's slot holds the ScrBox the spawn built, so the box is
   * what gets released -- the raw value never reached the frame. */
  const dropLines: string[] = [
    ``,
    `${E.link}void ${mangleGenDrop(fn.name)}(void *sc_fp) {`,
    `  ${frame} *sc_f = (${frame} *)sc_fp;`,
    ...(lifted ? [`  scr_closure_release(sc_f->sc_env);`] : []),
    ...fn.params.flatMap((q) => {
      const f = coroField(q.localId);
      if (boxedIds.has(q.localId)) return [`  scr_box_release(sc_f->${f});`];
      return isRefCounted(q.type) ? [`  ${releaseCallC(q.type, `sc_f->${f}`)};`] : [];
    }),
    `  (void)sc_f;`,
    `}`,
  ];
  for (const l of dropLines) out.push(l);
  E.decl(`${E.link}void ${mangleGenDrop(fn.name)}(void *sc_fp);`);

  const sig = `ScrGen *${mangleGenSpawn(fn.name)}(${params.join(", ") || "void"})`;
  E.decl(`${sig};`);
  const lines: string[] = [
    ``,
    `${E.link}${sig} {`,
    /* has_exc mirrors emitCoroSpawns rather than deciding independently: one
     * place decides fat versus lean, and a second opinion here is exactly
     * the copy-beside-the-source shape this front keeps paying for. */
    `  ${frame} *sc_f = (${frame} *)scr_gen_coro_alloc(sizeof *sc_f, &${mangleCoroResume(fn.name)}, /*has_exc=*/false);`,
    ...(lifted ? [`  sc_f->sc_env = scr_closure_retain(sc_env);`] : []),
    ...fn.params.flatMap((q) => {
      const f = coroField(q.localId);
      if (!boxedIds.has(q.localId)) return [`  sc_f->${f} = ${pname(q)};`];
      /* Built here for the same reason the async spawn builds it here: the
       * slot is already ScrBox *, the body cannot redeclare a frame local,
       * and "constructed exactly once" becomes structural. */
      return [
        `  sc_f->${f} = ${E.boxNewC(q.type)}; /* ${q.name} (boxed param) */`,
        `  scr_box_set_${boxAccess(q.type)}(sc_f->${f}, ${pname(q)}); /* moves the +1 in */`,
      ];
    }),
    `  ScrGen *sc_g = scr_gen_of_coro(&sc_f->base, &${mangleGenDrop(fn.name)});`,
    `  sc_f->sc_gen = sc_g;`,
    `  return sc_g; /* NOTHING has run: the body starts at the first .next() */`,
    `}`,
  ];
  void plan;
  for (const l of lines) out.push(l);
}
