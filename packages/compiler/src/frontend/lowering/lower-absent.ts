/* ABSENT-FLAG BINDINGS.
 *
 * `const v = xs[i]` / `const v = m.get(k)!` whose value may be Node's
 * `undefined` while the checker says `T`. The slot stays a plain `T` (a
 * widened slot costs a union allocation per write: MEASURED 6x on a hot
 * loop), and a SHADOW bool says whether the value exists. Every read of
 * the binding classifies its consumer (classifyLyingRead) and answers
 * exactly:
 *   - peel   (print, template, typeof, ===/!== undefined, ??, ||, ?.):
 *            the `T | undefined` union is BUILT at the read, from the flag;
 *   - member use / call: Node's TypeError naming the property, thrown at the
 *            USE (not at the initializer);
 *   - number arithmetic: NaN;
 *   - anything else: the checked extraction's trap (a typed slot has no
 *            representation for undefined; see the limits of undefslot).
 * Local bindings carry the flag in a hidden local registered under a
 * synthetic symbol (so closure capture threads it like any binding);
 * file-scope bindings carry it in a second global.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { BOOL, F64, IrExpr, IrGlobal, IrStmt, IrType, SrcLoc, STRING, UNDEFINED_T, isUnitType, strandTrap, typeKey, VOID } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import { checkedJsNumber } from "./lower-exprs.js";
import { idxMissKeyHelper } from "./lower-containers.js";

export interface AbsentFlag {
  /** Synthetic symbol the flag local is registered under (locals). */
  sym: ts.Symbol | null;
  /** The flag global (file-scope bindings). */
  global: IrGlobal | null;
}

type Shape =
  | { kind: "elem"; e: ts.ElementAccessExpression }
  | { kind: "bang"; inner: ts.Expression };

const plainKind = (t: IrType): boolean =>
  t.kind === "f64" || t.kind === "string" || t.kind === "bool" || t.kind === "object" || t.kind === "record";

/** Slot kinds the shadow flag can serve: a plain value (peelable into a
 * `T | undefined` union) or a pointer/scalar whose consumers are member uses
 * only (array, closure, bigint, container ...: no union form every consumer
 * lowers, so a peel consumer takes the checked-extraction trap at the USE). */
const flaggableKind = (t: IrType): boolean =>
  plainKind(t) || t.kind === "array" || t.kind === "func" || t.kind === "bigint" || t.kind === "set" || t.kind === "map" || t.kind === "bytes";

/** Kinds whose `T | undefined` union every consumer already lowers. */
const peelableKind = (t: IrType): boolean => plainKind(t) || t.kind === "array" || t.kind === "func";

function strip(x: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(x) || ts.isAsExpression(x) || ts.isSatisfiesExpression(x)) x = x.expression;
  return x;
}

function hasFunctionLike(n: ts.Node): boolean {
  let found = false;
  const visit = (c: ts.Node): void => {
    if (found) return;
    if (ts.isArrowFunction(c) || ts.isFunctionExpression(c) || ts.isClassExpression(c)) { found = true; return; }
    ts.forEachChild(c, visit);
  };
  visit(n);
  return found;
}

/** The syntactic shape of a const binding whose initializer is a lying
 * source, or null. Nothing here lowers anything. */
function shapeOf(L: Lowerer, decl: ts.VariableDeclaration): Shape | null {
  if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) return null;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null;
  const e = strip(decl.initializer);
  if (ts.isNonNullExpression(e)) {
    const inner = strip(e.expression);
    if (!(ts.isCallExpression(inner) || ts.isPropertyAccessExpression(inner) || ts.isIdentifier(inner) || ts.isElementAccessExpression(inner))) return null;
    if (hasFunctionLike(inner)) return null;
    // `xs[i]!` is the element shape, not the union one.
    if (ts.isElementAccessExpression(inner) && L.mapTypeOf(L.typeOf(inner.expression))?.kind === "array") {
      return inner.questionDotToken ? null : { kind: "elem", e: inner };
    }
    return { kind: "bang", inner };
  }
  if (ts.isElementAccessExpression(e) && !e.questionDotToken && L.mapTypeOf(L.typeOf(e.expression))?.kind === "array") {
    if (hasFunctionLike(e)) return null;
    return { kind: "elem", e };
  }
  return null;
}

