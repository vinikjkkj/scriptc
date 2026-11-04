/* `matches[position]` where `position` is checked-dynamic (`any`) and `matches` is a static
 * array (a regex exec row) or a union of one array arm and unit arms.
 *
 * Why this is not a general dyn keyed read. JS converts the key with ToPropertyKey, so the
 * answer depends on the key's VALUE: an integer reads an element, `length` the length, a match
 * row answers `index`/`input`/`groups`, and every other string names a property INHERITED from
 * Array.prototype / Object.prototype (`toString`, `constructor`, `__proto__`, `push`, ...), whose
 * values are functions and prototype objects this runtime cannot hand out as the same objects
 * (an answer built from a copy would be a silent divergence, a refusal at run time a throw where
 * Node answers). So the read lowers only where the key's value set is PROVEN to contain no
 * string: a table lookup `T[k]` over a table T whose every value is a non-negative integer
 * literal and that nothing ever writes. Such a lookup answers one of
 *   - an integer (an own value of T): the array's element at that index, or undefined past the end
 *     or in a hole (the string-slot hole marker of exact array holes);
 *   - undefined (a name T does not have), or a member Object.prototype hands every object (a
 *     function, or an object): ToPropertyKey of those is "undefined", "function ...",
 *     "[object Object]", none of which names an own property of an array.
 * so the read is exact for EVERY runtime value of the key: a number reads the element, anything
 * else reads undefined. (A match row's capture that did not participate reads undefined too: the
 * row stores "" there, and the runtime keeps a per-row participation mask this read consults.) The assumption not proven is that Object.prototype is never extended with
 * a string value by the program (T[k] would then answer it).
 *
 * The answer is a dyn value (an element or undefined), so it lowers only where its consumer is
 * checker-typed any/unknown (a `var` the retype pin re-served as any, an explicit `: any`, an
 * `as any` / JSDoc `@type {any}` cast): a consumer that takes the checker's element type would
 * extract it with a checked cast that traps on the undefined this read can answer. A null or
 * undefined receiver takes the dyn keyed read, which throws JS's TypeError. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { dynUndefinedExpr } from "./lowerer.js";
import { BOOL, DYN, F64, STRING, type IrExpr, type IrStmt, type IrType, isUnitType } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import { lowerNpmStaticSafeIndexRead } from "./lower-containers.js";

function stripParens(e: ts.Expression): ts.Expression {
  let n = e;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  return n;
}

/** Is this expression (a reference) the TARGET of a write: an assignment (plain, compound, logical,
 * destructuring), ++/--, a for-in/of binding, or a delete? Conservative: unknown parents are reads. */
function isWriteTarget(node: ts.Expression): boolean {
  let n: ts.Node = node;
  for (;;) {
    const p: ts.Node | undefined = n.parent;
    if (p === undefined) return false;
    if (ts.isParenthesizedExpression(p) || ts.isSpreadElement(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isShorthandPropertyAssignment(p)) {
      n = p;
      continue;
    }
    if (ts.isPropertyAssignment(p)) {
      if (p.initializer !== n) return false;
      n = p;
      continue;
    }
    if (ts.isBinaryExpression(p)) {
      return p.left === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    }
    if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) {
      return p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken;
    }
    if (ts.isDeleteExpression(p)) return true;
    if (ts.isForInStatement(p) || ts.isForOfStatement(p)) return p.initializer === n;
    return false;
  }
}

/** Every identifier of `sf` that resolves to `sym` (a walk of the one file: a module-scope or function-scope
 * binding is visible nowhere else unless it is exported, which the callers test separately). */
function refsOf(L: Lowerer, sf: ts.SourceFile, sym: unknown): ts.Identifier[] {
  return refIndexOf(L, sf).get(sym) ?? [];
}

/** The identifiers of one file grouped by the symbol each resolves to, built by ONE walk of the file and kept for the
 * life of the lowering. refsOf used to walk the whole file (a checker call per identifier) for every symbol asked about,
 * so a large file with many element reads cost its size times its read count: on mysql2's driver build that was 77% of
 * the lowering wall time. The answer for a symbol is the same list it always was (its identifiers in the walk's order);
 * no caller depends on the order. */
const refIndexByLowerer = new WeakMap<Lowerer, WeakMap<ts.SourceFile, Map<unknown, ts.Identifier[]>>>();
function refIndexOf(L: Lowerer, sf: ts.SourceFile): Map<unknown, ts.Identifier[]> {
  let perFile = refIndexByLowerer.get(L);
  if (perFile === undefined) {
    perFile = new WeakMap();
    refIndexByLowerer.set(L, perFile);
  }
  const cached = perFile.get(sf);
  if (cached !== undefined) return cached;
  const index = new Map<unknown, ts.Identifier[]>();
  const stack: ts.Node[] = [sf];
  // Iterative: this runs before the depth guard, and a generated file can nest deeply.
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isIdentifier(n)) {
      const s = L.resolveValueSymbol(n);
      const list = index.get(s);
      if (list === undefined) index.set(s, [n]);
      else list.push(n);
    }
    n.forEachChild((c) => {
      stack.push(c);
      return undefined;
    });
  }
  perFile.set(sf, index);
  return index;
}

