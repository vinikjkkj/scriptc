/* RUN-TIME REPLACEMENT OF A CLASS'S PROTOTYPE METHOD: `C.prototype.m = f` (also `ctor.prototype.m = f` inside a
 * keyed forEach over the class values of a literal, mysql2's packets index).
 *
 * Node semantics: after the write every existing and future instance of C, and of every subclass that does not
 * override m, runs f (with `this` = the instance); `C.prototype.m === f` and `inst.m === f`; a subclass override keeps
 * its own method and its `super.m()` reaches f; a value read BEFORE the write (`const old = C.prototype.m`) stays the
 * original function.
 *
 * Mechanism: ONE mutable slot per (declaring class, method) the program writes, a module global of type dyn (undefined
 * until the first write). The module function `%C.m` (the vtable entry, the direct-call target, the `super.m()` target)
 * is split in two: `%C.m%raw` is the original body and `%C.m` is a small dispatcher, `slot !== undefined ? call the slot
 * with this = receiver : %C.m%raw(...)`. A write stores the new function value in the slot. Reads of `C.prototype.m` /
 * `inst.m` answer `slot !== undefined ? slot : <the original function value>`. A method no write targets keeps its
 * direct calls and its vtable entry byte-for-byte: only (class, method) pairs a statement of the program writes are
 * touched. The slot is consulted at the call, so replacement before and after instance creation behave alike.
 *
 * A function the slot holds is called through the checked-dynamic contract (arguments boxed to dyn, the result checked
 * back to the declared type), exactly as any untyped function value is. */
import * as ts from "../ts7/adapter.js";
import { ENTRY_NAME, PoisonError, dynUndefinedExpr, newFnCtx, nodeThrowExpr, type Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import { cjsKeyedForEachOf } from "../program.js";
import { dynCallWithThis } from "./lower-calls.js";
import { hasProtoTab, protoTabReadChain } from "./lower-prototab.js";
import { BOOL, DYN, F64, STRING, UNDEFINED_T, VOID, canDynCheckTo, typeEquals, type IrExpr, type IrFunction, type IrGlobal, type IrParam, type IrStmt, type IrType, type SrcLoc } from "../../ir/nodes.js";

const locOf = (n: ts.Node): SrcLoc => ({ file: n.getSourceFile().fileName, start: n.getStart(), end: n.getEnd() }) as SrcLoc;

/** `X.prototype.m = rhs` -> { recv: X, name: m, assign }, else null. */
export function protoMethodWriteShape(e: ts.Node): { recv: ts.Expression; name: string } | null {
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const l = e.left;
  if (!ts.isPropertyAccessExpression(l) || !ts.isIdentifier(l.name)) return null;
  let p: ts.Expression = l.expression;
  while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) p = p.expression;
  if (!ts.isPropertyAccessExpression(p) || p.name.text !== "prototype") return null;
  return { recv: p.expression, name: l.name.text };
}

/** The slot of (declaring class, method), or null when no statement of the program writes it. */
export function protoSlotOf(L: Lowerer, declarer: string, method: string): IrGlobal | null {
  return L.protoSlots.get(declarer)?.get(method) ?? null;
}

/** Can the slot dispatcher stand in for this method? Not for abstract or generator members. An async member can: its dispatcher is
 * the same kind of plain wrapper the vtable thunk is (a call of the async body, which the emitter routes through the spawn
 * wrapper, so it answers the promise), and a replacement function's answer adopts into that promise (dispatcherResult). */
export function protoSlotSlottable(info: ClassInfo, name: string): boolean {
  return slottable(info, name);
}

function slottable(info: ClassInfo, name: string): boolean {
  if (info.builtinError || info.def.runtime === true) return false;
  const typed = info.methods.get(name);
  if (typed !== undefined) return typed.abstract !== true;
  const g = info.genericMethods?.get(name);
  if (g === undefined) return false;
  const d = g.decl as ts.FunctionLikeDeclaration;
  if (d.asteriskToken !== undefined) return false;
  return true;
}

/** The type a dispatcher of `raw` answers: the promise an async body's call answers, else its own return type. */
export function dispatcherReturnType(raw: IrFunction): IrType {
  return raw.async === true ? { kind: "promise", inner: raw.returnType } : raw.returnType;
}

/** A replacement function's checked-dynamic answer, as the dispatcher's declared type. An async method's answer is a PROMISE: the
 * value adopts (Promise.resolve: a promise stays itself, anything else resolves a fresh one), then the payload checks. */
export function dispatcherResult(L: Lowerer, via: IrExpr, rt: IrType): IrExpr {
  if (rt.kind === "promise") return L.adoptDynIntoTypedPromise(via, rt) ?? L.coerceToExpected(via, rt);
  return L.coerceToExpected(via, rt);
}