/** Does any later use of the binding take the value in a way a plain slot
 * answers wrongly when it is absent: a member use / call (Node's TypeError
 * at the use) or arithmetic (NaN)? */
function hasAbsentSensitiveUse(L: Lowerer, decl: ts.VariableDeclaration, type: IrType): boolean {
  if (!ts.isIdentifier(decl.name)) return false;
  const name = decl.name.text;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent)) return false;
  const container = list.parent.parent;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name && n.pos >= decl.end && n !== decl.name) {
      const c = L.classifyLyingRead(n);
      // A plain kind has a widened-slot path for tests; every other kind is
      // served only here, so any use counts (the failure moves to the use).
      if (c === "num" || typeof c === "object" || !plainKind(type)) found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(container);
  return found;
}

/** Candidate test shared by locals and globals (purely syntactic). */
export function absentFlagCandidate(L: Lowerer, decl: ts.VariableDeclaration, type: IrType): Shape | null {
  if (!flaggableKind(type)) return null;
  const s = shapeOf(L, decl);
  if (s === null) return null;
  // The evidence path (a widened slot) serves the kinds it knows.
  if (plainKind(type) && L.bindHasEvidence(decl)) return null;
  if (!hasAbsentSensitiveUse(L, decl, type)) return null;
  return s;
}

function ref(id: string, type: IrType, loc: SrcLoc): IrExpr {
  return { kind: "varRef", localId: id, type, loc };
}

interface Init { pre: IrStmt[]; ok: IrExpr; val: IrExpr; type: IrType }

function lowerInit(L: Lowerer, shape: Shape, loc: SrcLoc): Init | null {
  const pre: IrStmt[] = [];
  const hoist = (e: IrExpr, name: string): IrExpr => {
    if (e.kind === "varRef" || e.kind === "numLit") return e;
    const h = L.declareHiddenLocal(name, e.type);
    pre.push({ kind: "varDecl", localId: h.id, init: e, loc });
    return ref(h.id, e.type, loc);
  };
  if (shape.kind === "elem") {
    const arr0 = L.lowerExpr(shape.e.expression);
    if (arr0.type.kind !== "array") return null;
    const idx0 = checkedJsNumber(L, shape.e.argumentExpression, L.lowerExpr(shape.e.argumentExpression));
    if (idx0 === null) return null;
    const elem = arr0.type.elem;
    if (!flaggableKind(elem)) return null;
    const arr = hoist(arr0, "%absArr") as IrExpr & { type: { kind: "array" } };
    const index = hoist(idx0, "%absIdx");
    const ok: IrExpr = { kind: "arrIntrinsic", method: "hasIndex", receiver: arr, args: [index], type: BOOL, loc };
    return { pre, ok, val: { kind: "arrayGet", arr, index, type: elem, loc }, type: elem };
  }
  const inner0 = L.lowerExpr(shape.inner);
  if (inner0.type.kind !== "union") return null;
  const def = L.unions.get(inner0.type.unionId);
  if (!def) return null;
  const real = def.arms.filter((a) => !isUnitType(a));
  const units = def.arms.filter(isUnitType);
  if (real.length !== 1 || units.length === 0 || !flaggableKind(real[0]!)) return null;
  const T = real[0]!;
  const u = hoist(inner0, "%absU");
  const uid = inner0.type.unionId;
  let ok: IrExpr | null = null;
  for (const unit of units) {
    const tag = L.armTag(uid, unit);
    const t: IrExpr = { kind: "unionIsTag", unionId: uid, tag, negated: true, value: u, type: BOOL, loc };
    ok = ok === null ? t : { kind: "logical", op: "&&", left: ok, right: t, type: BOOL, loc };
  }
  const tagT = L.armTag(uid, T);
  if (tagT < 0 || ok === null) return null;
  return { pre, ok, val: { kind: "unionNarrow", unionId: uid, tag: tagT, value: u, type: T, loc }, type: T };
}