function singleVarDecl(L: Lowerer, id: ts.Identifier): { sym: unknown; decl: ts.VariableDeclaration } | null {
  const sym = L.resolveValueSymbol(id);
  if (sym === null || sym === undefined) return null;
  const decls = L.checker.declarationsOf(sym as never);
  if (decls.length !== 1) return null;
  const decl = decls[0]!;
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || decl.initializer === undefined) return null;
  // An exported binding is visible (and writable) from other modules.
  const stmt = decl.parent?.parent;
  if (stmt !== undefined && ts.isVariableStatement(stmt) && (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0) return null;
  return { sym, decl };
}

const MAX_INDEX = 2147483647;

/** A table: `var T = { a: 2, b: 4 }` whose values are non-negative integer literals, and whose every
 * reference is a read of one of its members or the argument of Object.keys. */
function isIntTable(L: Lowerer, id: ts.Identifier): boolean {
  const v = singleVarDecl(L, id);
  if (v === null) return false;
  const init = stripParens(v.decl.initializer!);
  if (!ts.isObjectLiteralExpression(init) || init.properties.length === 0) return false;
  for (const p of init.properties) {
    if (!ts.isPropertyAssignment(p)) return false;
    const nm = p.name;
    if (!(ts.isIdentifier(nm) || ts.isStringLiteral(nm) || ts.isNumericLiteral(nm))) return false;
    if (nm.text === "__proto__") return false;
    const val = stripParens(p.initializer);
    if (!ts.isNumericLiteral(val)) return false;
    const n = Number(val.text);
    if (!Number.isInteger(n) || n < 0 || n > MAX_INDEX) return false;
  }
  for (const r of refsOf(L, id.getSourceFile(), v.sym)) {
    if (r === v.decl.name) continue;
    const par = r.parent;
    if (par === undefined) return false;
    if ((ts.isElementAccessExpression(par) || ts.isPropertyAccessExpression(par)) && par.expression === r) {
      if (isWriteTarget(par)) return false;
      continue;
    }
    // Object.keys(T)
    if (ts.isCallExpression(par) && par.arguments.length === 1 && par.arguments[0] === r) {
      const callee = par.expression;
      if (ts.isPropertyAccessExpression(callee) && L.stdlibGlobalMember(callee, "Object") === "keys") continue;
    }
    return false;
  }
  return true;
}

/** The value set of `e` holds only non-negative integers, undefined and members Object.prototype hands out. */
function intDomain(L: Lowerer, e: ts.Expression, depth = 0): boolean {
  if (depth > 4) return false;
  const n = stripParens(e);
  if (ts.isNumericLiteral(n)) {
    const v = Number(n.text);
    return Number.isInteger(v) && v >= 0 && v <= MAX_INDEX;
  }
  if (ts.isElementAccessExpression(n) || ts.isPropertyAccessExpression(n)) {
    if (n.questionDotToken !== undefined) return false;
    const recv = stripParens(n.expression);
    return ts.isIdentifier(recv) && isIntTable(L, recv);
  }
  if (ts.isIdentifier(n)) {
    const v = singleVarDecl(L, n);
    if (v === null) return false;
    for (const r of refsOf(L, n.getSourceFile(), v.sym)) {
      if (r !== v.decl.name && isWriteTarget(r)) return false;
    }
    return intDomain(L, v.decl.initializer!, depth + 1);
  }
  return false;
}