/** The class name a value expression's checker type names (a class value), even before the class's own ClassInfo exists (a class
 * expression registers while its statement lowers), or null. */
export function classNameOfValueNode(L: Lowerer, n: ts.Expression): string | null {
  try {
    const t = L.mapTypeOf(L.typeOf(n));
    return t?.kind === "classval" ? t.className : null;
  } catch {
    return null;
  }
}

/** The class a value-parameter / literal key stands for (a class value's checker type), or null. */
export function classOfValueNode(L: Lowerer, n: ts.Expression): ClassInfo | null {
  const nm = classNameOfValueNode(L, n);
  return nm === null ? null : (L.classes.get(nm) ?? null);
}

/** The class of the receiver `X` of `X.prototype.m`: a keyed-forEach value (set per unrolled key), a class binding, or any
 * other expression the checker types as a class value (`const E = class {...}`). */
export function protoRecvClass(L: Lowerer, recv: ts.Expression): ClassInfo | null {
  if (!ts.isIdentifier(recv)) return null;
  const keyed = L.keyedProtoClass.get(recv);
  if (keyed !== undefined) return keyed;
  const sym = L.resolveValueSymbol(recv);
  const bySym = sym ? L.classBySymbol.get(sym) : undefined;
  if (bySym !== undefined) return bySym;
  const byType = classOfValueNode(L, recv);
  if (byType !== null && byType.evalClass !== undefined && L.protoSlots.has(byType.def.name)) {
    L.unsupported("SC1090", recv, `replacing a prototype method of a class created by an evaluation (each evaluation of the class expression owns its own prototype, and the replacement slot is one per class body)`);
  }
  return byType;
}

/** Registers the slot of (class `cls`, method `name`). `info` is the class's ClassInfo when it already exists (a class expression's
 * does not until its statement lowers: the write lowering re-checks then). */
export function registerProtoSlot(L: Lowerer, cls: string, info: ClassInfo | null, name: string): void {
  register(L, cls, info, name);
}

function register(L: Lowerer, cls: string, info: ClassInfo | null, name: string): void {
  if (info !== null && (!slottable(info, name) || info.evalClass !== undefined || L.protoClassBodies.get(cls)?.has(name) === true)) return;
  let m = L.protoSlots.get(cls);
  if (m === undefined) {
    m = new Map();
    L.protoSlots.set(cls, m);
  }
  if (m.has(name)) return;
  const g: IrGlobal = { id: `%g.%ps.${cls}.${name}`, name: `${info?.def.jsName ?? cls}.prototype.${name}`, type: DYN, mutable: true };
  L.globalsList.push(g);
  m.set(name, g);
}

/** Program-wide pre-scan (before any body lowers): every statement `X.prototype.m = ...` whose X is a class (or the value
 * parameter of a keyed forEach over class values) that itself declares m registers the slot of (X, m). Iterative walk (the
 * 7000-level guard runs after this). */
export function scanProtoSlots(L: Lowerer, files: readonly ts.SourceFile[]): void {
  for (const sf of files) {
    if (sf.isDeclarationFile || !sf.text.includes("prototype")) continue;
    // keyed forEach value parameters of this file (top level): symbol -> its key classes
    const keyed = new Map<ts.Symbol, string[]>();
    for (const stmt of sf.statements) {
      const kf = cjsKeyedForEachOf(stmt, sf);
      if (kf === null) continue;
      const sym = L.resolveValueSymbol(kf.valueParam);
      if (!sym) continue;
      const infos: string[] = [];
      for (const k of kf.keys) {
        const c = classNameOfValueNode(L, k.valueNode);
        if (c !== null) infos.push(c);
      }
      keyed.set(sym, infos);
    }
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      const w = protoMethodWriteShape(n);
      if (w !== null && ts.isIdentifier(w.recv) && !L.lateMethodAssigns.has(n) && !L.protoDataAssigns.has(n)) {
        const sym = L.resolveValueSymbol(w.recv);
        const ks = sym ? keyed.get(sym) : undefined;
        if (ks !== undefined) {
          for (const c of ks) register(L, c, L.classes.get(c) ?? null, w.name);
        } else {
          const bySym = sym ? L.classBySymbol.get(sym) : undefined;
          const cn = bySym?.def.name ?? classNameOfValueNode(L, w.recv);
          if (cn !== null) register(L, cn, bySym ?? L.classes.get(cn) ?? null, w.name);
        }
      }
      n.forEachChild((c) => {
        stack.push(c);
      });
    }
  }
}

/** Can a checked-dynamic function value come back as a function of type `fnT`? The checked cast covers the signatures it has an
 * adapter for; a function whose result is a PROMISE has none, but dynFnAsFunc builds the closure for it. */