/** Local `const v = <lying source>`: the statements declaring the flag and
 * the plain slot. Null when the shape does not hold (caller lowers the
 * declaration the ordinary way). */
export function lowerAbsentLocal(L: Lowerer, decl: ts.VariableDeclaration): IrStmt[] | null {
  if (!ts.isIdentifier(decl.name)) return null;
  const declType = L.irTypeOf(decl.name);
  const shape = absentFlagCandidate(L, decl, declType);
  if (shape === null) return null;
  const loc = locOf(decl);
  const init = lowerInit(L, shape, loc);
  if (init === null) return null;
  const okLocal = L.declareHiddenLocal(`${decl.name.text}%ok`, BOOL);
  const v = L.declareLocal(decl.name, decl.name.text, init.type, true);
  const bsym = L.checker.getSymbolAtLocation(decl.name);
  if (!bsym) return null;
  const fake = { name: `${decl.name.text}%ok` } as unknown as ts.Symbol;
  const ctx = L.ctx;
  ctx.scopes[ctx.scopes.length - 1]!.set(fake, okLocal);
  L.absentFlags.set(bsym, { sym: fake, global: null });
  return [
    ...init.pre,
    { kind: "varDecl", localId: okLocal.id, init: init.ok, loc },
    { kind: "varDecl", localId: v.id, init: null, loc },
    { kind: "if", cond: ref(okLocal.id, BOOL, loc), then: [{ kind: "assign", localId: v.id, value: init.val, loc }], else_: null, loc },
  ];
}

/** File-scope: register the flag global next to the binding's own. */
export function registerAbsentGlobal(L: Lowerer, decl: ts.VariableDeclaration, g: IrGlobal, symbol: ts.Symbol): IrGlobal | null {
  if (!ts.isIdentifier(decl.name)) return null;
  if (absentFlagCandidate(L, decl, g.type) === null) return null;
  const ok: IrGlobal = { id: `${g.id}.ok`, name: `${g.name}%ok`, type: BOOL, mutable: true };
  L.globalsList.push(ok);
  L.absentFlags.set(symbol, { sym: null, global: ok });
  return ok;
}

/** The first assignment of a flagged file-scope binding. */
export function lowerAbsentGlobal(L: Lowerer, decl: ts.VariableDeclaration, g: IrGlobal, flag: IrGlobal): IrStmt | null {
  const shape = absentFlagCandidate(L, decl, g.type);
  if (shape === null) return null;
  const loc = locOf(decl);
  const init = lowerInit(L, shape, loc);
  if (init === null) return null;
  const okT = L.declareHiddenLocal("%absOk", BOOL);
  return {
    kind: "block",
    body: [
      ...init.pre,
      { kind: "varDecl", localId: okT.id, init: init.ok, loc },
      { kind: "assign", localId: flag.id, value: ref(okT.id, BOOL, loc), loc },
      { kind: "if", cond: ref(okT.id, BOOL, loc), then: [{ kind: "assign", localId: g.id, value: init.val, loc }], else_: null, loc },
    ],
    loc,
  };
}

/** `%absent.guard.<n>(ok: bool): void` — throws the TypeError unless the
 * value exists. Used as a statement before the plain slot read, so the hit
 * path is a bool test (no ternary temp, no extra reference traffic). */
