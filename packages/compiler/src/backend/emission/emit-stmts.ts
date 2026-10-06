/* Statement-level C emission: function bodies, blocks/scopes, the statement
 * dispatch (emitStmt), try/catch lowering, and switch — plus the small
 * branch/condition helpers they share with expression emission. All frame,
 * scope, and temp state lives on CEmitter; these functions drive it. */
import type { CEmitter, ScopeEntry } from "./emitter.js";
import type { IrFunction, IrLocal } from "../../ir/nodes.js";
import { mangleField, mangleGlobal, mangleLocal, mangleRawParam } from "../mangle.js";
import { BOOL, CAUGHT, IrExpr, IrStmt, RUNTIME_ERROR_CLASSES, isRefCounted, ownMaskKeyBit } from "../../ir/nodes.js";
import { boxAccess, cDecl, cStringLiteral, elemAccess, vAdapters } from "./emit-types.js";
import { OVERFLOW_MEMBER, OWNMASK_MEMBER } from "./emit-shapes.js";
import { emitStableReceiver } from "./emit-exprs.js";
import { writesLocal } from "../../ir/analysis.js";
import { coroPrologue, coroDispatch, coroFinish, coroField } from "./emit-coro.js";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";






/** Counts every `localId` mentioned anywhere inside an IR node.
 *
 * Structural rather than kind-directed, deliberately. The IR is plain
 * JSON-safe data by construction (ir/serialize.ts states it and enforces
 * it), so this terminates; and a node kind added tomorrow that carries a
 * localId is counted the day it is added, where a hand-written per-kind
 * walk would silently stop counting it. A MISSED reference here would be
 * a use-after-free, not a size regression, so the walk that cannot miss
 * one is the right one even though it is slower. Nodes are never shared
 * (the IR serializes as a tree), so a count is an occurrence count. */
  function countLocalIds(node: unknown, into: Map<string, number>): void {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) countLocalIds(item, into);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "localId" && typeof v === "string") into.set(v, (into.get(v) ?? 0) + 1);
      else countLocalIds(v, into);
    }
  }

/** The hidden locals whose ENTIRE live range is one seqExpr.
 *
 * A seqExpr is straight-line — the validator restricts its statements to
 * writes, so no jump leaves the region — and the lowerings that build one
 * mint their scratch locals with declareHiddenLocal, which binds them to
 * NO ts.Symbol: nothing in the source can name them. Such a local is dead
 * the moment the seqExpr's value has been produced. It nevertheless lives
 * in the enclosing BLOCK scope, so every unwind between the seqExpr and
 * that block's end names it — and N property writes in one function cost
 * 1.5N² release lines instead of a constant per write.
 *
 * Two conditions, both CHECKED rather than assumed, because thirty-odd
 * lowerings build seqExprs and this rule must be right for all of them
 * and for the ones written after it:
 *
 *   - the local is HIDDEN (`%`-prefixed — declareHiddenLocal's own
 *     naming), so no source-visible binding is ever rescoped;
 *   - it is mentioned exactly as many times inside the seqExpr as in the
 *     whole function body, i.e. there is NO reference outside the region.
 *     A builder that keeps a local alive past its seqExpr simply does not
 *     get the scope, and keeps today's emission exactly.
 *
 * Boxed locals are excluded outright: a box is shared with a closure, so
 * its lifetime is not the region's to end. Params and captures likewise —
 * the function scope owns those. */
  export function seqScopedLocals(fn: IrFunction): Set<string> {
    const out = new Set<string>();
    const byId = new Map(fn.locals.map((l) => [l.id, l]));
    const paramIds = new Set(fn.params.map((p) => p.localId));
    const capIds = new Set((fn.captures ?? []).map((c) => c.localId));
    const whole = new Map<string, number>();
    countLocalIds(fn.body, whole);
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      const n = node as { kind?: unknown; stmts?: unknown };
      if (n.kind === "seqExpr" && Array.isArray(n.stmts)) {
        const inside = new Map<string, number>();
        countLocalIds(node, inside);
        for (const s of n.stmts as IrStmt[]) {
          if (s.kind !== "varDecl") continue;
          const local = byId.get(s.localId);
          if (!local || local.boxed === true) continue;
          if (!local.name.startsWith("%")) continue;
          if (paramIds.has(s.localId) || capIds.has(s.localId)) continue;
          if ((inside.get(s.localId) ?? 0) !== (whole.get(s.localId) ?? 0)) continue;
          out.add(s.localId);
        }
      }
      for (const v of Object.values(node as Record<string, unknown>)) visit(v);
    };
    visit(fn.body);
    return out;
  }

/* The stack-depth guard, and the ONE case it is elided in.
 *
 * Every emitted function opens with SCR_STACK_CHECK() so a runaway recursion
 * throws Node's catchable RangeError instead of reaching the guard page and
 * dying with 0xC00000FD. The test is universal rather than classified by the
 * call graph: a static graph cannot close over indirect, virtual or callback
 * calls, and under-approximating recursion costs CORRECTNESS here rather than
 * precision, so the universal form is the only one sound by construction.
 *
 * The single elision is NOT a recursion classifier. It asks a LOCAL question
 * about the body just lowered -- "can this emit a call instruction at all?" --
 * which needs no graph, no fixpoint and no propagation. A body with no call
 * reaches nobody, so it cannot reach ITSELF, and its own frame is bounded by
 * the largest frame the codegen emits (4096 B measured over 22,008 frames,
 * corroborated by zero __chkstk calls) which is under SCR_STACK_MARGIN. So
 * entering it from an already-checked caller is safe by arithmetic.
 *
 * DEFAULT-DENY, because the real question is whether the ASSEMBLY has a call
 * and this runs on the IR: the whitelist is tiny, every node kind outside it
 * demands the check, and so does any value that is not f64/bool/void -- which
 * is what keeps out the things a backend turns into a call later (bigint
 * helpers, struct copies, string ops) and the refcounted locals whose scope
 * cleanup emits release calls. The walk is STRUCTURAL rather than per-kind on
 * purpose: an unrecognised nested node fails closed instead of being missed. */
const STACK_FREE_STMTS = new Set(["block", "return", "assign", "varDecl", "if", "exprStmt", "break", "continue", "while", "doWhile", "for"]);
const STACK_FREE_EXPRS = new Set(["numLit", "boolLit", "varRef", "bin", "unary", "logical", "ternary"]);
const STACK_FREE_TYPES = new Set(["f64", "bool", "void"]);

function stackScalarOnly(t: unknown): boolean {
  const k = (t as { kind?: string } | null | undefined)?.kind;
  return typeof k === "string" && STACK_FREE_TYPES.has(k);
}