export function dynFnReadable(L: Lowerer, fnT: IrType): boolean {
  if (fnT.kind !== "func") return false;
  if (fnT.ret.kind !== "promise") return canDynCheckTo(fnT, (id) => L.shapes.get(id), (id) => L.unions.get(id));
  return fnT.rest !== true && fnT.params.every((p) => p.kind === "dyn" || L.dynConvertible(p));
}

/** A checked-dynamic function value `value`, as a function of type `fnT`. The checked cast when the result is not a promise (the
 * cast only succeeds there for a function boxed at the identical signature, and a promise-returning signature has no adapter at
 * all, so its read can never take that path); for a promise-returning signature a closure over the value: its parameters box into dyn, the value runs with the ambient `this`
 * of the call that reaches the closure (a `.call`/`.bind` sets it, as for every method value), and its answer adopts into
 * the declared promise. */
export function dynFnAsFunc(L: Lowerer, value: IrExpr, fnT: IrType, loc: SrcLoc): IrExpr {
  // The class-boxing discovery (noteDynBoxedClass) builds method thunks with no function being lowered; the hidden local the
  // closure holds needs a context to land in, and nothing of it outlives the discovery's discarded expression.
  if (L.fnStack.length > 0 || fnT.kind !== "func" || fnT.ret.kind !== "promise") return dynFnAsFuncIn(L, value, fnT, loc);
  L.fnStack.push(newFnCtx(true, null, fnT, fnT.ret));
  try {
    return dynFnAsFuncIn(L, value, fnT, loc);
  } finally {
    L.fnStack.pop();
  }
}

function dynFnAsFuncIn(L: Lowerer, value: IrExpr, fnT: IrType, loc: SrcLoc): IrExpr {
  if (fnT.kind !== "func" || fnT.ret.kind !== "promise" || !dynFnReadable(L, fnT)) return L.coerceToExpected(value, fnT);
  const held = L.declareHiddenLocal("%dynfn", DYN);
  held.boxed = true;
  const implName = `%dynfn.${L.liftedFns.length}`;
  const fnCtx = newFnCtx(true, null, fnT, fnT.ret);
  L.fnStack.push(fnCtx);
  try {
    const params: IrParam[] = fnT.params.map((t, k) => ({ localId: `a.${k}`, name: `a${k}`, type: t }));
    const args: IrExpr[] = params.map((p) => {
      const a: IrExpr = { kind: "varRef", localId: p.localId, type: p.type, loc };
      return p.type.kind === "dyn" ? a : L.coerceToExpected(a, DYN);
    });
    const fnRef: IrExpr = { kind: "varRef", localId: held.id, type: DYN, loc };
    const ambient: IrExpr = { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc };
    const call = dynCallWithThis(L, ambient, fnRef, args, "function", loc);
    const answer = L.adoptDynIntoTypedPromise(call, fnT.ret) ?? L.coerceToExpected(call, fnT.ret);
    L.liftedFns.push({
      name: implName,
      params,
      returnType: fnT.ret,
      captures: [{ localId: held.id, name: "fn", type: DYN }],
      locals: [
        { id: held.id, name: "fn", type: DYN, mutable: false, boxed: true },
        ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
        ...fnCtx.locals,
      ],
      body: [{ kind: "return", value: answer, loc }],
      loc,
    });
  } finally {
    L.fnStack.pop();
  }
  return {
    kind: "seqExpr",
    stmts: [{ kind: "varDecl", localId: held.id, init: value, loc }],
    result: { kind: "closure", fnName: implName, captures: [held.id], type: fnT, loc },
    type: fnT,
    loc,
  };
}

/** The ternary `slot !== undefined ? slot : original` typed as the method's function type. */
export function slotReadOr(L: Lowerer, g: IrGlobal, fnT: IrType, original: IrExpr, loc: SrcLoc): IrExpr {
  const ref = (): IrExpr => ({ kind: "varRef", localId: g.id, type: DYN, loc });
  return {
    kind: "ternary",
    cond: { kind: "dynTest", test: "undefined", negated: true, value: ref(), type: BOOL, loc },
    then: dynFnAsFunc(L, ref(), fnT, loc),
    else_: original,
    type: fnT,
    loc,
  };
}

/** The function a replacement names syntactically (a function expression, an arrow, or a const/function declaration), if any. */
function replacementFnOf(L: Lowerer, rhs: ts.Expression): ts.FunctionLikeDeclaration | null {
  let e: ts.Expression = rhs;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  if (ts.isFunctionExpression(e) || ts.isArrowFunction(e)) return e;
  if (!ts.isIdentifier(e)) return null;
  const sym = L.resolveValueSymbol(e);
  const d = sym ? L.checker.valueDeclarationOf(sym) : undefined;
  if (d === undefined) return null;
  if (ts.isFunctionDeclaration(d)) return d;
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
    let init: ts.Expression = d.initializer;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) return init;
  }
  return null;
}