function guardHelper(L: Lowerer, msg: string, loc: SrcLoc): string {
  const key = `absentguard:${msg}`;
  const existing = L.narrowHelpers.get(key);
  if (existing) return existing;
  const name = `%absent.guard.${L.narrowHelpers.size}`;
  L.narrowHelpers.set(key, name);
  L.liftedFns.push({
    name,
    params: [{ localId: "ok.0", name: "ok", type: BOOL }],
    returnType: VOID,
    locals: [{ id: "ok.0", name: "ok", type: BOOL, mutable: false }],
    body: [{ kind: "if", cond: { kind: "unary", op: "!", operand: ref("ok.0", BOOL, loc), type: BOOL, loc }, then: [strandTrap(msg, loc)], else_: null, loc }],
    loc,
  });
  return name;
}

function guarded(L: Lowerer, okE: IrExpr, v: IrExpr, msg: string, loc: SrcLoc): IrExpr {
  return {
    kind: "seqExpr",
    stmts: [{ kind: "exprStmt", expr: { kind: "call", callee: guardHelper(L, msg, loc), args: [okE], type: VOID, loc }, loc }],
    result: v, type: v.type, loc,
  };
}

/** A read of a flagged binding: `v` is the plain slot read. */
export function absentRead(L: Lowerer, bsym: ts.Symbol, v: IrExpr, node: ts.Expression, loc: SrcLoc): IrExpr | null {
  const af = L.absentFlags.get(bsym);
  if (!af) return null;
  let okE: IrExpr;
  if (af.global !== null) okE = ref(af.global.id, BOOL, loc);
  else {
    const fl = L.resolveKey(af.sym!);
    if (fl === null) return null;
    okE = ref(fl.id, BOOL, loc);
  }
  const T = v.type;
  const done = (e: IrExpr): IrExpr => { L.lyingResults.add(e); return e; };
  const ctx = L.classifyLyingRead(node);
  if (ctx === "peel" && peelableKind(T)) {
    const U = L.withUndefinedArm(T);
    if (U.kind !== "union") return null;
    const tag = L.armTag(U.unionId, T);
    const undef = L.unassignedSlotInit(U, loc);
    if (tag < 0 || undef === null) return null;
    return done({
      kind: "ternary", cond: okE,
      then: { kind: "unionWrap", unionId: U.unionId, tag, value: v, type: U, loc },
      else_: undef, type: U, loc,
    });
  }
  if (ctx === "num" && T.kind === "f64") {
    return done({ kind: "ternary", cond: okE, then: v, else_: { kind: "numLit", value: NaN, type: F64, loc }, type: T, loc });
  }
  if (typeof ctx === "object") {
    if (ctx.dynKey !== undefined) {
      const k = L.lowerExpr(ctx.dynKey);
      if (k.type.kind !== "f64" && k.type.kind !== "string") return null;
      const miss: IrExpr = { kind: "call", callee: idxMissKeyHelper(L, T, k.type, ctx.set, loc), args: [k], type: T, loc };
      return done({ kind: "ternary", cond: okE, then: v, else_: miss, type: T, loc });
    }
    const msg = ctx.msg !== undefined
      ? ctx.msg
      : ctx.callText !== undefined
        ? `${ctx.callText} is not a function`
        : ctx.set
          ? `Cannot set properties of undefined (setting '${ctx.prop}')`
          : `Cannot read properties of undefined (reading '${ctx.prop}')`;
    return done(guarded(L, okE, v, msg, loc));
  }
  return done(guarded(L, okE, v, "undefined is not representable in the target union (a value narrowed or asserted past it still held it)", loc));
}

/* `s + t` over operands that may be Node's undefined (a peeled absent read,
 * or a plain operand beside one). The result's TYPE depends on run-time
 * values: undefined + undefined is the number NaN, undefined + "x" is the
 * string "undefinedx", "a" + 5 is "a5", undefined + 5 is NaN. The caller
 * guarantees the consumer turns the result into TEXT (a template span,
 * String(), console.*, or a string `+` whose other side is a string), where
 * the number NaN and the text "NaN" are indistinguishable, so the string-
 * typed result is exact:
 *   - if either operand is a PRESENT string: concat(ToString(l), ToString(r)),
 *     an absent operand reading "undefined";
 *   - otherwise (numbers and absences only): "NaN" when any operand is
 *     absent, else the sum's text. */