export function lowerProvenKeyArrayRead(L: Lowerer, expr: ts.ElementAccessExpression): IrExpr | null {
  if (expr.questionDotToken !== undefined) return null;
  const keyNode = expr.argumentExpression;
  const kn = stripParens(keyNode);
  if (!ts.isIdentifier(kn) || !intDomain(L, kn)) return null;
  // The consumer must be checker-typed any/unknown (see the header).
  let outerN: ts.Node = expr;
  while (
    outerN.parent &&
    (ts.isParenthesizedExpression(outerN.parent) || ts.isNonNullExpression(outerN.parent) ||
      ts.isSatisfiesExpression(outerN.parent) || ts.isAsExpression(outerN.parent))
  ) outerN = outerN.parent;
  const anyOrUnknown = (t: ts.Type): boolean => (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
  const parentN = outerN.parent;
  const dynConsumer =
    anyOrUnknown(L.typeOf(outerN as ts.Expression)) ||
    (parentN !== undefined && ts.isVariableDeclaration(parentN) && parentN.initializer === outerN &&
      anyOrUnknown(L.typeOf(parentN.name as ts.Expression)));
  if (!dynConsumer) return null;

  const loc = locOf(expr);
  const recv = L.lowerExpr(expr.expression);
  const rawKey = L.lowerExpr(keyNode);
  if (rawKey.type.kind !== "dyn") return null;

  const elemOk = (t: IrType): boolean => t.kind === "array" && (t.elem.kind === "f64" || t.elem.kind === "string" || t.elem.kind === "bool");
  // Decline before any hidden local is declared: a declined read leaves the caller's path untouched.
  if (recv.type.kind === "array") {
    if (!elemOk(recv.type)) return null;
  } else if (recv.type.kind === "union") {
    const def0 = L.unions.get(recv.type.unionId);
    const at = def0 === undefined ? -1 : def0.arms.findIndex((a) => a.kind === "array");
    if (def0 === undefined || at < 0 || !elemOk(def0.arms[at]!) || !def0.arms.every((a, i) => i === at || isUnitType(a))) return null;
  } else {
    return null;
  }
  const kL = L.declareHiddenLocal("%pkey", DYN);
  const kRef = (): IrExpr => ({ kind: "varRef", localId: kL.id, type: DYN, loc });
  // A number reads its index; every other key value reads undefined (NaN is the index that misses).
  const idx: IrExpr = {
    kind: "ternary",
    cond: { kind: "dynTest", test: "number", value: kRef(), type: BOOL, loc },
    then: { kind: "dynCheck", value: kRef(), type: F64, loc },
    else_: { kind: "numLit", value: NaN, type: F64, loc },
    type: F64,
    loc,
  };
  const readOf = (arr: IrExpr & { type: IrType & { kind: "array" } }): IrExpr | null => {
    const safe = lowerNpmStaticSafeIndexRead(L, arr, idx, loc);
    if (safe === null) return null;
    const read = L.coerceToExpected(safe, DYN);
    if (arr.type.elem.kind !== "string") return read;
    // A match row holds "" for a capture group that did not participate (SEMANTICS.md 51), where Node's slot
    // is undefined: the runtime recorded which groups those were against the row, and this read asks.
    return {
      kind: "ternary",
      cond: { kind: "regexIntrinsic", method: "rowAbsent", receiver: arr, args: [idx], type: BOOL, loc },
      then: dynUndefinedExpr(loc),
      else_: read,
      type: DYN,
      loc,
    };
  };
  const keyStmt: IrStmt = { kind: "varDecl", localId: kL.id, init: rawKey, loc };
  if (recv.type.kind === "array") {
    if (!elemOk(recv.type)) return null;
    const rL = L.declareHiddenLocal("%precv", recv.type);
    const rRef = (): IrExpr & { type: IrType & { kind: "array" } } =>
      ({ kind: "varRef", localId: rL.id, type: recv.type, loc }) as IrExpr & { type: IrType & { kind: "array" } };
    const rd = readOf(rRef());
    if (rd === null) return null;
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: rL.id, init: recv, loc }, keyStmt],
      result: rd,
      type: DYN,
      loc,
    };
  }
  if (recv.type.kind === "union") {
    const uId = recv.type.unionId;
    const def = L.unions.get(uId);
    if (!def) return null;
    const arrTag = def.arms.findIndex((a) => a.kind === "array");
    if (arrTag < 0) return null;
    const arm = def.arms[arrTag]!;
    if (!def.arms.every((a, i) => i === arrTag || isUnitType(a))) return null;
    if (!elemOk(arm)) return null;
    const rL = L.declareHiddenLocal("%precv", recv.type);
    const rRef = (): IrExpr => ({ kind: "varRef", localId: rL.id, type: recv.type, loc });
    const arrRef = { kind: "unionNarrow", unionId: uId, tag: arrTag, value: rRef(), type: arm, loc } as IrExpr & { type: IrType & { kind: "array" } };
    const rd = readOf(arrRef);
    if (rd === null) return null;
    // A null/undefined receiver: the dyn keyed read throws Node's TypeError naming the key.
    const unitRead: IrExpr = {
      kind: "dynKeyGet",
      key: { kind: "toString", operand: kRef(), type: STRING, loc },
      value: L.coerceToExpected(rRef(), DYN),
      type: DYN,
      loc,
    };
    return {
      kind: "seqExpr",
      stmts: [{ kind: "varDecl", localId: rL.id, init: recv, loc }, keyStmt],
      result: {
        kind: "ternary",
        cond: { kind: "unionIsTag", unionId: uId, tag: arrTag, negated: false, value: rRef(), type: BOOL, loc },
        then: rd,
        else_: unitRead,
        type: DYN,
        loc,
      },
      type: DYN,
      loc,
    };
  }
  return null;
}