/** Why a replacement function cannot be called through the slot exactly, or null. The call goes through the method's ABI (every
 * declared parameter passed, omitted ones as undefined) with the receiver as the ambient `this`, so a replacement that sees the
 * argument count (rest, `arguments`) is refused here, at
 * compile time, rather than diverging or throwing at run time. */
function replacementWhy(L: Lowerer, rhs: ts.Expression): string | null {
  const fn = replacementFnOf(L, rhs);
  if (fn === null || fn.body === undefined) return null;
  if (fn.parameters.some((p) => p.dotDotDotToken !== undefined)) return "the replacement has a rest parameter (it would see the method's omitted parameters as passed undefined arguments)";
  let why: string | null = null;
  const stack: ts.Node[] = [fn.body];
  while (stack.length > 0 && why === null) {
    const n = stack.pop()!;
    if (n !== fn.body && (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isMethodDeclaration(n))) continue;
    if (ts.isIdentifier(n) && n.text === "arguments" && !L.resolveValueSymbol(n)) why = "the replacement reads `arguments` (the call passes every declared parameter)";
    n.forEachChild((c) => {
      stack.push(c);
    });
  }
  return why;
}

/** The primitive result type of the replacement, when the checker proves one that differs from the method's own: the call sites are
 * typed by the method's result, so such a replacement would meet a checked-dynamic mismatch at run time. */
function resultMismatch(L: Lowerer, rhs: ts.Expression, ret: IrType): string | null {
  try {
    const t = L.typeOf(rhs);
    const sig = L.checker.getCallSignatures(t)[0];
    if (sig === undefined) return null;
    const mapped = L.mapTypeOf(L.checker.getReturnTypeOfSignature(sig));
    const prim = (x: IrType | null): boolean => x !== null && (x.kind === "string" || x.kind === "f64" || x.kind === "bool" || x.kind === "bigint" || x.kind === "void");
    if (prim(mapped) && prim(ret) && mapped!.kind !== ret.kind) return `the replacement returns ${mapped!.kind} where the method returns ${ret.kind}, and the call sites are typed by the method's result`;
  } catch {
    return null;
  }
  return null;
}

/** `X.prototype.m = rhs;` in statement position for a slotted (class, method): store the function value in the slot. */
export function protoSlotWriteStmt(L: Lowerer, expr: ts.Expression): IrStmt | null {
  const w = protoMethodWriteShape(expr);
  if (w === null) return null;
  // A class created by an EVALUATION (a class expression capturing per-call bindings): its class value is the evaluation's static side.
  try {
    const rt = L.mapTypeOf(L.typeOf(w.recv));
    if (rt?.kind === "object" && L.classes.get(rt.className)?.def.evalOf !== undefined) {
      L.unsupported("SC1090", expr, `replacing the prototype method '${w.name}' of a class created by an evaluation (each evaluation of the class expression owns its own prototype; a replacement slot is one per class body, so one evaluation's write would show in every other evaluation)`);
    }
  } catch (e) {
    if (e instanceof PoisonError) throw e;
  }
  const info = protoRecvClass(L, w.recv);
  if (info === null) return null;
  const g = protoSlotOf(L, info.def.name, w.name);
  const e = expr as ts.BinaryExpression;
  // The slot of a class-expression class was registered by name before the class existed: only now is the method known.
  if (g === null || !slottable(info, w.name)) return null;
  const why = replacementWhy(L, e.right);
  if (why !== null) L.unsupported("SC1090", e, `replacing the prototype method '${w.name}' of '${info.def.name}' at run time: ${why}`);
  const ret = L.findMethodOn(info, w.name)?.sig.ret ?? info.genericMethods?.get(w.name)?.instances.values().next().value?.returnType ?? DYN;
  const mism = resultMismatch(L, e.right, ret);
  if (mism !== null) L.unsupported("SC1090", e, `replacing the prototype method '${w.name}' of '${info.def.name}' at run time: ${mism}`);
  const value = L.lowerExprExpecting(e.right, DYN);
  return { kind: "assign", localId: g.id, value, loc: locOf(expr) };
}

const FN_FIELDS = new Set(["loc", "type"]);

/** Splits every function that implements a slotted (class, method) into `%C.m%raw` + the dispatcher `%C.m`, and points the
 * detached-value thunks (`%unbound.*`) at the raw body (they ARE the original function value). Runs after every body is down
 * and before the lifted functions are appended (the dispatcher's own helpers land in L.liftedFns). */