export function lowerLyingPlus(L: Lowerer, left: IrExpr, right: IrExpr, node: ts.BinaryExpression, loc: SrcLoc): IrExpr | null {
  const stmts: IrStmt[] = [];
  interface Op { kind: "string" | "f64"; absent: IrExpr | null; val: IrExpr }
  const operand = (e: IrExpr, name: string): Op | null => {
    if (e.type.kind === "union") {
      const def = L.unions.get(e.type.unionId);
      if (!def || !def.arms.some((a) => a.kind === "undefinedT")) return null;
      const real = def.arms.filter((a) => !isUnitType(a));
      if (real.length !== 1 || (real[0]!.kind !== "string" && real[0]!.kind !== "f64")) return null;
      const T = real[0]!;
      const h = L.declareHiddenLocal(name, e.type);
      stmts.push({ kind: "varDecl", localId: h.id, init: e, loc });
      const u = ref(h.id, e.type, loc);
      const uid = e.type.unionId;
      return {
        kind: T.kind as "string" | "f64",
        absent: { kind: "unionIsTag", unionId: uid, tag: L.armTag(uid, UNDEFINED_T), negated: false, value: u, type: BOOL, loc },
        val: { kind: "unionNarrow", unionId: uid, tag: L.armTag(uid, T), value: u, type: T, loc },
      };
    }
    if (e.type.kind !== "string" && e.type.kind !== "f64") return null;
    const h = L.declareHiddenLocal(name, e.type);
    stmts.push({ kind: "varDecl", localId: h.id, init: e, loc });
    return { kind: e.type.kind, absent: null, val: ref(h.id, e.type, loc) };
  };
  if (left.type.kind !== "union" && right.type.kind !== "union") return null;
  const l = operand(left, "%plusL");
  const r = operand(right, "%plusR");
  if (l === null || r === null) return null;
  const str = (v: string): IrExpr => ({ kind: "strLit", value: v, type: STRING, loc });
  const text = (o: Op): IrExpr => {
    const present: IrExpr = o.kind === "string" ? o.val : L.ensureString(o.val, node);
    return o.absent === null ? present : { kind: "ternary", cond: o.absent, then: str("undefined"), else_: present, type: STRING, loc };
  };
  const cat: IrExpr = { kind: "strConcat", left: text(l), right: text(r), type: STRING, loc };
  const and = (a: IrExpr, b: IrExpr): IrExpr => ({ kind: "logical", op: "&&", left: a, right: b, type: BOOL, loc });
  const or = (a: IrExpr | null, b: IrExpr | null): IrExpr | null => (a === null ? b : b === null ? a : { kind: "logical", op: "||", left: a, right: b, type: BOOL, loc });
  const nan = str("NaN");
  let result: IrExpr;
  if (l.kind === "string" && r.kind === "string") {
    // both absent -> NaN; otherwise at least one present string
    if (l.absent !== null && r.absent !== null) result = { kind: "ternary", cond: and(l.absent, r.absent), then: nan, else_: cat, type: STRING, loc };
    else result = cat;
  } else if (l.kind === "string") {
    // "a" + 5 is "a5", undefined + anything numeric is NaN
    result = l.absent !== null ? { kind: "ternary", cond: l.absent, then: nan, else_: cat, type: STRING, loc } : cat;
  } else if (r.kind === "string") {
    result = r.absent !== null ? { kind: "ternary", cond: r.absent, then: nan, else_: cat, type: STRING, loc } : cat;
  } else {
    // two numbers: absent anywhere is NaN, else the sum
    const anyAbs = or(l.absent, r.absent);
    const sum: IrExpr = L.ensureString({ kind: "bin", op: "+", left: l.val, right: r.val, type: F64, loc }, node);
    result = anyAbs === null ? sum : { kind: "ternary", cond: anyAbs, then: nan, else_: sum, type: STRING, loc };
  }
  return { kind: "seqExpr", stmts, result, type: STRING, loc };
}

