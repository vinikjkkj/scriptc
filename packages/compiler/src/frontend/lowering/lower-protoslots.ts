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
import { ENTRY_NAME, PoisonError, dynUndefinedExpr, type Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import { cjsKeyedForEachOf } from "../program.js";
import { dynCallWithThis } from "./lower-calls.js";
import { BOOL, DYN, type IrExpr, type IrFunction, type IrGlobal, type IrParam, type IrStmt, type IrType, type SrcLoc } from "../../ir/nodes.js";

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

/** Can the slot dispatcher stand in for this method? Not for abstract, async or generator members. */
function slottable(info: ClassInfo, name: string): boolean {
  if (info.builtinError || info.def.runtime === true) return false;
  const typed = info.methods.get(name);
  if (typed !== undefined) return typed.abstract !== true && typed.async !== true;
  const g = info.genericMethods?.get(name);
  if (g === undefined) return false;
  const d = g.decl as ts.FunctionLikeDeclaration;
  if (d.asteriskToken !== undefined) return false;
  const mods = ts.canHaveModifiers(d) ? ts.getModifiers(d) : undefined;
  return !(mods?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false);
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

/** The ternary `slot !== undefined ? slot : original` typed as the method's function type. */
export function slotReadOr(L: Lowerer, g: IrGlobal, fnT: IrType, original: IrExpr, loc: SrcLoc): IrExpr {
  const ref = (): IrExpr => ({ kind: "varRef", localId: g.id, type: DYN, loc });
  return {
    kind: "ternary",
    cond: { kind: "dynTest", test: "undefined", negated: true, value: ref(), type: BOOL, loc },
    then: L.coerceToExpected(ref(), fnT),
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

const ASSIGN_FIRST = ts.SyntaxKind.FirstAssignment;
const ASSIGN_LAST = ts.SyntaxKind.LastAssignment;

/** Why a replacement function cannot be called through the slot exactly, or null. The call goes through the method's ABI (every
 * declared parameter passed, omitted ones as undefined) with the receiver as the ambient `this`, so a replacement that sees the
 * argument count (rest, `arguments`) or writes through `this` (a property write on a dynamic receiver) is refused here, at
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
    const thisTarget = (t: ts.Node): boolean => (ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) && t.expression.kind === ts.SyntaxKind.ThisKeyword;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ASSIGN_FIRST && n.operatorToken.kind <= ASSIGN_LAST && thisTarget(n.left)) why = "the replacement writes a property through `this` (a property write on a dynamic receiver has no lowering yet)";
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && thisTarget(n.operand)) why = "the replacement updates a property through `this` (a property write on a dynamic receiver has no lowering yet)";
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
    const rt = w.raw.returnType;
    const slow: IrStmt[] =
      rt.kind === "void"
        ? [{ kind: "exprStmt", expr: viaSlot, loc }, { kind: "return", value: null, loc }]
        : [{ kind: "return", value: L.coerceToExpected(viaSlot, rt), loc }];
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