export function applyProtoSlots(L: Lowerer, fnLists: IrFunction[][]): void {
  if (L.protoSlots.size === 0) return;
  // The slots start as the dyn undefined (a zeroed dyn global is a null pointer, not the undefined box): %main stores it first.
  const main = fnLists.flatMap((l) => l).find((f) => f.name === ENTRY_NAME);
  if (main !== undefined) {
    const mloc = main.loc;
    const inits: IrStmt[] = [];
    for (const methods of L.protoSlots.values()) {
      for (const g of methods.values()) {
        inits.push({ kind: "assign", localId: g.id, value: dynUndefinedExpr(mloc), loc: mloc });
      }
    }
    main.body.unshift(...inits);
  }
  const byName = new Map<string, IrFunction>();
  for (const list of fnLists) for (const f of list) byName.set(f.name, f);
  const rawOf = new Map<string, string>();
  const wrappers: { raw: IrFunction; slot: IrGlobal; owner: string; method: string; list: IrFunction[] }[] = [];
  for (const [cls, methods] of L.protoSlots) {
    const info = L.classes.get(cls);
    if (info === undefined) continue;
    for (const [m, g] of methods) {
      const names: string[] = [];
      if (info.methods.has(m)) names.push(`%${cls}.${m}`);
      const gm = info.genericMethods?.get(m);
      if (gm !== undefined) for (const inst of gm.instances.values()) if (inst.detachedThis !== true) names.push(inst.name);
      for (const nm of names) {
        let host: IrFunction[] | undefined;
        for (const list of fnLists) if (list.some((f) => f.name === nm)) host = list;
        const raw = byName.get(nm);
        if (raw === undefined || host === undefined) continue;
        wrappers.push({ raw, slot: g, owner: cls, method: m, list: host });
        rawOf.set(nm, `${nm}%raw`);
      }
    }
  }
  if (wrappers.length === 0) return;
  for (const w of wrappers) {
    try {
    const loc = w.raw.loc;
    const rawName = `${w.raw.name}%raw`;
    const params: IrParam[] = w.raw.params;
    const ref = (p: IrParam): IrExpr => ({ kind: "varRef", localId: p.localId, type: p.type, loc });
    const slotRef: IrExpr = { kind: "varRef", localId: w.slot.id, type: DYN, loc };
    const recv = L.coerceToExpected(ref(params[0]!), DYN);
    const args = params.slice(1).map((p) => L.coerceToExpected(ref(p), DYN));
    const viaSlot = dynCallWithThis(L, recv, slotRef, args, `${w.owner}.prototype.${w.method}`, loc);
    const rt = dispatcherReturnType(w.raw);
    const slow: IrStmt[] =
      rt.kind === "void"
        ? [{ kind: "exprStmt", expr: viaSlot, loc }, { kind: "return", value: null, loc }]
        : [{ kind: "return", value: dispatcherResult(L, viaSlot, rt), loc }];
    const direct: IrExpr = { kind: "call", callee: rawName, args: params.map(ref), type: rt, loc };
    const fast: IrStmt = rt.kind === "void" ? { kind: "exprStmt", expr: direct, loc } : { kind: "return", value: direct, loc };
    const dispatcher: IrFunction = {
      name: w.raw.name,
      ...(w.raw.jsName !== undefined && { jsName: w.raw.jsName }),
      params,
      returnType: rt,
      locals: params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
      body: [
        { kind: "if", cond: { kind: "dynTest", test: "undefined", negated: true, value: slotRef, type: BOOL, loc }, then: slow, else_: null, loc },
        fast,
      ],
      loc,
    };
    w.raw.name = rawName;
    w.list.push(dispatcher);
    } catch (e) {
      // The receiver or a parameter cannot cross into dyn: the diagnostic is recorded, the method keeps its direct body.
      if (!(e instanceof PoisonError)) throw e;
      rawOf.delete(w.raw.name);
    }
  }
  // The original function VALUE (a detached thunk) runs the raw body: a replacement installed later must not re-enter itself.
  const rewrite = (root: unknown): void => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      const o = n as Record<string, unknown>;
      if (o["kind"] === "call" && typeof o["callee"] === "string" && rawOf.has(o["callee"])) o["callee"] = rawOf.get(o["callee"]);
      for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
    }
  };
  for (const list of [...fnLists, L.liftedFns]) {
    for (const f of list) if (f.name.startsWith("%unbound.")) rewrite(f.body);
  }
}

/** `C.prototype.m = function ...` adopted as a LATE method of a class whose chain installs run-time prototype members: the statement is
 * the INSTALL point. Until it runs, JS calls whatever the chain provides (the prototype table's `m`), and a late method compiled as a
 * plain method would run its body at once (reading bindings the program has not initialized yet). The statement sets this flag;
 * applyLateInstalls wraps the method in a dispatcher on it. Null (the empty statement) for every other late method. */