/* POINTER-BACKED FIELDS THAT CANNOT BE UNION ARMS (`cache!: Map<..>`).
 *
 * A Map/Set has no representation as a union arm, so the `T | undefined`
 * widening every other `x!: T` field takes is impossible. The slot stays the
 * plain pointer: zeroed memory is NULL, and NULL IS "undefined" (an
 * assignment makes it a real pointer). Reads classify their consumer:
 *   - a member use or call (`this.cache.get(k)`): Node's TypeError naming
 *     the property, thrown at the use;
 *   - a comparison with undefined/null, or a truthiness test: answered from
 *     the NULL test directly (a boolean, no map is ever formed);
 *   - anything else: the checked extraction's trap (exact whenever the
 *     field is assigned).
 */
export function nullableFieldRead(L: Lowerer, read: IrExpr & { kind: "fieldGet" }, node: ts.Expression, loc: SrcLoc): IrExpr | null {
  const nullE: IrExpr = { ...read, type: BOOL, nullTest: true };
  const present: IrExpr = { kind: "unary", op: "!", operand: nullE, type: BOOL, loc };
  const strip = (): ts.Node => {
    let p: ts.Node = node;
    while (
      p.parent &&
      (ts.isParenthesizedExpression(p.parent) || ts.isNonNullExpression(p.parent) ||
        ts.isSatisfiesExpression(p.parent) || ts.isAsExpression(p.parent))
    ) p = p.parent;
    return p;
  };
  const p = strip();
  const par = p.parent;
  const isUnit = (e: ts.Expression): boolean => (L.typeOf(e).flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0;
  if (par && (ts.isTypeOfExpression(par) || (ts.isBinaryExpression(par) && par.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && par.left === p))) {
    // `typeof f` and `f ?? d` ask only "is it there": the presence bool,
    // with the raw read kept for the `??` value arm.
    L.presenceResults.add(present);
    L.presenceReads.set(present, read);
    return present;
  }
  if (par && ts.isBinaryExpression(par)) {
    const k = par.operatorToken.kind;
    const other = par.left === p ? par.right : par.left;
    if (
      (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken) && isUnit(other)
    ) {
      L.presenceResults.add(present);
      return present;
    }
  }
  if (par) {
    const cond =
      ((ts.isIfStatement(par) || ts.isWhileStatement(par) || ts.isDoStatement(par)) && par.expression === p) ||
      (ts.isConditionalExpression(par) && par.condition === p) ||
      (ts.isForStatement(par) && par.condition === p) ||
      (ts.isPrefixUnaryExpression(par) && par.operator === ts.SyntaxKind.ExclamationToken);
    if (cond) return present;
  }
  const ctx = L.classifyLyingRead(node);
  let msg = "undefined is not representable in the target union (a value narrowed or asserted past it still held it)";
  if (typeof ctx === "object" && ctx.dynKey === undefined) {
    msg = ctx.msg !== undefined ? ctx.msg : ctx.callText !== undefined
      ? `${ctx.callText} is not a function`
      : ctx.set
        ? `Cannot set properties of undefined (setting '${ctx.prop}')`
        : `Cannot read properties of undefined (reading '${ctx.prop}')`;
  }
  L.lyingResults.add(read);
  return {
    kind: "seqExpr",
    stmts: [{ kind: "exprStmt", expr: { kind: "call", callee: guardHelper(L, msg, loc), args: [present], type: VOID, loc }, loc }],
    result: read, type: read.type, loc,
  };
}

/** `field === undefined` over a presence boolean (see nullableFieldRead):
 * the whole comparison, or null when the shape is not one. */
export function presenceComparison(L: Lowerer, op: ts.SyntaxKind, left: IrExpr, right: IrExpr, loc: SrcLoc): IrExpr | null {
  const lp = L.presenceResults.has(left);
  const rp = L.presenceResults.has(right);
  if (!lp && !rp) return null;
  const pres = lp ? left : right;
  const other = lp ? right : left;
  if (other.kind !== "unitLit") return null;
  const strict = op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  const negated = op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
  // `=== null` is never true of undefined or a map; `== null` / `=== undefined`
  // are the absent test.
  let absentTest: boolean | null;
  if (other.unit === "null" && strict) absentTest = null;
  else absentTest = true;
  let eq: IrExpr;
  if (absentTest === null) eq = { kind: "boolLit", value: false, type: BOOL, loc };
  else eq = { kind: "unary", op: "!", operand: pres, type: BOOL, loc };
  return negated ? { kind: "unary", op: "!", operand: eq, type: BOOL, loc } : eq;
}

/** `this.cache?.get(k)` / `this.cache?.size` over a pointer-backed field:
 * `present ? <the plain member use> : undefined`. The receiver is an
 * identifier or `this` (re-reading it is unobservable). A void-bodied call
 * (`this.cache?.clear()`) has no value form and keeps a named fence. */
export function lowerNullablePointerChain(
  L: Lowerer,
  expr: ts.CallExpression | ts.PropertyAccessExpression | ts.ElementAccessExpression,
  dotNode: ts.Node,
  recvNode: ts.Expression,
  loc: SrcLoc,
): IrExpr | null {
  let r: ts.Expression = recvNode;
  while (ts.isParenthesizedExpression(r)) r = r.expression;
  if (!ts.isPropertyAccessExpression(r) || r.questionDotToken !== undefined) return null;
  const single =
    (dotNode === expr && ts.isPropertyAccessExpression(expr)) ||
    (ts.isCallExpression(expr) && expr.expression === dotNode && ts.isPropertyAccessExpression(dotNode));
  if (!single) return null;
  if (!(ts.isIdentifier(r.expression) || r.expression.kind === ts.SyntaxKind.ThisKeyword)) return null;
  const ft = L.fieldTarget(r);
  if (!ft || ft.container !== "class" || L.classes.get(ft.className)?.nullableFields?.has(ft.field) !== true) return null;
  const read: IrExpr = { kind: "fieldGet", obj: ft.obj, className: ft.className, field: ft.field, type: ft.fieldType, loc };
  const present: IrExpr = { kind: "unary", op: "!", operand: { ...read, type: BOOL, nullTest: true } as IrExpr, type: BOOL, loc };
  L.chainHandled.add(dotNode);
  let body: IrExpr;
  try {
    body = L.lowerExpr(expr);
  } finally {
    L.chainHandled.delete(dotNode);
  }
  if (body.type.kind === "void") {
    L.unsupported(
      "SC1090", expr,
      "'?.' calls returning void over a Map/Set field assigned past the constructor (write 'if (this.f !== undefined) this.f.m()' instead)",
    );
  }
  const declared = L.irTypeOf(expr);
  const hasUndef = declared.kind === "union" && L.armTag(declared.unionId, UNDEFINED_T) >= 0;
  let type: IrType = declared;
  if (!hasUndef) {
    if (body.type.kind === "union") {
      const w = L.withUndefinedArmOf(body.type);
      if (w === null) return null;
      type = w;
    } else type = L.withUndefinedArm(body.type);
  }
  const wrapped = L.coerceToExpected(body, type);
  const undef = L.unassignedSlotInit(type, loc);
  if (undef === null) return null;
  const out: IrExpr = { kind: "ternary", cond: present, then: wrapped, else_: undef, type, loc };
  if (!hasUndef) {
    // The checker typed the chain without its `| undefined` arm (the field
    // is declared non-nullable), so its consumer reads it like a lying slot.
    const lr = L.lyingRead(out, expr as ts.Expression);
    if (lr) return lr;
  }
  return out;
}
