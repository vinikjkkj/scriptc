/* Liveness at suspension points: which locals a coroutine frame would have
 * to carry across each `await`/`yield`.
 *
 * WHY THIS EXISTS. A stackful fiber pays for a whole OS stack because it
 * preserves everything by construction. A stackless frame preserves only
 * what is LIVE ACROSS the suspension, so the frame's size — and therefore
 * whether the transformation pays at all — is exactly the question this
 * answers. It is an ANALYSIS: IR in, sets out. It builds no IR, so it
 * cannot trip the validator, and it is independent of any codegen design.
 *
 * SHAPE. Backward dataflow, syntax-directed over `IrStmt[]`, with a
 * fixpoint on loop bodies — the same walk shape as library/int-infer.ts's
 * forward abstract interpretation, which is this repo's proof that a
 * fixpoint over the statement tree works without materialising a CFG.
 * Liveness runs backwards instead of forwards; the loop/label bookkeeping
 * is otherwise the same.
 *
 * THE ERROR DIRECTION MATTERS. Over-approximating the live set costs a
 * frame slot. UNDER-approximating it drops a value the resumed body still
 * reads — a use-after-free. So every uncertainty here resolves toward
 * "live", and each place where that is deliberate is marked CONSERVATIVE.
 *
 * ONLY EIGHT NODE KINDS NAME A LOCAL — `varRef`, `incDec`, `assignExpr`,
 * `closure` (captures) among expressions; `varDecl`, `assign`, `forOf`,
 * `rethrow` among statements. The other 117 IrStmt/IrExpr arms matter only
 * for TRAVERSAL, which is why the collectors below walk the node graph
 * generically (the `writesLocal` precedent in analysis.ts): a generic walk
 * cannot forget an arm, because it never enumerates them. Bodies reached
 * only by NAME — a call's callee, a closure's `fnName` — are correctly not
 * descended into: lambdas are lifted, so they cannot name this frame's
 * locals except through `captures`, which IS read here. */
import type { IrExpr, IrFunction, IrStmt, SrcLoc } from "./nodes.js";

/** One suspension point and what a frame would have to hold across it. */
export interface SuspensionPoint {
  /** The IR node kind that suspends. */
  kind: "awaitExpr" | "awaitUnionExpr" | "yieldExpr" | "genResume" | "agenResume";
  loc: SrcLoc;
  /** `IrLocal.id`s live ACROSS this point: read after it resumes, or held
   * by a box a closure still references. Excludes the locals this very
   * statement defines — they do not exist yet when it suspends. */
  live: ReadonlySet<string>;
  /** True when the suspension sits nested inside a larger expression, so
   * operands evaluated BEFORE it are already materialised in temporaries
   * the frame must also hold. `live` is exact when this is false. */
  nestedInExpression: boolean;
  /** D1 — the straight-line class the first codegen slice lowers: an
   * `await` that is the ROOT of its statement's expression (`await e;` or
   * `const v = await e;`), with no loop and no try/catch/finally between it
   * and the function. A function is only stackless-eligible when EVERY one
   * of its points is D1: the hybrid is per FUNCTION, not per site, because
   * a frame that is half state machine and half stack is neither. */
  straightLine: boolean;
  /** How many `forOf` loops enclose this point. A `forOf` names ONLY its
   * binding — its iterable reference and cursor are backend-internal and
   * are not IrLocals, so they cannot appear in `live` however correct the
   * dataflow is. Each one is nevertheless real frame state a resumed body
   * needs, so a frame estimate must add them: the measured cost is the
   * iterable pointer plus the cursor, per enclosing loop. */
  enclosingForOf: number;
}

export interface FnLiveness {
  fnName: string;
  points: SuspensionPoint[];
  /** The union over every point: the frame's local slots. */
  frameLocals: ReadonlySet<string>;
  /** The deepest `forOf` nesting over any suspension point — see
   * SuspensionPoint.enclosingForOf for why these are not in `frameLocals`. */
  maxEnclosingForOf: number;
}

const SUSPENSION_KINDS: ReadonlySet<string> = new Set([
  "awaitExpr",
  "awaitUnionExpr",
  "yieldExpr",
  "genResume",
  "agenResume",
]);