export function lateInstallStmt(L: Lowerer, expr: ts.Expression): IrStmt | null {
  for (const [cls, bodies] of L.protoClassBodies) {
    for (const [method, body] of bodies) {
      let inside = false;
      for (let a: ts.Node | undefined = body.parent; a !== undefined; a = a.parent) {
        if (a === expr) { inside = true; break; }
        if (ts.isStatement(a)) break;
      }
      if (!inside) continue;
      const info = L.classes.get(cls);
      if (info === undefined || info.evalClass !== undefined || info.def.runtime === true || !hasProtoTab(L, info)) return null;
      const key = `${cls}.${method}`;
      let rec = L.lateInstalls.get(key);
      if (rec === undefined) {
        const flag: IrGlobal = { id: `%g.li.${cls}.${method}`, name: `${info.def.jsName ?? cls}.prototype.${method} installed`, type: BOOL, mutable: true };
        L.globalsList.push(flag);
        rec = { flag, info, method };
        L.lateInstalls.set(key, rec);
      }
      return { kind: "assign", localId: rec.flag.id, value: { kind: "boolLit", value: true, type: BOOL, loc: locOf(expr) }, loc: locOf(expr) };
    }
  }
  return null;
}

/** The callee spelling V8 prints in "<callee> is not a function" for a call whose callee is a plain identifier / `this` / property or
 * element chain over names and literals (`p.onlyLate`, `this.x.m`, `a[k]`): the source text up to the argument list, whitespace dropped.
 * Null for any other callee (a call result, a template, an optional chain, ...: V8 renders those as "(intermediate value)...", which
 * this does not reproduce). */