export function stackCheckElidable(fn: IrFunction): boolean {
  if (fn.generator) return false;
  if ((fn.captures ?? []).length > 0) return false;
  if (!stackScalarOnly(fn.returnType)) return false;
  for (const l of fn.locals) if (l.boxed || !stackScalarOnly(l.type)) return false;
  let ok = true;
  const visit = (n: unknown): void => {
    if (!ok || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    const o = n as Record<string, unknown>;
    const k = o["kind"];
    if (typeof k === "string" && !STACK_FREE_STMTS.has(k) && !STACK_FREE_EXPRS.has(k) && !STACK_FREE_TYPES.has(k)) { ok = false; return; }
    if (o["type"] !== undefined && typeof o["type"] === "object" && !stackScalarOnly(o["type"])) { ok = false; return; }
    for (const key of Object.keys(o)) { if (key === "loc") continue; visit(o[key]); }
  };
  visit(fn.body);
  return ok;
}

/** WHERE the stack-depth prologue goes. This is the POLICY, deliberately
 * separate from the safety ASSERTION in emitFunction: edit this and the
 * assertion refuses any coverage that breaks propagation.
 *
 * Only functions the may-throw analysis ALREADY marks as throwing get the
 * prologue. Their call sites already carry `if (scr_exc_pending())`, so the
 * RangeError propagates by the runtime's ordinary contract and no call site
 * anywhere pays anything new.
 *
 * The alternative -- the prologue in EVERY function -- was measured and
 * rejected: it needs every function marked may-throw, which puts a pending
 * check on every call site in the program for a condition that occurs zero
 * times in a normal run, and invalidates every analysis that relies on "this
 * function cannot throw".
 *
 * The gap this leaves is a recursion cycle made ENTIRELY of non-throwing
 * functions (pure arithmetic). That case keeps today's behaviour -- it
 * crashes -- and is never a silent wrong answer, which is the property that
 * made partial coverage the better trade. */
export function stackCheckPolicy(mayThrow: Set<string>, fn: IrFunction): boolean {
  if (stackCheckElidable(fn)) return false;
  return mayThrow.has(fn.name);
}


/** The stack margin, READ FROM THE HEADER rather than duplicated here.
 *
 * The C lane expands SCR_STACK_MARGIN from scr_runtime.h through the
 * preprocessor. The LLVM lane has no preprocessor and would otherwise need
 * its own copy of the number -- two sources of truth for a SAFETY constant,
 * and a silent divergence between the backends the first time either is
 * edited. Parsing the macro keeps one definition for both lanes.
 *
 * A header that stops defining it FAILS THE BUILD rather than falling back to
 * a default: this number is what stands between a deep recursion and a
 * 0xC00000FD, and it was measured (the throw path alone needs 18 KiB), not
 * chosen. Guessing it quietly is the failure mode worth refusing. */
let stackMarginKibCache: number | null = null;
function stackMarginKib(): number {
  if (stackMarginKibCache !== null) return stackMarginKibCache;
  const req = createRequire(import.meta.url);
  const hdr = join(dirname(req.resolve("@scriptc/runtime/package.json")), "src", "scr_runtime.h");
  const m = /#define\s+SCR_STACK_MARGIN_KIB\s+(\d+)/.exec(readFileSync(hdr, "utf8"));
  if (m === null) {
    throw new Error(
      `cannot read SCR_STACK_MARGIN_KIB from ${hdr} -- the LLVM backend has no preprocessor and ` +
        `must not guess a safety constant. Either restore the macro or teach both lanes the new ` +
        `spelling.`,
    );
  }
  stackMarginKibCache = Number(m[1]);
  return stackMarginKibCache;
}

export function stackMarginBytes(): number {
  return stackMarginKib() * 1024;
}

/** The symbol whose NAME carries the margin, so the two lanes' independently
 * resolved headers are compared BY VALUE at link time instead of trusted.
 *
 * The runtime defines exactly one of these, named from its own
 * SCR_STACK_MARGIN_KIB (scr_stack_margin.c). This lane references the name built
 * from the value IT parsed, so a lane that resolved a different copy of
 * scr_runtime.h fails the LINK -- loudly, on every build of every program --
 * instead of passing every static check and shipping a guard that fires at
 * the wrong depth. The C lane gets the same check for free, from a pin in
 * the header itself.
 *
 * SCOPE: this closes the RESOLUTION vector only. It does NOT make the C and
 * LLVM instruction sequences equivalent -- that remains supported by the
 * acceptance measurement (depth 149482 on C against 149495 on LLVM) and by
 * no assertion. */
export function stackMarginSymbol(): string {
  return `scr_stack_margin_is_${stackMarginKib()}kib`;
}
export function emitFunction(E: CEmitter, fn: IrFunction): void {
    E.tempCounter = 0;
    E.frames = [];
    E.scopes = [];
    E.jumpTargets = [];
    E.tryStack = [];
    E.finallyStack = [];
    E.currentReturnType = fn.returnType;
    E.currentGenerator = fn.generator ?? null;
    E.labelCounter = 0;
    E.currentLocals = new Map(fn.locals.map((l) => [l.id, l]));
    E.currentFn = fn;
    E.currentCoro = E.coroPlansByFn.get(fn.name) ?? null;
    E.coroPointIndex = 0;
    const coro = E.currentCoro;
    E.captureIds = new Set((fn.captures ?? []).map((c) => c.localId));
    E.seqScoped = seqScopedLocals(fn);
    E.seqScopeAt.clear();

    if (coro !== null) {
      for (const l of coroPrologue(E, fn, coro)) E.line(l);
      E.indent++;
    } else {
      E.line(`${E.signature(fn)} {${E.srcComment(fn.loc)}`);
      E.indent++;
    }


    // The pending-return slot: a `return` crossing a finally computes its
    // value FIRST (before the finally runs — snapshotting it here is what
    // makes finally mutations of returned locals invisible, Node-exact),
    // then jumps through every crossed finally; the last dispatch returns
    // the slot. Declared only when some return actually crosses a finally.
    if (fn.returnType.kind !== "void" && returnCrossesFinally(fn.body)) {
      const init = isRefCounted(fn.returnType) ? "NULL" : "0";
      E.line(`${cDecl(fn.returnType, "sc_pret")} = ${init}; /* pending return (through finally) */`);
    }

    // Captured bindings come in through the environment — borrowed for the
    // whole call (the closure owns them): bound here, never released here.
    (fn.captures ?? []).forEach((c, i) => {
      E.line(`ScrBox *${mangleLocal(c.localId)} = sc_env->caps[${i}]; /* captured ${c.name} */`);
    });

    const paramIds = new Set(fn.params.map((p) => p.localId));
    for (const local of fn.locals) {
      // A resume function has no C parameters: every param is a local the
      // dispatch reloads from the frame below.
      if ((coro === null && paramIds.has(local.id)) || E.captureIds.has(local.id)) continue;
      if (local.boxed) {
        E.line(`ScrBox *${mangleLocal(local.id)} = NULL; /* ${local.name} (boxed) */`);
      } else {
        const init = isRefCounted(local.type) ? " = NULL" : "";
        E.line(`${cDecl(local.type, mangleLocal(local.id))}${init}; /* ${local.name} */`);
      }
    }

    if (coro !== null) {
      // The declarations above dominate every label, so the dispatch can
      // jump into the body. This is only legal because IrFunction.locals is
      // scope-flat and emitted at the top.
      for (const l of coroDispatch(coro)) E.line(l);
      for (const p of fn.params) {
        E.line(`${mangleLocal(p.localId)} = sc_f->${coroField(p.localId)};`);
      }
    }

    // Function scope owns refcounted params (callees own their params).
    // Boxed params: allocate the shared binding and move the raw value in.
    const fnScope: ScopeEntry[] = [];
    for (const p of fn.params) {
      const local = E.currentLocals.get(p.localId)!;
      if (local.boxed) {
        const box = mangleLocal(p.localId);
        if (coro !== null) {
          // STACKLESS: emitCoroSpawns built the box and the dispatch above has
          // already reloaded it from the frame. Constructing it again here
          // would redeclare the local the resume function declares at its top,
          // and would rebuild the box on the entry path only -- so the scope
          // still OWNS it (one release at function end, as on the fiber path),
          // but nothing is emitted for it.
          fnScope.push({ name: box, type: p.type, boxed: true });
        } else {
          E.line(`ScrBox *${box} = ${E.boxNewC(p.type)}; /* ${p.name} (boxed param) */`);
          E.line(`scr_box_set_${boxAccess(p.type)}(${box}, ${mangleRawParam(p.localId)});`);
          fnScope.push({ name: box, type: p.type, boxed: true });
        }
      } else if (isRefCounted(p.type)) {
        fnScope.push({ name: mangleLocal(p.localId), type: p.type });
      }
    }
    E.scopes.push(fnScope);
    // The stack-depth guard. Emitted HERE -- after the function scope owns
    // its refcounted params -- so the bail-out unwind RELEASES them. Emitting
    // it before that point leaks every refcounted param on the throw path,
    // which the RC audit would catch; found by porting this to the LLVM lane.
    const wantStackCheck = stackCheckPolicy(E.mayThrow, fn);
    // THE SAFETY INVARIANT, asserted rather than commented. A prologue that
    // throws into a function whose CALL SITES carry no pending check does not
    // crash -- it is worse: the error return is read as a value. Measured on
    // the universal version, which returned 258039 and exited 0 where node
    // throws a RangeError. Re-derived here independently of the policy above,
    // so widening coverage without widening propagation fails the BUILD
    // rather than shipping a silent wrong answer.
    if (wantStackCheck && !E.mayThrow.has(fn.name)) {
      throw new Error(
        `emitter bug: stack-depth prologue requested for '${fn.name}', which is NOT in the ` +
          `may-throw set. Its call sites carry no pending-exception check, so the RangeError ` +
          `would be swallowed and its error return read as a real value. Either leave the ` +
          `prologue out of this function or make it may-throw (which costs a pending check at ` +
          `every call site in the program).`,
      );
    }
    if (wantStackCheck) {
      // The cold arm carries the function's OWN unwind: a throw here sets the
      // exception cell and returns, so the prologue must bail out exactly as
      // the emitter's contract does after any throwing call. Nothing is live
      // yet at function entry, so the unwind is a bare return.
      E.line(`if (SCR_STACK_LOW()) {`);
      E.indent++;
      E.line(`scr_stack_exhausted();`);
      E.emitUnwind();
      E.indent--;
      E.line(`}`);
    }
    E.emitStmts(fn.body);
    // Implicit exit of a void function: release function-scope refcounted
    // locals (unless the body already ended in an explicit return or a
    // throw, whose unwind released everything down to depth 0).
    const last = fn.body[fn.body.length - 1]?.kind;
    const endedWithReturn = last === "return" || last === "throw" || last === "rethrow" || last === "runtimeFence";
    if (fn.returnType.kind === "void" && !endedWithReturn) {
      E.releaseFrame(E.scopes[0]!);
    }
    if (coro !== null && !endedWithReturn) {
      // A resume function that falls off the end has neither suspended,
      // finished, nor thrown, and the runtime asserts on exactly that. The
      // fiber trampoline fulfils the promise for an implicit void exit; a
      // coroutine has to do it here, because the body IS the trampoline.
      // Unreachable when the body really did end in a return on every path,
      // and harmless there.
      for (const l of coroFinish(E, E.currentReturnType, null, fn.captures !== undefined)) E.line(l);
    }
    E.scopes.pop();

    E.indent--;
    E.line(`}`);
    E.line(``);
  }

/** The statement bodies nested directly under a statement — the shared
   * walk for returnCrossesFinally. */
  function childBodies(s: IrStmt): IrStmt[][] {
    switch (s.kind) {
      case "if":
        return s.else_ ? [s.then, s.else_] : [s.then];
      case "while":
      case "doWhile":
      case "forOf":
      case "block":
        return [s.body];
      case "for":
        return [s.body];
      case "switch":
        return s.cases.map((c) => c.body);
      case "tryCatch":
        return [
          s.tryBody,
          ...(s.catchBody ? [s.catchBody] : []),
          ...(s.finallyBody ? [s.finallyBody] : []),
        ];
      default:
        return [];
    }
  }

/** True when some `return` sits inside the tryBody/catchBody of a
   * try-with-finally, at any nesting depth — exactly the returns the
   * pending-return path routes, and so exactly when emitFunction must
   * declare the sc_pret slot. */
  function returnCrossesFinally(stmts: IrStmt[]): boolean {
    const hasReturn = (body: IrStmt[]): boolean =>
      body.some((s) => s.kind === "return" || childBodies(s).some(hasReturn));
    const walk = (body: IrStmt[]): boolean =>
      body.some((s) => {
        if (
          s.kind === "tryCatch" &&
          s.finallyBody !== null &&
          (hasReturn(s.tryBody) || (s.catchBody !== null && hasReturn(s.catchBody)))
        ) {
          return true;
        }
        return childBodies(s).some(walk);
      });
    return walk(stmts);
  }

/** Emits a block in its own lexical scope (refcounted locals released at
   * end). `setup` runs after the scope opens, before the statements — the
   * catch-binding hook: it may emit prelude lines and register entries the
   * scope owns (released on every exit, jumps and unwinds included). */
  export function emitBlock(E: CEmitter, stmts: IrStmt[], setup?: (scope: ScopeEntry[]) => void): void {
    E.line(`{`);
    E.indent++;
    const scope: ScopeEntry[] = [];
    E.scopes.push(scope);
    setup?.(scope);
    E.emitStmts(stmts);
    const endedWithJump = E.endsWithJump(stmts);
    E.scopes.pop();
    if (!endedWithJump) E.releaseFrame(scope);
    E.indent--;
    E.line(`}`);
  }

export function emitStmts(E: CEmitter, stmts: IrStmt[]): void {
    for (const s of stmts) E.emitStmt(s);
  }

export function emitStmt(E: CEmitter, s: IrStmt): void {
    E.frames.push([]);
    switch (s.kind) {
      case "varDecl": {
        const local = E.currentLocals.get(s.localId)!;
        const target = mangleLocal(s.localId);
        if (s.init === null) {
          // Declared, uninitialized (`let x: number;`). tsc's TS2454 rejects
          // any read before assignment, so no runtime check is needed — but
          // the declaration must still RESET the C local: inside a loop the
          // previous iteration's scope exit released the old value and left
          // a stale pointer, and the scope-exit release below runs whether
          // or not an `assign` ever did (runtime releases are NULL-tolerant).
          if (local.boxed) {
            // The box must exist immediately: closures created before the
            // first assignment capture it. (tsc's TS2454 can't see through
            // closures — a call before the first assignment reads 0/false
            // for scalars and traps for refcounted kinds, where JS has
            // `undefined`.)
            // A SCALAR TDZ box rides an ARR-kind box: the value lives in a
            // one-element array cell, so the empty (NULL) slot stays the
            // not-yet-initialized sentinel — a raw scalar slot has no spare
            // bit pattern to spend on it.
            const boxNew =
              local.tdz && boxAccess(local.type) !== "ref"
                ? "scr_box_new(SCR_BOX_ARR)"
                : E.boxNewC(local.type);
            E.line(`${target} = ${boxNew};${E.srcComment(s.loc)} /* let ${local.name}; */`);
            E.declScope(s.localId).push({ name: target, type: local.type, boxed: true });
          } else if (isRefCounted(local.type)) {
            E.line(`${target} = NULL;${E.srcComment(s.loc)} /* let ${local.name}; */`);
            E.declScope(s.localId).push({ name: target, type: local.type });
          }
          // Scalars need nothing: the C local exists from the prologue and
          // no read happens before an assign writes it.
          break;
        }
        if (local.boxed) {
          // Box FIRST, then evaluate the initializer: a named function
          // expression's closure captures this box during init evaluation.
          E.line(`${target} = ${E.boxNewC(local.type)};${E.srcComment(s.loc)}`);
          E.declScope(s.localId).push({ name: target, type: local.type, boxed: true });
          const v = E.emitExpr(s.init);
          if (isRefCounted(v.type)) E.moveTemp(v); // the box takes ownership
          E.line(`scr_box_set_${boxAccess(local.type)}(${target}, ${v.name});`);
          break;
        }
        const v = E.emitExpr(s.init);
        E.moveTemp(v);
        E.line(`${target} = ${v.name};${E.srcComment(s.loc)}`);
        if (isRefCounted(v.type)) {
          E.declScope(s.localId).push({ name: target, type: v.type });
        }
        break;
      }
      case "assign": {
        const local = E.currentLocals.get(s.localId);
        if (!local) {
          // Module global: plain static storage, never boxed. Old-value
          // release is NULL-tolerant (statics start NULL).
          const g = E.globalsById.get(s.localId);
          if (!g) throw new Error(`emitter bug: assign to unknown binding ${s.localId}`);
          const target = mangleGlobal(g.id);
          const v = E.emitExpr(s.value);
          E.moveTemp(v);
          if (isRefCounted(v.type)) E.releaseValue(target, v.type);
          E.line(`${target} = ${v.name};${E.srcComment(s.loc)}`);
          break;
        }
        const target = mangleLocal(s.localId);
        if (emitStrAccum(E, s, local)) break;
        const v = E.emitExpr(s.value);
        if (local!.boxed) {
          // A scalar TDZ box (forward-captured const): the initializing
          // write mints the one-element array cell — set_ref moves it in
          // (and the empty-slot sentinel ends here).
          if (local!.tdz && boxAccess(local!.type) !== "ref") {
            const acc = boxAccess(local!.type);
            const cell = `sc_t${E.tempCounter++}`;
            E.line(`ScrArr *${cell} = ${E.arrNewC(local!.type, 1)};${E.srcComment(s.loc)}`);
            E.line(`scr_arr_push_${acc}(${cell}, ${v.name});`);
            E.line(`scr_box_set_ref(${target}, ${cell});`);
            break;
          }
          if (isRefCounted(v.type)) E.moveTemp(v); // set_ref releases the old value
          E.line(`scr_box_set_${boxAccess(local!.type)}(${target}, ${v.name});${E.srcComment(s.loc)}`);
          break;
        }
        E.moveTemp(v);
        if (isRefCounted(v.type)) E.releaseValue(target, v.type);
        E.line(`${target} = ${v.name};${E.srcComment(s.loc)}`);
        break;
      }
      case "exprStmt":
        E.emitExpr(s.expr);
        break;
      case "if": {
        const cond = E.emitCondition(s.cond);
        E.line(`if (${cond}) `);
        E.mergeBrace(() => E.emitBlock(s.then));
        if (s.else_) {
          E.line(`else `);
          E.mergeBrace(() => E.emitBlock(s.else_!));
        }
        break;
      }
      case "while": {
        E.line(`for (;;) {${E.srcComment(s.loc)}`);
        E.indent++;
        const cond = E.emitCondition(s.cond);
        E.line(`if (!(${cond})) break;`);
        // C continue re-evaluates the condition at the top: exactly right
        // for the unlabeled loop. A LABELED while allocates a continue
        // label placed at the END of the body (falling off it re-enters
        // the condition — the same point) so a labeled continue from a
        // NESTED loop can goto it, and a lazy end label for labeled break.
        const loop = E.loopTarget(null, s.labels);
        E.jumpTargets.push(loop);
        E.emitBlock(s.body);
        E.jumpTargets.pop();
        if (loop.usedContinue && loop.continueLabel) E.line(`${loop.continueLabel}:;`);
        E.indent--;
        E.line(`}`);
        if (loop.usedEnd) E.line(`${loop.endLabel}:;`);
        break;
      }
      case "doWhile": {
        // `for (;;) { body; cont: cond; if (!cond) break; }` — the body runs
        // before the first condition check (at least once), and `continue`
        // routes through the label so the condition still evaluates.
        E.line(`for (;;) {${E.srcComment(s.loc)}`);
        E.indent++;
        const loop = E.loopTarget(`sc_cont_${E.labelCounter++}`, s.labels);
        E.jumpTargets.push(loop);
        E.emitBlock(s.body);
        E.jumpTargets.pop();
        if (loop.usedContinue) E.line(`${loop.continueLabel}:;`);
        const cond = E.emitCondition(s.cond);
        E.line(`if (!(${cond})) break;`);
        E.indent--;
        E.line(`}`);
        if (loop.usedEnd) E.line(`${loop.endLabel}:;`);
        break;
      }
      case "switch":
        E.emitSwitch(s);
        break;
      case "for": {
        // Desugared in place; the init's scope wraps the whole loop, so
        // break/continue must NOT release it (scopeDepth captured after).
        E.line(`{${E.srcComment(s.loc)}`);
        E.indent++;
        E.scopes.push([]);
        if (s.init) E.emitStmt(s.init);
        E.line(`for (;;) {`);
        E.indent++;
        if (s.cond) {
          const cond = E.emitCondition(s.cond);
          E.line(`if (!(${cond})) break;`);
        }
        // C continue would skip the update; route it through a label instead.
        const loop = E.loopTarget(`sc_cont_${E.labelCounter++}`, s.labels);
        E.jumpTargets.push(loop);
        E.emitBlock(s.body);
        E.jumpTargets.pop();
        if (loop.usedContinue) E.line(`${loop.continueLabel}:;`);
        // JS `for (let i ...)`: each iteration gets a FRESH binding holding a
        // copy of the previous one, and the update mutates the fresh binding
        // — that's why closures made in iteration k keep seeing iteration
        // k's value. Only observable (and only emitted) when captured.
        if (s.init?.kind === "varDecl") {
          const initLocal = E.currentLocals.get(s.init.localId);
          if (initLocal?.boxed) {
            const box = mangleLocal(initLocal.id);
            const fresh = `sc_t${E.tempCounter++}`;
            const acc = boxAccess(initLocal.type);
            E.line(`ScrBox *${fresh} = ${E.boxNewC(initLocal.type)}; /* per-iteration ${initLocal.name} */`);
            E.line(`scr_box_set_${acc}(${fresh}, scr_box_get_${acc}(${box}));`);
            E.line(`scr_box_release(${box});`);
            E.line(`${box} = ${fresh};`);
            // The wrapper scope's entry releases whatever `box` points to at
            // loop exit — which is now the freshest binding. Nothing to fix.
          }
        }
        if (s.update) E.emitStmt(s.update);
        E.indent--;
        E.line(`}`);
        // A labeled break lands exactly where C break does: BEFORE the
        // init scope's release (the goto path must run the same releases
        // as the fall-through path).
        if (loop.usedEnd) E.line(`${loop.endLabel}:;`);
        E.releaseFrame(E.scopes.pop()!);
        E.indent--;
        E.line(`}`);
        break;
      }
      case "arraySet": {
        // Evaluation order matches JS: array, index, then value. Ownership
        // of a refcounted value moves into the array (the runtime releases
        // the replaced element itself).
        const arr = E.emitExpr(s.arr);
        const idx = E.emitExpr(s.index);
        const v = E.emitExpr(s.value);
        if (s.arr.type.kind !== "array") throw new Error("emitter bug: arraySet on non-array");
        const acc = elemAccess(s.arr.type.elem);
        if (acc === "ref") E.moveTemp(v);
        E.line(`scr_arr_set_${acc}(${arr.name}, ${idx.name}, ${v.name});${E.srcComment(s.loc)}`);
        break;
      }
      case "arrayClear": {
        // The tombstone write `a[i] = null as unknown as T`: the slot takes
        // the element type's ABSENT value — the same one arrayNewLen and
        // the growth half of setLength push — and scr_arr_set_ref releases
        // whatever it displaced. Evaluation order is arraySet's minus the
        // value (a unit source is pure; JS evaluates nothing either).
        const arr = E.emitExpr(s.arr);
        const idx = E.emitExpr(s.index);
        if (s.arr.type.kind !== "array") throw new Error("emitter bug: arrayClear on non-array");
        E.line(
          `scr_arr_set_ref(${arr.name}, ${idx.name}, ${E.absentElemC(s.arr.type.elem)});${E.srcComment(s.loc)}`,
        );
        break;
      }
      case "bytesSet": {
        // Typed-array element write: same evaluation order as arraySet;
        // the value is a scalar (the runtime coerces JS-exactly), so no
        // ownership moves. Any invalid index traps — no append.
        // The receiver may be BORROWED for the same reason the read side
        // borrows: index and value are checked stable, and the write
        // coerces a scalar without ever running user code.
        const arr = emitStableReceiver(E, s.arr, [s.index, s.value]);
        const idx = E.emitExpr(s.index);
        const v = E.emitExpr(s.value);
        // The inline arm's twin of the read site in emit-exprs — same
        // subset, same answer, the call for everything it declines.
        E.line(`scr_bytes_set_inl(${arr.name}, ${idx.name}, ${v.name});${E.srcComment(s.loc)}`);
        break;
      }
      case "fieldSet":
      case "recordSet": {
        // Evaluation order: obj, then value. New value moved in; the old
        // value is released AFTER the field is overwritten (releases are
        // NULL-tolerant — fields start NULL from the zeroed allocation).
        // Unlink-then-release is load-bearing: a release can trigger a
        // cycle collection, which must never see a heap edge whose count
        // was already given up (scr_cycle.c). Classes and records share
        // the struct layout, so one emission.
        const obj = E.emitExpr(s.obj);
        const v = E.emitExpr(s.value);
        // Runtime error classes use ScrError's own member names.
        const member =
          s.kind === "fieldSet" && RUNTIME_ERROR_CLASSES.has(s.className)
            ? s.field
            : mangleField(s.field);
        const field = `${obj.name}->${member}`;
        if (isRefCounted(v.type)) {
          E.moveTemp(v);
          const old = `sc_t${E.tempCounter++}`;
          E.line(`${cDecl(v.type, old)} = ${field};`);
          E.line(`${field} = ${v.name};${E.srcComment(s.loc)}`);
          E.releaseValue(old, v.type);
        } else {
          E.line(`${field} = ${v.name};${E.srcComment(s.loc)}`);
        }
        // A WRITE creates an own property — JS's [[Set]], and the reason a
        // crossing's mask can only ever gain bits. Without this, a member
        // the source object merely inherited and the program then ASSIGNED
        // would keep answering "not my key" to Object.keys. Ignored on
        // instances whose mask was never written (byte 0 is zero), so a
        // record built any other way is unaffected.
        if (s.kind === "recordSet") {
          const shape = E.recordsById.get(s.shapeId);
          const bit = shape ? ownMaskKeyBit(shape, s.field) : null;
          if (bit) {
            E.line(
              `${obj.name}->${OWNMASK_MEMBER}[${bit.byte}] |= ${bit.bit}; /* a write is an own key */`,
            );
          }
        }
        break;
      }
      case "recordKeyDelete": {
        // `delete obj[k]` on a pure index-signature shape: a Map delete on
        // the overflow (key and value released; absent keys no-op).
        const obj = E.emitExpr(s.obj);
        const key = E.emitExpr(s.key);
        E.line(`scr_map_delete_str(${obj.name}->${OVERFLOW_MEMBER}, ${key.name});${E.srcComment(s.loc)}`);
        break;
      }
      case "recordKeySet": {
        // Dynamic-keyed record write through the per-shape helper (declared
        // keys write through with validation, undeclared keys land in the
        // overflow map). Evaluation order: obj, key, value. The helper OWNS
        // the value (+1 moves in). MAY THROW when a dyn value must validate
        // against a declared field's type — the pending check runs then.
        const obj = E.emitExpr(s.obj);
        const key = E.emitExpr(s.key);
        const v = E.emitExpr(s.value);
        if (isRefCounted(v.type)) E.moveTemp(v);
        // A LITERAL key naming no declared field is a plain overflow map
        // insert — no helper, no validation, no throw.
        if (s.overflowOnly) {
          const acc = v.type.kind === "f64" ? "f64" : v.type.kind === "bool" ? "bool" : "ref";
          E.line(
            `scr_map_set_str_${acc}(${obj.name}->${OVERFLOW_MEMBER}, ${key.name}, ${v.name});${E.srcComment(s.loc)}`,
          );
          break;
        }
        const helper = E.recordKeySetHelper(s.shapeId);
        E.line(`${helper}(${obj.name}, ${key.name}, ${v.name});${E.srcComment(s.loc)}`);
        const shape = E.recordsById.get(s.shapeId);
        // MAY THROW: a dyn value validating against a declared field, or a
        // signature-free shape's key MISS (scr_record_key_miss).
        if (shape && (!shape.indexValue || (shape.indexValue.kind === "dyn" && shape.fields.length > 0))) {
          E.emitPendingCheck();
        }
        break;
      }
      case "forOf": {
        // Ascending index loop; the length is re-read every iteration
        // (JS-exact — pushes inside the body extend the iteration). The
        // iterable temp lives in this statement's frame, so it is released
        // when the whole loop ends (and by `return`'s frame sweep). A real
        // C for-loop makes plain `continue` correct: the update still runs.
        if (s.iterable.type.kind !== "array") throw new Error("emitter bug: forOf over non-array");
        const elem = s.iterable.type.elem;
        const arr = E.emitExpr(s.iterable);
        const idx = `sc_t${E.tempCounter++}`;
        E.line(
          `for (double ${idx} = 0; ${idx} < scr_arr_len(${arr.name}); ${idx} += 1) {${E.srcComment(s.loc)}`,
        );
        E.indent++;
        // A real C for-loop makes plain `continue` correct (the update
        // still runs); a LABELED forOf allocates a continue label placed at
        // the END of the iteration (after the per-iteration scope release —
        // the goto path released it itself) so nested loops can goto it.
        const loop = E.loopTarget(null, s.labels);
        E.jumpTargets.push(loop);
        // The loop variable is a fresh const per iteration: its scope opens
        // here, holds the (for ref elements: owned +1) current element, and
        // releases it at the end of each iteration.
        E.scopes.push([]);
        const local = mangleLocal(s.localId);
        const localInfo = E.currentLocals.get(s.localId);
        if (localInfo?.boxed) {
          // Captured loop variable: a fresh box per iteration, matching the
          // fresh const binding (closures made in iteration k keep seeing
          // iteration k's element). The box takes ownership of a ref
          // element's +1 and is released with the iteration's scope.
          E.line(`${local} = ${E.boxNewC(elem)}; /* per-iteration ${localInfo.name} */`);
          E.line(`scr_box_set_${boxAccess(elem)}(${local}, scr_arr_get_${elemAccess(elem)}(${arr.name}, ${idx}));`);
          E.scopes[E.scopes.length - 1]!.push({ name: local, type: elem, boxed: true });
        } else {
          E.line(`${local} = scr_arr_get_${elemAccess(elem)}(${arr.name}, ${idx});`);
          if (isRefCounted(elem)) E.scopes[E.scopes.length - 1]!.push({ name: local, type: elem });
        }
        E.emitStmts(s.body);
        const endedWithJump = E.endsWithJump(s.body);
        const scope = E.scopes.pop()!;
        if (!endedWithJump) E.releaseFrame(scope);
        E.jumpTargets.pop();
        if (loop.usedContinue && loop.continueLabel) E.line(`${loop.continueLabel}:;`);
        E.indent--;
        E.line(`}`);
        if (loop.usedEnd) E.line(`${loop.endLabel}:;`);
        break;
      }
      case "block": {
        if (s.labels === undefined) {
          E.emitBlock(s.body);
          break;
        }
        // A labeled block: `break lbl` inside jumps to the end label
        // (releasing the block's scope itself); nothing else can target it.
        const target = {
          kind: "block" as const,
          endLabel: `sc_end_${E.labelCounter++}`,
          usedEnd: false,
          labels: s.labels,
          scopeDepth: E.scopes.length,
          frameDepth: E.frames.length,
        };
        E.jumpTargets.push(target);
        E.emitBlock(s.body);
        E.jumpTargets.pop();
        if (target.usedEnd) E.line(`${target.endLabel}:;`);
        break;
      }
      case "break": {
        // Unlabeled: binds to the innermost loop OR switch (labeled block
        // targets are skipped). Labeled: binds to the entry carrying the
        // label. Release every scope entered since that target started
        // (the body scope and anything nested); their natural end-of-block
        // releases are on the fall-through path this jump bypasses. Same
        // for pending frame temps of statements the jump exits (a nested
        // switch's discriminant) — but NOT the target's own frame: a
        // loop's releases after the loop and a switch's after its end
        // label are still on this jump's path.
        let target: (typeof E.jumpTargets)[number] | undefined;
        for (let i = E.jumpTargets.length - 1; i >= 0; i--) {
          const t = E.jumpTargets[i]!;
          if (s.label !== undefined ? t.labels?.includes(s.label) : t.kind !== "block") {
            target = t;
            break;
          }
        }
        if (!target) throw new Error("emitter bug: break target not found");
        E.releaseForJump(target.frameDepth, target.scopeDepth);
        if (target.kind !== "loop" || s.label !== undefined) {
          // Switches are emitted as goto chains and blocks aren't C loops
          // at all, so a C `break` cannot target either; and a LABELED
          // break may target an outer loop a C break would never reach.
          // All three jump to the target's end label (labeled loops always
          // allocate one — loopTarget).
          target.usedEnd = true;
          E.line(`goto ${target.endLabel!};${E.srcComment(s.loc)}`);
        } else {
          E.line(`break;${E.srcComment(s.loc)}`);
        }
        break;
      }
      case "continue": {
        // Unlabeled: binds to the innermost LOOP, skipping any switches and
        // labeled blocks in between (their scopes are still released — the
        // jump exits them). Labeled: binds to the loop carrying the label.
        let loop: ((typeof E.jumpTargets)[number] & { kind: "loop" }) | undefined;
        for (let i = E.jumpTargets.length - 1; i >= 0; i--) {
          const t = E.jumpTargets[i]!;
          if (t.kind === "loop" && (s.label === undefined || t.labels?.includes(s.label))) {
            loop = t;
            break;
          }
        }
        if (!loop) throw new Error("emitter bug: continue target not found");
        E.releaseForJump(loop.frameDepth, loop.scopeDepth);
        if (loop.continueLabel) {
          // Labeled loops always allocate one (a labeled continue may
          // target an outer loop a C continue could never reach); for/
          // do-while allocate one for their update/condition point.
          loop.usedContinue = true;
          E.line(`goto ${loop.continueLabel};${E.srcComment(s.loc)}`);
        } else {
          E.line(`continue;${E.srcComment(s.loc)}`);
        }
        break;
      }
      case "return": {
        const fin = E.finallyStack[E.finallyStack.length - 1];
        if (fin) {
          // Crossing ≥1 finally: the value is computed and snapshotted
          // FIRST (a finally mutating the returned local cannot change
          // it — Node's semantics), then everything down to the innermost
          // region releases and control runs that region's pending-return
          // finally copy; its tail dispatches further out or returns.
          if (s.value) {
            const v = E.emitExpr(s.value);
            // A VOID return value (`return await task()` in a void function —
            // the exclusive-runner idiom) evaluates for its effect but has no
            // slot: the sc_pret pending-return cell is declared only for a
            // non-void function (see the fn prologue), so assigning it here
            // would name an undeclared identifier. The bare goto below runs
            // the finally and returns void, exactly Node's order.
            if (s.value.type.kind !== "void") {
              E.moveTemp(v); // ownership parks in the slot until the dispatch returns it
              E.line(`sc_pret = ${v.name};${E.srcComment(s.loc)}`);
            }
          }
          fin.used = true;
          E.releaseForJump(fin.frameDepth, fin.scopeDepth);
          E.line(`goto ${fin.label};${s.value ? "" : E.srcComment(s.loc)}`);
          break;
        }
        if (s.value) {
          const v = E.emitExpr(s.value);
          E.moveTemp(v);
          // Everything down to function depth releases; the moved result is
          // exempt (already struck from its frame).
          E.releaseForJump(0, 0);
          if (E.currentCoro !== null) {
            // A coroutine does not return a value to a caller — there is no
            // caller on the stack after the first resume. It FULFILLS the
            // promise the frame owns, which is what the fiber trampoline
            // does at the end of the body.
            for (const l of coroFinish(E, E.currentReturnType, v.name, E.currentFn?.captures !== undefined)) E.line(l);
          } else {
            E.line(`return ${v.name};${E.srcComment(s.loc)}`);
          }
        } else {
          E.releaseForJump(0, 0);
          if (E.currentCoro !== null) {
            for (const l of coroFinish(E, E.currentReturnType, null, E.currentFn?.captures !== undefined)) E.line(l);
          } else {
            E.line(`return;${E.srcComment(s.loc)}`);
          }
        }
        break;
      }
      case "throw": {
        // Evaluate, move ownership into the runtime's exception cell, then
        // unwind unconditionally (the innermost try handler, or out of the
        // function) — the same release path as return/break/continue.
        const v = E.emitExpr(s.value);
        const t = s.value.type;
        if (isRefCounted(t)) E.moveTemp(v); // the cell takes ownership
        if (t.kind === "f64") {
          E.line(`scr_throw_f64(${v.name});${E.srcComment(s.loc)}`);
        } else if (t.kind === "bool") {
          E.line(`scr_throw_bool(${v.name});${E.srcComment(s.loc)}`);
        } else if (t.kind === "string") {
          E.line(`scr_throw_str(${v.name});${E.srcComment(s.loc)}`);
        } else if (t.kind === "object" && E.classMeta.get(t.className)?.hierarchy) {
          // Hierarchy instances carry a vtable word: the OBJ kind keeps the
          // dynamic class inspectable (catch-binding instanceof, and the
          // uncaught printer's "name: message" for Error instances).
          const rc = vAdapters(t);
          E.line(`scr_throw_obj(${v.name}, &${rc.retain}, &${rc.release}, ${E.traceArgC(t)});${E.srcComment(s.loc)}`);
        } else if (t.kind === "dyn") {
          // A thrown DYN goes through the dyn unit, which unwraps it to the
          // arm it came from -- `throw e` over a caught error that crossed
          // into `unknown` must still answer `instanceof Error` and
          // `String(e)` the way Node does. The unwrap cannot live in
          // scr_exception.c: that unit is linked into every runtime unit
          // test and the dyn unit is not, and naming its symbols from there
          // broke four of those links.
          E.line(`scr_throw_dyn(${v.name});${E.srcComment(s.loc)}`);
        } else {
          const rc = vAdapters(t);
          E.line(`scr_throw_ref(${v.name}, &${rc.retain}, &${rc.release}, ${E.traceArgC(t)});${E.srcComment(s.loc)}`);
        }
        E.emitUnwind();
        break;
      }
      case "runtimeFence": {
        // The deferred JS compile fence: throw a catchable Error naming
        // the construct (message) with the SC code stamped on `code`,
        // then unwind exactly like `throw`.
        const bytes = Buffer.from(s.message, "utf8");
        const errKind = s.errKind === "type" ? "SCR_ERR_TYPE" : "SCR_ERR_ERROR";
        E.line(
          `scr_throw_error_msg_code(${errKind}, ${cStringLiteral(bytes)}, ${bytes.length}, "${s.code}");${E.srcComment(s.loc)}`,
        );
        E.emitUnwind();
        break;
      }
      case "rethrow":
        // Re-raise the saved snapshot (payload retained — the binding local
        // releases with its scope) and unwind like `throw`.
        E.line(`scr_rethrow(${mangleLocal(s.localId)});${E.srcComment(s.loc)}`);
        E.emitUnwind();
        break;
      case "tryCatch":
        E.emitTryCatch(s);
        break;
      default: {
        const _exhaustive: never = s;
        void _exhaustive;
      }
    }
    const frame = E.frames.pop()!;
    // return/throw already released their frames on the jump path; emitting
    // the fall-through releases after them would be dead double-release code.
    if (s.kind !== "return" && s.kind !== "throw" && s.kind !== "rethrow" && s.kind !== "runtimeFence") E.releaseFrame(frame);
  }

/** try/catch/finally via pending-flag unwinding. Entering a try emits NO
   * code: the try context is compile-time state (tryStack) that redirects
   * unwinds inside the region to a label here instead of out of the
   * function. Shape:
   *
   *   { try body }          unwinds inside release frames/scopes down to
   *                         this statement's depths, then goto the handler
   *   goto after;           (normal completion skips the handler)
   *   sc_catch_N:;         (emitted only when some unwind targets it)
   *     scr_exc_clear();   catch TAKES the exception (payload discarded —
   *     { catch body }      the supported catch form is bindingless)
   *   after/sc_fin_N:;
   *   { finally body }      normal path
   *   goto sc_tryend_N;
   *   sc_finexc_N:;        exception path: pending flag still set
   *   { finally body }      (emitted twice — fresh temps/labels each time;
   *   <unwind>               duplication is safe, and the pending flag is
   *   sc_tryend_N:;         the dispatch)
   *
   * Without a catch, unwinds in the try body target sc_finexc_N directly.
   * A catch body's own exceptions target sc_finexc_N (when a finally
   * exists) or the ENCLOSING context — never its own handler. After the
   * exception-path finally, propagation continues (emitUnwind: enclosing
   * handler or dummy return). A `return` inside the try/catch body rides a
   * THIRD finally copy (sc_finret_N — the pending-return path: value
   * snapshotted into sc_pret at the return site, dispatch outward after
   * the copy runs); break/continue never cross a finally and no jump
   * leaves a finally body (frontend fence + validator backstop), so
   * normal, exception, and pending-return are the only paths a finally
   * must model; jumps out of PLAIN try/catch need nothing here —
   * release-on-jump already walks the try scopes. */
  export function emitTryCatch(E: CEmitter, s: IrStmt & { kind: "tryCatch" }): void {
    const id = E.labelCounter++;
    const hasCatch = s.catchBody !== null;
    const hasFinally = s.finallyBody !== null;
    const catchLabel = `sc_catch_${id}`;
    const finExcLabel = `sc_finexc_${id}`;
    const endLabel = `sc_tryend_${id}`;
    // Where the try body's normal completion continues.
    const afterTryLabel = hasFinally ? `sc_fin_${id}` : endLabel;
    let afterTryLabelUsed = false;

    const handler = {
      label: hasCatch ? catchLabel : finExcLabel,
      used: false,
      frameDepth: E.frames.length,
      scopeDepth: E.scopes.length,
    };
    // The pending-return region: returns inside tryBody/catchBody snapshot
    // their value and jump here-ish (the pending-return finally copy below)
    // instead of returning directly. Same depths as the unwind handler.
    const retEntry = hasFinally
      ? {
          label: `sc_finret_${id}`,
          used: false,
          frameDepth: E.frames.length,
          scopeDepth: E.scopes.length,
        }
      : null;
    E.line(`/* try */${E.srcComment(s.loc)}`);
    if (retEntry) E.finallyStack.push(retEntry);
    E.tryStack.push(handler);
    E.emitBlock(s.tryBody);
    E.tryStack.pop();

    // Exceptions raised in the CATCH body unwind to the exception-path
    // finally (pending stays set through it) when one exists.
    const excHandler = {
      label: finExcLabel,
      used: !hasCatch && handler.used,
      frameDepth: E.frames.length,
      scopeDepth: E.scopes.length,
    };

    if (hasCatch && handler.used) {
      if (!E.endsWithJump(s.tryBody)) {
        E.line(`goto ${afterTryLabel};`);
        afterTryLabelUsed = true;
      }
      if (hasFinally) E.tryStack.push(excHandler);
      // Generator bodies: a pending GENRET sentinel (.return(v) injected at
      // a yield) is a RETURN completion, not a throw — catch must not take
      // it. Re-unwind past this handler (finally still runs — the unwind
      // targets the exception-path finally or the enclosing context; the
      // runtime depths here equal the handler's, so no double release).
      const genretPrologue = (): void => {
        if (E.currentGenerator === null) return;
        E.line(`if (scr_exc_genret_pending()) { /* .return(): not catchable */`);
        E.indent++;
        E.emitUnwind();
        E.indent--;
        E.line(`}`);
      };
      if (s.catchLocalId !== null) {
        // catch (e): the exception MOVES into the binding's snapshot box,
        // owned by the catch body's scope (released on every exit — normal
        // fall-through, jumps out, and unwinds from the body).
        const binding = mangleLocal(s.catchLocalId);
        E.line(`${catchLabel}:; /* catch (${E.currentLocals.get(s.catchLocalId)?.name ?? "e"}) — takes the exception */`);
        genretPrologue();
        E.emitBlock(s.catchBody!, (scope) => {
          E.line(`${binding} = scr_exc_take();`);
          scope.push({ name: binding, type: CAUGHT });
        });
      } else {
        E.line(`${catchLabel}:; /* catch — takes the exception */`);
        genretPrologue();
        E.line(`scr_exc_clear();`);
        E.emitBlock(s.catchBody!);
      }
      if (hasFinally) E.tryStack.pop();
      // Normal completion of the catch falls through to afterTryLabel.
    }
    if (retEntry) E.finallyStack.pop();

    if (hasFinally) {
      if (afterTryLabelUsed) E.line(`${afterTryLabel}:;`);
      E.line(`/* finally (normal path) */`);
      E.emitBlock(s.finallyBody!);
      const needEnd = excHandler.used || retEntry!.used;
      if (needEnd) E.line(`goto ${endLabel};`);
      if (excHandler.used) {
        // The pending exception is STASHED across the finally body (a
        // ScrCaught snapshot, re-raised after) so the body runs with a
        // CLEAN cell: its own may-throw calls' pending checks answer for
        // themselves — not for the in-flight exception — and a generator
        // suspending here (a yield inside a finally on the .return()/
        // .throw() unwind) resumes into the REST of the finally, exactly
        // Node. A throw inside the body REPLACES the stash (it unwinds
        // past the release through the synthetic scope entry below —
        // JS's replace semantics); normal completion re-raises the stash
        // and keeps propagating.
        const stash = `sc_fexc_${id}`;
        E.line(`${finExcLabel}:; /* finally (exception path — stashed) */`);
        E.line(`ScrCaught *${stash} = scr_exc_take();`);
        E.scopes.push([{ name: stash, type: CAUGHT }]);
        E.emitBlock(s.finallyBody!);
        E.scopes.pop(); // normal completion keeps the stash for the re-raise
        E.line(`scr_rethrow(${stash});`);
        E.line(`scr_caught_release(${stash});`);
        E.emitUnwind();
      }
      if (retEntry!.used) {
        // Pending-return path: a return in the try/catch body parked its
        // value in sc_pret and jumped here after releasing down to this
        // region. The finally body runs (third copy — fresh temps/labels,
        // like the exception copy), then the dispatch continues outward:
        // the next enclosing finally region of this function, or the
        // actual return. A THROW inside this copy replaces the pending
        // return (JS): the slot's owned value rides a synthetic scope
        // entry so the unwind releases it.
        E.line(`${retEntry!.label}:; /* finally (pending-return path) */`);
        const retT = E.currentReturnType;
        const own = isRefCounted(retT);
        if (own) E.scopes.push([{ name: "sc_pret", type: retT }]);
        E.emitBlock(s.finallyBody!);
        if (own) E.scopes.pop();
        const outer = E.finallyStack[E.finallyStack.length - 1];
        if (outer) {
          outer.used = true;
          E.releaseForJump(outer.frameDepth, outer.scopeDepth);
          E.line(`goto ${outer.label};`);
        } else {
          E.releaseForJump(0, 0);
          E.line(retT.kind === "void" ? `return;` : `return sc_pret;`);
        }
      }
      if (needEnd) E.line(`${endLabel}:;`);
    } else if (afterTryLabelUsed) {
      E.line(`${endLabel}:;`);
    }
  }

/** JS-exact switch as a goto chain — C `switch` cannot express lazily
   * evaluated, arbitrary-expression case tests. Shape:
   *
   *   disc temp
   *   NULL-reset of refcounted case-body locals   (see below)
   *   per test, in source order: eval test; if (== disc) goto case_i;
   *   goto default (or end when there is none)
   *   case_0:; body_0   ─┐ bodies in source order fall through
   *   case_1:; body_1   ─┘ naturally, JS-exact
   *   scope releases (natural fall-off path)
   *   end:;                (break jumps here, after releasing scopes itself)
   *
   * All case bodies share ONE scope (JS: one lexical scope per switch body).
   * Because dispatch can jump PAST a varDecl into a later case, a refcounted
   * local of a skipped body is never written — and inside an enclosing loop
   * it still holds the pointer a previous iteration's scope exit already
   * released. The declarations are therefore NULL-reset up front; the
   * scope-exit releases rely on the runtime's NULL-tolerant release calls. */
  export function emitSwitch(E: CEmitter, s: IrStmt & { kind: "switch" }): void {
    if (s.disc.type.kind !== "f64" && s.disc.type.kind !== "string" && s.disc.type.kind !== "bool") {
      throw new Error(`emitter bug: switch on ${s.disc.type.kind}`);
    }
    const id = E.labelCounter++;
    const endLabel = `sc_swend_${id}`;
    const caseLabel = (i: number) => `sc_swcase_${id}_${i}`;

    // The disc temp lives in the whole statement's frame: for a string
    // discriminant it stays alive across every test and body, released when
    // the switch statement ends (break lands before that release; return
    // sweeps frames itself).
    const disc = E.emitExpr(s.disc);

    // NULL-reset refcounted/boxed locals declared at the top level of case
    // bodies (nested blocks manage their own scopes on normal control flow).
    for (const c of s.cases) {
      for (const stmt of c.body) {
        if (stmt.kind !== "varDecl") continue;
        const local = E.currentLocals.get(stmt.localId)!;
        if (local.boxed || isRefCounted(local.type)) {
          E.line(`${mangleLocal(local.id)} = NULL; /* case-scoped ${local.name} */`);
        }
      }
    }

    // Dispatch: lazy source-order test evaluation (a test after the match
    // never runs). Each test's temps release right after its comparison.
    let defaultIdx = -1;
    s.cases.forEach((c, i) => {
      if (c.test === null) {
        defaultIdx = i;
        return;
      }
      E.frames.push([]);
      const t = E.emitExpr(c.test);
      const cmp =
        c.test.type.kind === "string"
          ? `scr_str_eq(${disc.name}, ${t.name})`
          : `${disc.name} == ${t.name}`;
      const hit = E.newTemp(BOOL, cmp);
      E.releaseFrame(E.frames.pop()!);
      E.line(`if (${hit.name}) goto ${caseLabel(i)};`);
    });
    E.line(`goto ${defaultIdx >= 0 ? caseLabel(defaultIdx) : endLabel};`);

    // Bodies in source order: entering one falls through the rest (JS-exact)
    // until a break jumps to the end label.
    const target = {
      kind: "switch" as const,
      endLabel,
      usedEnd: defaultIdx < 0,
      ...(s.labels !== undefined && { labels: s.labels }),
      scopeDepth: E.scopes.length,
      frameDepth: E.frames.length,
    };
    E.jumpTargets.push(target);
    E.scopes.push([]);
    s.cases.forEach((c, i) => {
      E.line(`${caseLabel(i)}:;`);
      E.indent++;
      E.emitStmts(c.body);
      E.indent--;
    });
    E.jumpTargets.pop();
    const scope = E.scopes.pop()!;
    // Natural fall-off of the last body releases the shared scope here; a
    // jump (break/return/continue/throw) already released it before jumping.
    const lastBody = s.cases[s.cases.length - 1]?.body;
    if (!lastBody || !E.endsWithJump(lastBody)) E.releaseFrame(scope);
    if (target.usedEnd) E.line(`${endLabel}:;`);
  }

/** Emits `if (cond) ` followed by a block on the same line for readability. */
  export function mergeBrace(E: CEmitter, emitBlockFn: () => void): void {
    const head = E.lines.pop()!;
    const before = E.lines.length;
    emitBlockFn();
    E.lines[before] = head + E.lines[before]!.trimStart();
  }

/** Evaluates `expr` in its own statement frame inside an already-open
   * branch and moves the result into the C lvalue `target`: the chosen
   * value's ownership transfers, every other temp the evaluation allocated
   * releases inside the branch. The shared core of the lazily-branched
   * expressions (`logical`, `ternary`); the caller owns the surrounding
   * braces/indentation and registers `target` in ITS frame. */
  export function emitBranchInto(E: CEmitter, target: string, expr: IrExpr): void {
    E.frames.push([]);
    const v = E.emitExpr(expr);
    E.moveTemp(v);
    E.line(`${target} = ${v.name};`);
    E.releaseFrame(E.frames.pop()!);
  }

/** Evaluates a condition; its string temps are released before the branch,
   * which is safe because the result is a scalar bool. */
  export function emitCondition(E: CEmitter, cond: IrExpr): string {
    const t = E.emitExpr(cond);
    const frame = E.currentFrame();
    E.releaseFrame(frame);
    frame.length = 0;
    return t.name;
  }

/** `s += x` (and its spelled-out twin `s = s + x`) over a NON-BOXED string
 * local: the accumulator's OWN reference moves into the concat instead of a
 * second one being retained beside it.
 *
 * WHY. `scr_str_concat` appends in place when `a->rc == 1` -- the whole
 * point of the arm is the append loop, where each iteration's result is the
 * next iteration's left operand. The generic assign path could never reach
 * it. It emits the value first and releases the OLD binding afterwards, so
 * the sequence is `retain(s)` then `concat` then `release(temp)` then
 * `release(s)`: at the call the accumulator is at rc == 2, the variable plus
 * the emitted temp, every iteration. The guard is correct and the copy path
 * is taken, which makes string accumulation O(n^2) in bytes with the O(n)
 * path sitting unreachable one branch away.
 *
 * WHAT CHANGES. Exactly one retain/release PAIR on the same object goes
 * away. The frame entry for the moved temp IS the old-binding release the
 * generic path emitted, at the same point in the same order; the reference
 * count is identical at every instruction except inside the call, where it
 * is 1 instead of 2. On the in-place arm concat answers `a` at rc == 2 (the
 * caller's moved-in reference plus the returned one), the store takes one
 * and the frame release drops the other; on the copy path the moved-in
 * reference is the last one and the frame release frees the old buffer,
 * exactly as before.
 *
 * WHY IT IS SAFE. Three things carry it, and all three are required:
 *
 * 1. NON-BOXED. A captured local is `boxed` and lives in a shared
 *    refcounted box, so a closure could hold it; a non-boxed local is
 *    nameable only from this function's own frame, which is why no call in
 *    the operand can reassign it. Boxed and TDZ locals take the old path.
 *    Module GLOBALS are deliberately excluded too -- any function can write
 *    one, so the reorder below would not be sound over them.
 *
 * 2. THE OPERAND IS EMITTED FIRST. Between the move and the store the
 *    binding holds a reference it no longer owns, and an unwind through
 *    that window would release it twice -- once from the frame, once from
 *    the scope entry that still lists the local. So the window contains
 *    nothing but the concat call, which cannot unwind: `scr_str_size_check`
 *    TRAPS rather than throwing, and the intern probe is pure. Reordering
 *    the LEFT operand after the right is unobservable because reading a
 *    non-boxed local has no side effect and, by (3), its value cannot have
 *    changed.
 *
 * 3. `writesLocal` -- the operand contains no `assignExpr`/`incDec`/nested
 *    `assign` naming this binding. That is the only way a write could be
 *    spelled, given (1). A READ of the accumulator inside the operand is
 *    allowed and stays correct: it retains, so the call sees rc == 2 and
 *    simply takes the copy path (`s = s + s` also fails `a != b`).
 *
 * NOT COVERED, on purpose: module globals (1), boxed/captured accumulators
 * (1), and a LEFT-NESTED chain `s = s + a + b`, whose leftmost leaf is the
 * binding but whose top-level left operand is another `strConcat`. The
 * right-nested spelling `s += a + b` IS covered, and so is the two-piece
 * template literal, which lowers to one strConcat over the binding. */
function emitStrAccum(E: CEmitter, s: Extract<IrStmt, { kind: "assign" }>, local: IrLocal): boolean {
  if (local.boxed || local.tdz) return false;
  // A string-specific rewrite, so a string-specific test: what it rewrites
  // into is scr_str_concat BY NAME, not a type-directed adapter.
  if (local.type.kind !== "string") return false;
  const v = s.value;
  if (v.kind !== "strConcat" || v.type.kind !== "string") return false;
  if (v.left.kind !== "varRef" || v.left.localId !== s.localId) return false;
  if (writesLocal(v.right, s.localId)) return false;
  const target = mangleLocal(s.localId);
  const r = E.emitExpr(v.right);
  E.line(`/* += accumulator: the binding's own reference moves into the concat */`);
  const acc = E.newTemp(local.type, target);
  const res = E.newTemp(v.type, `scr_str_concat(${acc.name}, ${r.name})`);
  E.moveTemp(res);
  E.line(`${target} = ${res.name};${E.srcComment(s.loc)}`);
  return true;
}