/* ── generic collectors ──────────────────────────────────────────────── */

/** Adds every local READ by this node graph to `out`, plus every local a
 * `closure` captures: a capture keeps the box alive for as long as the
 * closure can be called, which this analysis cannot bound (CONSERVATIVE). */
function readsOf(node: unknown, out: Set<string>): void {
  const seen = new Set<object>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    const rec = n as Record<string, unknown>;
    const kind = rec["kind"];
    if (kind === "varRef" || kind === "incDec") {
      const id = rec["localId"];
      if (typeof id === "string") out.add(id);
    } else if (kind === "closure") {
      const caps = rec["captures"];
      if (Array.isArray(caps)) {
        for (const c of caps) if (typeof c === "string") out.add(c);
      }
    }
    // `assignExpr` WRITES localId but still reads its `value`; the generic
    // descent below covers the value and correctly does not add the target.
    for (const k in rec) walk(rec[k]);
  };
  walk(node);
}

interface FoundSuspension {
  node: Record<string, unknown>;
  nested: boolean;
}

/** Every suspension node inside this expression tree, with whether it sits
 * nested under another expression rather than at the root. */
function suspensionsOf(root: IrExpr | null): FoundSuspension[] {
  const out: FoundSuspension[] = [];
  if (root === null) return out;
  const seen = new Set<object>();
  const walk = (n: unknown, depth: number): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x, depth);
      return;
    }
    const rec = n as Record<string, unknown>;
    const kind = rec["kind"];
    const isSusp = typeof kind === "string" && SUSPENSION_KINDS.has(kind);
    if (isSusp) out.push({ node: rec, nested: depth > 0 });
    for (const k in rec) {
      if (k === "loc" || k === "type") continue;
      walk(rec[k], isSusp ? depth : depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/* ── the backward walk ───────────────────────────────────────────────── */

interface Ctx {
  /** Locals that live in a refcounted box because a closure captures them.
   * A write never kills one: the box is shared, so the frame must keep the
   * pointer regardless of what the declaring function last stored. */
  boxed: ReadonlySet<string>;
  points: SuspensionPoint[];
  /** Enclosing `forOf` depth at the statement currently being walked. */
  forOfDepth: number;
  /** Enclosing loop depth (any loop kind) and try/catch/finally depth. Both
   * disqualify a point from D1: a loop needs its back-edge state in the
   * frame, a try needs its handler region re-established on resume. */
  loopDepth: number;
  tryDepth: number;
  /** A `switch` is not a loop, but a resume label inside a case body puts
   * the state machine's re-entry inside the switch block. Legal C, but out
   * of the first slice's scope. */
  switchDepth: number;
  /** Set by the statement cases where the await may be the expression ROOT
   * (`exprStmt`, `varDecl`); false everywhere else, so a suspension in any
   * other statement position is never D1 however shallow it looks. */
  rootOk: boolean;
  /** Loop bodies are walked repeatedly to reach a fixpoint. Only the final
   * walk may record, or a two-await loop reports a point per iteration. */
  recording: boolean;
  /** Live-in of every enclosing `finally` body, innermost last. A `return`
   * inside a guarded try does NOT leave the function: every crossed finally
   * runs first, so whatever those bodies read is still live at the return.
   * Without this a suspension in the try reports an EMPTY live set — the
   * use-after-free direction. */
  finallys: Set<string>[];
}

/** Live set at a loop's exit (for `break`) and at its header (for
 * `continue`). Mirrors int-infer.ts's LoopFrame. */
interface LoopFrame {
  labels: readonly string[];
  breakLive: Set<string>;
  continueLive: Set<string>;
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Record the live-across set for every suspension inside `exprs`, given
 * the live set that holds AFTER the statement and the locals the statement
 * itself defines. */
function recordPoints(
  ctx: Ctx,
  exprs: readonly (IrExpr | null)[],
  liveAfter: ReadonlySet<string>,
  defs: readonly string[],
  boxedUse: readonly string[] = [],
  rootOk = false,
): void {
  ctx.rootOk = rootOk;
  if (!ctx.recording) return;
  const base = new Set(liveAfter);
  for (const d of defs) if (!ctx.boxed.has(d)) base.delete(d);
  // A boxed target is written THROUGH its box, so the box pointer is live
  // across a suspension sitting in the value being stored.
  for (const b of boxedUse) if (ctx.boxed.has(b)) base.add(b);
  for (const e of exprs) {
    const susps = suspensionsOf(e);
    if (susps.length === 0) continue;
    // CONSERVATIVE: for a suspension NESTED in a larger expression, operands
    // evaluated before it are already materialised and operands after it are
    // still to come. Rather than depend on per-arm operand ORDER (the IR
    // carries no evaluation-order contract a generic walk could read), every
    // local the whole enclosing expression reads is treated as live across.
    // Exact when `nested` is false, which is where almost every suspension
    // in real code sits.
    const enclosingReads = new Set<string>();
    if (e !== null && susps.some((s) => s.nested)) readsOf(e, enclosingReads);
    for (const s of susps) {
      const loc = s.node["loc"] as SrcLoc | undefined;
      ctx.points.push({
        kind: s.node["kind"] as SuspensionPoint["kind"],
        loc: loc ?? { file: "", start: 0, end: 0 },
        live: s.nested ? union(base, enclosingReads) : new Set(base),
        nestedInExpression: s.nested,
        straightLine:
          !s.nested &&
          ctx.loopDepth === 0 &&
          ctx.tryDepth === 0 &&
          ctx.switchDepth === 0 &&
          ctx.rootOk &&
          s.node["kind"] === "awaitExpr",
        enclosingForOf: ctx.forOfDepth,
      });
    }
  }
}

/** Backward over a statement list: the live-in, given `liveOut`. */
/** Run `f` with recording suppressed — used for fixpoint iterations. */
function quiet<T>(ctx: Ctx, f: () => T): T {
  const was = ctx.recording;
  ctx.recording = false;
  try {
    return f();
  } finally {
    ctx.recording = was;
  }
}

function backStmts(
  ctx: Ctx,
  stmts: readonly IrStmt[],
  liveOut: ReadonlySet<string>,
  loops: readonly LoopFrame[],
): Set<string> {
  let live = new Set(liveOut);
  for (let i = stmts.length - 1; i >= 0; i--) {
    live = backStmt(ctx, stmts[i]!, live, loops);
  }
  return live;
}

function backStmt(
  ctx: Ctx,
  s: IrStmt,
  liveOut: ReadonlySet<string>,
  loops: readonly LoopFrame[],
): Set<string> {
  switch (s.kind) {
    case "varDecl": {
      recordPoints(ctx, [s.init], liveOut, [s.localId], [], true);
      const live = new Set(liveOut);
      if (!ctx.boxed.has(s.localId)) live.delete(s.localId);
      if (s.init !== null) readsOf(s.init, live);
      return live;
    }
    case "assign": {
      recordPoints(ctx, [s.value], liveOut, [s.localId], [s.localId]);
      const live = new Set(liveOut);
      if (ctx.boxed.has(s.localId)) {
        // Writing a BOXED local is a USE of the box pointer, not a kill:
        // the store goes through the box, so the box has to still be there
        // when a suspension in `value` resumes.
        live.add(s.localId);
      } else {
        live.delete(s.localId);
      }
      readsOf(s.value, live);
      return live;
    }
    case "rethrow": {
      const live = new Set(liveOut);
      live.add(s.localId);
      return live;
    }
    case "exprStmt": {
      recordPoints(ctx, [s.expr], liveOut, [], [], true);
      const live = new Set(liveOut);
      readsOf(s.expr, live);
      return live;
    }
    case "throw": {
      // A throw terminates this path, but an enclosing catch may resume, so
      // liveOut is kept rather than discarded (CONSERVATIVE).
      recordPoints(ctx, [s.value], liveOut, []);
      const live = new Set(liveOut);
      readsOf(s.value, live);
      return live;
    }
    case "return": {
      // Nothing after a return is reachable, so liveOut is discarded — but
      // every enclosing finally still runs on the way out, and what those
      // bodies read is live here.
      const live = new Set<string>();
      for (const f of ctx.finallys) for (const id of f) live.add(id);
      recordPoints(ctx, [s.value], live, []);
      if (s.value !== null) readsOf(s.value, live);
      return live;
    }
    case "block":
      return backStmts(ctx, s.body, liveOut, loops);
    case "if": {
      const thenLive = backStmts(ctx, s.then, liveOut, loops);
      const elseLive =
        s.else_ === null ? new Set(liveOut) : backStmts(ctx, s.else_, liveOut, loops);
      const live = union(thenLive, elseLive);
      recordPoints(ctx, [s.cond], live, []);
      readsOf(s.cond, live);
      return live;
    }
    case "while":
    case "doWhile": {
      // Fixpoint: the body's live-in feeds the header, which feeds the body.
      // Monotone and only growing, so it terminates.
      let live = new Set(liveOut);
      for (;;) {
        const frame: LoopFrame = {
          labels: s.labels ?? [],
          breakLive: new Set(liveOut),
          continueLive: new Set(live),
        };
        const headerLive = new Set(live);
        readsOf(s.cond, headerLive);
        const bodyLive = quiet(ctx, () => backStmts(ctx, s.body, headerLive, [...loops, frame]));
        const next = union(union(live, bodyLive), headerLive);
        if (sameSet(next, live)) break;
        live = next;
      }
      // One more pass with the stable set, this time RECORDING points.
      const frame: LoopFrame = {
        labels: s.labels ?? [],
        breakLive: new Set(liveOut),
        continueLive: new Set(live),
      };
      const headerLive = new Set(live);
      recordPoints(ctx, [s.cond], headerLive, []);
      readsOf(s.cond, headerLive);
      ctx.loopDepth++;
      backStmts(ctx, s.body, headerLive, [...loops, frame]);
      ctx.loopDepth--;
      return union(live, headerLive);
    }
    case "for": {
      let live = new Set(liveOut);
      for (;;) {
        const frame: LoopFrame = {
          labels: s.labels ?? [],
          breakLive: new Set(liveOut),
          continueLive: new Set(live),
        };
        let headerLive = new Set(live);
        if (s.cond !== null) readsOf(s.cond, headerLive);
        const afterUpdate = quiet(ctx, () =>
          s.update === null ? headerLive : backStmt(ctx, s.update, headerLive, [...loops, frame]),
        );
        const bodyLive = quiet(ctx, () => backStmts(ctx, s.body, afterUpdate, [...loops, frame]));
        headerLive = union(headerLive, bodyLive);
        const next = union(live, headerLive);
        if (sameSet(next, live)) break;
        live = next;
      }
      const frame: LoopFrame = {
        labels: s.labels ?? [],
        breakLive: new Set(liveOut),
        continueLive: new Set(live),
      };
      const headerLive = new Set(live);
      if (s.cond !== null) {
        recordPoints(ctx, [s.cond], headerLive, []);
        readsOf(s.cond, headerLive);
      }
      const afterUpdate =
        s.update === null ? headerLive : backStmt(ctx, s.update, headerLive, [...loops, frame]);
      ctx.loopDepth++;
      backStmts(ctx, s.body, afterUpdate, [...loops, frame]);
      ctx.loopDepth--;
      let out = union(live, headerLive);
      if (s.init !== null) out = backStmt(ctx, s.init, out, loops);
      return out;
    }
    case "forOf": {
      let live = new Set(liveOut);
      for (;;) {
        const frame: LoopFrame = {
          labels: s.labels ?? [],
          breakLive: new Set(liveOut),
          continueLive: new Set(live),
        };
        // The binding is rebound by the header on every pass, so it is dead
        // on the back-edge: propagating it would make it live across every
        // suspension in the body.
        const bodyOut = new Set(live);
        if (!ctx.boxed.has(s.localId)) bodyOut.delete(s.localId);
        ctx.forOfDepth++;
        const bodyLive = quiet(ctx, () => backStmts(ctx, s.body, bodyOut, [...loops, frame]));
        ctx.forOfDepth--;
        const next = union(live, bodyLive);
        if (sameSet(next, live)) break;
        live = next;
      }
      const frame: LoopFrame = {
        labels: s.labels ?? [],
        breakLive: new Set(liveOut),
        continueLive: new Set(live),
      };
      const bodyOut = new Set(live);
      if (!ctx.boxed.has(s.localId)) bodyOut.delete(s.localId);
      ctx.forOfDepth++;
      ctx.loopDepth++;
      backStmts(ctx, s.body, bodyOut, [...loops, frame]);
      ctx.loopDepth--;
      ctx.forOfDepth--;
      // The loop binding is defined by the header on every pass, so it is
      // not live ACROSS the iterable's own evaluation.
      const out = new Set(live);
      if (!ctx.boxed.has(s.localId)) out.delete(s.localId);
      recordPoints(ctx, [s.iterable], out, [s.localId]);
      readsOf(s.iterable, out);
      return out;
    }
    case "switch": {
      // CONSERVATIVE: fallthrough means a case body can reach any later
      // body, so each body is evaluated against the union of liveOut and
      // every body's live-in, iterated to a fixpoint.
      let live = new Set(liveOut);
      for (;;) {
        const frame: LoopFrame = {
          labels: s.labels ?? [],
          breakLive: new Set(liveOut),
          continueLive: new Set(live),
        };
        let next = new Set(liveOut);
        for (const c of s.cases) {
          const bodyLive = quiet(ctx, () => backStmts(ctx, c.body, new Set(live), [...loops, frame]));
          next = union(next, bodyLive);
          if (c.test !== null) readsOf(c.test, next);
        }
        if (sameSet(next, live)) break;
        live = union(live, next);
      }
      const frame: LoopFrame = {
        labels: s.labels ?? [],
        breakLive: new Set(liveOut),
        continueLive: new Set(live),
      };
      ctx.switchDepth++;
      for (const c of s.cases) {
        backStmts(ctx, c.body, new Set(live), [...loops, frame]);
        if (c.test !== null) recordPoints(ctx, [c.test], live, []);
      }
      ctx.switchDepth--;
      recordPoints(ctx, [s.disc], live, []);
      const out = new Set(live);
      for (const c of s.cases) if (c.test !== null) readsOf(c.test, out);
      readsOf(s.disc, out);
      return out;
    }
    case "break":
    case "continue": {
      // Control leaves for the loop's exit (break) or header (continue), so
      // the live set THERE — not liveOut — is what holds here.
      const target =
        s.label === undefined
          ? loops[loops.length - 1]
          : [...loops].reverse().find((f) => f.labels.includes(s.label!));
      // A jump with no frame cannot happen in validated IR; staying with
      // liveOut is the conservative answer if it ever does.
      if (target === undefined) return new Set(liveOut);
      return new Set(s.kind === "break" ? target.breakLive : target.continueLive);
    }
    case "tryCatch": {
      // An exception can be raised at ANY point in tryBody, so whatever the
      // handler needs on entry is live throughout the try. Compute the
      // handlers first and seed the try body's walk with their live-ins.
      // The finally body itself is walked with the OUTER finally stack: a
      // jump out of a finally is refused by the frontend (SC1090), so it
      // only ever completes normally or by throwing.
      const afterFinally =
        s.finallyBody === null ? new Set(liveOut) : backStmts(ctx, s.finallyBody, liveOut, loops);
      if (s.finallyBody !== null) ctx.finallys.push(afterFinally);
      ctx.tryDepth++;
      try {
        const catchLive =
          s.catchBody === null ? new Set<string>() : backStmts(ctx, s.catchBody, afterFinally, loops);
        if (s.catchLocalId !== null && !ctx.boxed.has(s.catchLocalId)) {
          catchLive.delete(s.catchLocalId);
        }
        const tryLive = backStmts(ctx, s.tryBody, union(afterFinally, catchLive), loops);
        return union(tryLive, catchLive);
      } finally {
        ctx.tryDepth--;
        if (s.finallyBody !== null) ctx.finallys.pop();
      }
    }
    case "arraySet":
    case "bytesSet": {
      recordPoints(ctx, [s.arr, s.index, s.value], liveOut, []);
      const live = new Set(liveOut);
      readsOf(s.arr, live);
      readsOf(s.index, live);
      readsOf(s.value, live);
      return live;
    }
    case "arrayClear": {
      recordPoints(ctx, [s.arr, s.index], liveOut, []);
      const live = new Set(liveOut);
      readsOf(s.arr, live);
      readsOf(s.index, live);
      return live;
    }
    case "fieldSet":
    case "recordSet": {
      recordPoints(ctx, [s.obj, s.value], liveOut, []);
      const live = new Set(liveOut);
      readsOf(s.obj, live);
      readsOf(s.value, live);
      return live;
    }
    case "recordKeySet": {
      recordPoints(ctx, [s.obj, s.key, s.value], liveOut, []);
      const live = new Set(liveOut);
      readsOf(s.obj, live);
      readsOf(s.key, live);
      readsOf(s.value, live);
      return live;
    }
    case "recordKeyDelete": {
      recordPoints(ctx, [s.obj, s.key], liveOut, []);
      const live = new Set(liveOut);
      readsOf(s.obj, live);
      readsOf(s.key, live);
      return live;
    }
    case "runtimeFence":
      return new Set(liveOut);
    default: {
      // A new IrStmt arm must not silently under-report liveness, which is
      // the use-after-free direction. Fail loudly instead.
      const never: never = s;
      throw new Error(
        `liveness: unhandled IrStmt kind ${String((never as { kind: string }).kind)}`,
      );
    }
  }
}

/** Liveness at every suspension point of one function. Null when the
 * function has no suspension point — there is no frame to size. */
export function suspensionLiveness(fn: IrFunction): FnLiveness | null {
  const boxed = new Set(fn.locals.filter((l) => l.boxed === true).map((l) => l.id));
  const ctx: Ctx = {
    boxed,
    points: [],
    recording: true,
    finallys: [],
    forOfDepth: 0,
    loopDepth: 0,
    tryDepth: 0,
    switchDepth: 0,
    rootOk: false,
  };
  backStmts(ctx, fn.body, new Set<string>(), []);
  if (ctx.points.length === 0) return null;
  const frameLocals = new Set<string>();
  for (const p of ctx.points) for (const id of p.live) frameLocals.add(id);
  const maxEnclosingForOf = ctx.points.reduce((m, p) => Math.max(m, p.enclosingForOf), 0);
  return { fnName: fn.name, points: ctx.points, frameLocals, maxEnclosingForOf };
}

/* ── the D1 slice's eligibility rule ─────────────────────────────────── */

export interface StacklessPlan {
  fnName: string;
  /** One per suspension point, in the order the emitter will number them:
   * state 0 is the entry, so point i resumes at state i+1. */
  points: SuspensionPoint[];
  /** Locals the frame must carry across a suspension. Everything else stays
   * an ordinary C local in the resume function — it cannot be live across a
   * park, so a reload would have nothing to reload. */
  frameLocals: ReadonlySet<string>;
}

/** Whether this function can be lowered to a stackless state machine by the
 * D1 slice, and the frame it would need.
 *
 * THE HYBRID IS PER FUNCTION, NOT PER SITE. One non-D1 suspension and the
 * whole function stays on a fiber: a frame that is half state machine and
 * half native stack is neither, and the per-function choice is free because
 * call sites only ever see the spawn wrapper's `ScrPromise *`.
 *
 * The exclusions beyond D1 are scope, not difficulty: generators need the
 * second machine and module initialisers carry the evaluation-promise
 * cache. A LIFTED body is in: its closure environment is one frame field,
 * and the capture bindings re-derive from it on every resume because the
 * prologue that reads `sc_env->caps[i]` runs before the state dispatch. */
export function stacklessPlan(fn: IrFunction): StacklessPlan | null {
  if (fn.async !== true) return null;
  if (fn.generator !== undefined) return null;
  if (fn.asyncCacheGlobal !== undefined || fn.asyncCycleCacheGlobal !== undefined) return null;
  // A boxed PARAM arrives under a raw name and is moved into a fresh box by
  // the prologue; in a resume function both the raw name and the box would
  // have to be frame state. Out of scope for the first slice. A boxed LOCAL
  // is fine — its box pointer spills like any other pointer.
  const paramIds = new Set(fn.params.map((p) => p.localId));
  if (fn.locals.some((l) => l.boxed === true && paramIds.has(l.id))) return null;
  const r = suspensionLiveness(fn);
  if (r === null) return null;
  if (!r.points.every((p) => p.straightLine)) return null;
  return { fnName: fn.name, points: r.points, frameLocals: r.frameLocals };
}