function calleeSpelling(L: Lowerer, loc: SrcLoc): string | null {
  const sf = L.program.getSourceFile(loc.file);
  if (sf === undefined) return null;
  // A parenthesised plain receiver (`(p).m()`) prints as `p.m`.
  const text = sf.text.slice(loc.start, loc.end).replace(/^\(\s*(this|[A-Za-z_$][\w$]*)\s*\)/, "$1");
  let depth = 0;
  let cut = -1;
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]!;
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === "(" && depth === 0) { cut = k; break; }
  }
  if (cut <= 0) return null;
  // V8 renders a string-literal key that is an identifier as a dotted member (`p["m"]()` -> "p.m is not a function").
  const callee = text.slice(0, cut).replace(/\s+/g, "").replace(/\[(["'])([A-Za-z_$][\w$]*)\1\]/g, ".$2");
  return /^(?:this|[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*|\[(?:[A-Za-z_$][\w$]*|\d+)\])*$/.test(callee) ? callee : null;
}

/** Wraps each late method with an install flag in a dispatcher: flag set -> the method's own body (`%C.m%late`); flag clear -> the
 * prototype table's CURRENT `m` applied to the receiver and the call's arguments (Reflect.apply semantics). A call site whose callee
 * spelling is exact (calleeSpelling) calls its own thin stub of the dispatcher that throws Node's `<spelling> is not a function`
 * TypeError when the table has no such member, so the message is the call site's, at no cost on the hit path. Runs with the other
 * post-lowering splits, before the lifted functions are appended. */
export function applyLateInstalls(L: Lowerer, fnLists: IrFunction[][]): void {
  if (L.lateInstalls.size === 0) return;
  const byName = new Map<string, { fn: IrFunction; list: IrFunction[] }>();
  for (const list of fnLists) for (const f of list) byName.set(f.name, { fn: f, list });
  const stubbers = new Map<string, (spelling: string, stubName: string) => IrFunction>();
  for (const { flag, info, method } of L.lateInstalls.values()) {
    const found = byName.get(`%${info.def.name}.${method}`);
    if (found === undefined) continue;
    const raw = found.fn;
    try {
      const loc = raw.loc;
      const rawName = `${raw.name}%late`;
      const dispatchName = raw.name;
      const params: IrParam[] = raw.params;
      const ref = (p: IrParam): IrExpr => ({ kind: "varRef", localId: p.localId, type: p.type, loc });
      const sig = info.methods.get(method);
      const hasRest = sig?.params.some((x) => x.mode === "dynRest") === true;
      const declared = params.length - 1 - (hasRest ? 1 : 0);
      const restParam = hasRest ? params[params.length - 1]! : null;
      const boxed = params.slice(1, 1 + Math.max(0, declared)).map((p) => L.coerceToExpected(ref(p), DYN));
      let list: IrExpr;
      if (restParam !== null && sig?.argsBound === true) {
        // the variadic form that re-binds the declared names off the pack: the pack is the whole list
        list = ref(restParam);
      } else {
        const elems: IrExpr[] = [...boxed];
        const spreads: { at: number; what: string | null }[] = [];
        if (restParam !== null) {
          spreads.push({ at: elems.length, what: null });
          elems.push(ref(restParam));
        }
        list = { kind: "dynArrLit", elems, ...(spreads.length > 0 ? { spreads } : {}), type: DYN, loc };
      }
      const recvDyn = L.coerceToExpected(ref(params[0]!), DYN);
      const rt = dispatcherReturnType(raw);
      const direct: IrExpr = { kind: "call", callee: rawName, args: params.map(ref), type: rt, loc };
      const fast: IrStmt = rt.kind === "void" ? { kind: "exprStmt", expr: direct, loc } : { kind: "return", value: direct, loc };
      const slowOf = (fnv: IrExpr): IrStmt[] => {
        const via: IrExpr = { kind: "libCall", fn: "dyn.reflectApply", args: [fnv, recvDyn, list], type: DYN, loc };
        return rt.kind === "void"
          ? [{ kind: "exprStmt", expr: via, loc }, { kind: "return", value: null, loc }]
          : [{ kind: "return", value: dispatcherResult(L, via, rt), loc }];
      };
      const tableFn = (): IrExpr => protoTabReadChain(L, info, { kind: "strLit", value: method, type: STRING, loc }, null, loc);
      const flagIf: IrStmt = { kind: "if", cond: { kind: "varRef", localId: flag.id, type: BOOL, loc }, then: [fast], else_: null, loc };
      const mk = (name: string, body: IrStmt[], extra: IrFunction["locals"] = []): IrFunction => ({
        name,
        ...(raw.jsName !== undefined && { jsName: raw.jsName }),
        params,
        returnType: rt,
        locals: [...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })), ...extra],
        body,
        loc,
      });
      const dispatcher = mk(dispatchName, [flagIf, ...slowOf(tableFn())]);
      // A call-site stub: same body, but a table with no such member throws the call site's own TypeError.
      stubbers.set(dispatchName, (spelling: string, stubName: string): IrFunction => {
        const tf = { id: "%tf.0", name: "%tf", type: DYN as IrType, mutable: false };
        const tfRef: IrExpr = { kind: "varRef", localId: tf.id, type: DYN, loc };
        return mk(stubName, [
          flagIf,
          { kind: "varDecl", localId: tf.id, init: tableFn(), loc },
          {
            kind: "if",
            cond: { kind: "dynTest", test: "function", negated: true, value: tfRef, type: BOOL, loc },
            then: [{ kind: "exprStmt", expr: nodeThrowExpr(1, "", `${spelling} is not a function`, VOID, loc), loc }],
            else_: null,
            loc,
          },
          ...slowOf(tfRef),
        ], [tf]);
      });
      raw.name = rawName;
      found.list.push(dispatcher);
    } catch (e) {
      // The receiver or a parameter cannot cross into dyn: the diagnostic is recorded and the method keeps its direct body.
      if (!(e instanceof PoisonError)) throw e;
    }
  }
  // Point each call whose callee spelling is exact at its own stub.
  const made = new Map<string, IrFunction>();
  const visit = (root: unknown): void => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      const o = n as Record<string, unknown>;
      if (o["kind"] === "call" && typeof o["callee"] === "string" && stubbers.has(o["callee"]) && o["loc"] !== undefined) {
        const spelling = calleeSpelling(L, o["loc"] as SrcLoc);
        if (spelling !== null) {
          const key = `${o["callee"]}\u0000${spelling}`;
          let stub = made.get(key);
          if (stub === undefined) {
            stub = stubbers.get(o["callee"])!(spelling, `${o["callee"]}%at${made.size}`);
            made.set(key, stub);
            const host = byName.get(o["callee"]);
            (host?.list ?? fnLists[0]!).push(stub);
          }
          o["callee"] = stub.name;
        }
      }
      for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
    }
  };
  for (const list of [...fnLists, L.liftedFns]) for (const f of list) visit(f.body);
}


/**
 * Instance-level method overrides over a LATE method (`Cls.prototype.m = function`, assigned onto one instance elsewhere): the
 * class collected the undefined-armed slot field (shadowLate); the method body is lowered by now, so `%C.m` is wrapped here. The
 * wrapper tests the slot: unset runs the method (renamed `%C.m%impl`), set calls the own function with the declared leading
 * arguments, under the ambient-receiver window when the function reads `this`. Runs BEFORE applyLateInstalls, whose dispatcher
 * then wraps this wrapper like any other body. A class nothing writes over carries no slot and is untouched.
 */
export function applyInstanceOverrides(L: Lowerer, fnLists: IrFunction[][]): void {
  const withSlots = [...L.classes.values()].filter((c) => c.shadowLate !== undefined && c.shadowLate.size > 0);
  if (withSlots.length === 0) return;
  const byName = new Map<string, { fn: IrFunction; list: IrFunction[] }>();
  for (const list of fnLists) for (const f of list) byName.set(f.name, { fn: f, list });
  for (const info of withSlots) {
    for (const name of info.shadowLate!) {
      const found = byName.get(`%${info.def.name}.${name}`);
      if (found === undefined) continue;
      const raw = found.fn;
      const loc = raw.loc;
      const className = info.def.name;
      const params: IrParam[] = raw.params;
      const ref = (p: IrParam): IrExpr => ({ kind: "varRef", localId: p.localId, type: p.type, loc });
      const slotT = info.fields.get(name) as IrType & { kind: "union" };
      const slotFn = (L.unions.get(slotT.unionId)?.arms ?? []).find((a) => a.kind === "func") as (IrType & { kind: "func" }) | undefined;
      if (slotFn === undefined || slotFn.rest === true) {
        L.unsupported("SC1090", info.decl!, `the instance-assigned function over '${name}' reads \`arguments\``);
        continue;
      }
      const sig = info.methods.get(name);
      const hasRest = sig?.params.some((x) => x.mode === "dynRest") === true;
      const declared = params.length - 1 - (hasRest ? 1 : 0);
      const implName = `${raw.name}%impl`;
      const rt = dispatcherReturnType(raw);
      const slotGet = (): IrExpr => ({ kind: "fieldGet", obj: ref(params[0]!), className, field: name, type: slotT, loc });
      const packed = hasRest && sig?.argsBound === true;
      const args: IrExpr[] = slotFn.params.map((pt, i) => {
        // The arguments-bound form carries the WHOLE list in the pack; the declared names re-bind off it in the method's own prologue.
        if (packed) {
          const at: IrExpr = { kind: "libCall", fn: "dyn.arrAt", args: [ref(params[params.length - 1]!), { kind: "numLit", value: i, type: F64, loc }], type: DYN, loc };
          return L.coerceToExpected(at, pt);
        }
        if (i < declared) return L.coerceToExpected(ref(params[1 + i]!), pt);
        if (pt.kind === "dyn") return dynUndefinedExpr(loc);
        L.unsupported("SC1090", info.decl!, `the instance-assigned function over '${name}' declares more parameters than the method`);
        return dynUndefinedExpr(loc);
      });
      const viaImpl: IrExpr = { kind: "call", callee: implName, args: params.map(ref), type: rt, loc };
      const viaSlot: IrExpr = {
        kind: "callValue",
        callee: { kind: "unionNarrow", unionId: slotT.unionId, tag: L.armTag(slotT.unionId, slotFn), value: slotGet(), type: slotFn, loc },
        args,
        type: slotFn.ret,
        loc,
      };
      const finish = (e: IrExpr, ret: IrType): IrStmt[] => {
        if (rt.kind === "void") return [{ kind: "exprStmt", expr: e, loc }, ...(ret === rt ? [] : [])];
        return [{ kind: "return", value: typeEquals(ret, rt) ? e : L.coerceToExpected(e, rt), loc }];
      };
      const locals: IrFunction["locals"] = params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false }));
      let slotBody: IrStmt[] = finish(viaSlot, slotFn.ret);
      if (info.shadowReadsThis?.has(name) === true) {
        L.noteDynBoxedClass(className);
        const recv = { id: "recv.0", name: "recv", type: DYN as IrType, mutable: false };
        locals.push(recv);
        const recvRef: IrExpr = { kind: "varRef", localId: recv.id, type: DYN, loc };
        slotBody = [
          { kind: "varDecl", localId: recv.id, init: { kind: "dynFrom", value: ref(params[0]!), type: DYN, loc }, loc },
          { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.thisPush", args: [recvRef], type: VOID, loc }, loc },
          {
            kind: "tryCatch",
            tryBody: slotBody,
            catchBody: null,
            catchLocalId: null,
            finallyBody: [{ kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.thisPop", args: [], type: VOID, loc }, loc }],
            loc,
          },
        ];
      }
      const isUnset: IrExpr = {
        kind: "unionIsTag",
        unionId: slotT.unionId,
        tag: L.armTag(slotT.unionId, UNDEFINED_T),
        negated: false,
        value: slotGet(),
        type: BOOL,
        loc,
      };
      const implFast: IrStmt[] = rt.kind === "void" ? [{ kind: "exprStmt", expr: viaImpl, loc }] : [{ kind: "return", value: viaImpl, loc }];
      const wrapper: IrFunction = {
        name: raw.name,
        ...(raw.jsName !== undefined && { jsName: raw.jsName }),
        params,
        returnType: rt,
        locals,
        body: [{ kind: "if", cond: isUnset, then: implFast, else_: slotBody, loc }],
        loc,
      };
      raw.name = implName;
      found.list.push(wrapper);
    }
  }
}
