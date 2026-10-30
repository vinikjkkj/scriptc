/** The static element type of an unannotated, empty-initialized TypeScript
 * array binding (`const a = []; a.push("s")`).
 *
 * tsc types such a declaration as an EVOLVING `any[]` (or `never[]` in
 * function bodies): the element type is the join of what the program
 * pushes, and tsc answers it by control flow at each REFERENCE. The
 * declaration itself has no static element type, so the lowering refused
 * it (SC2011 at module scope, where the declared type is `any[]`) or read
 * it as `never` (SC1090 in function bodies, where `never` rides as f64).
 *
 * This module answers the declaration's element type from the program's
 * own evidence, and only when that evidence is closed:
 *   - every WRITE is `a.push(e...)`, `a.unshift(e...)` (no spreads) or
 *     `a[0] = e` (a write past the length would leave holes); each written
 *     value's widened checker type is recorded;
 *   - every other REFERENCE is one whose use cannot write through an
 *     untyped path: a property/element READ, a for-of source, a return, a
 *     console.* argument, or an initializer of another binding. Its flow
 *     type must be an array whose element type is ONE type, identical at
 *     every such reference;
 *   - every written type is that element type (or one of its union arms);
 *   - the element type is not any/unknown/never/null/undefined anywhere.
 * Anything else (an escape to a user function, a compound or delete write,
 * a length write, a splice/fill, an exported binding, a JavaScript file)
 * answers null, so the existing refusal or fallback keeps its exact
 * behaviour. JavaScript files are not touched: their evolving arrays
 * already lower through the checked-dynamic element path.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { type IrType, arrayOf } from "../../ir/nodes.js";
import { isJsSourceFile } from "../program.js";

const WRITE_CALLS = new Set(["push", "unshift"]);
// Methods that write the receiver in place with values the flow type does
// not check against a pushed set: refused on the receiver.
const UNSAFE_METHODS = new Set(["splice", "fill", "copyWithin"]);
const CONSOLE_NAMES = new Set(["log", "info", "warn", "error", "debug", "trace", "table", "dir"]);

const cache = new WeakMap<Lowerer, Map<ts.Symbol, IrType | null>>();

/** The IR array type of a binding's evolved element type, or null. */
export function evolvedEmptyArrayIrOf(L: Lowerer, node: ts.Node): IrType | null {
  if (!ts.isIdentifier(node)) return null;
  const sym = L.checker.getSymbolAtLocation(node);
  if (!sym) return null;
  let memo = cache.get(L);
  if (memo === undefined) {
    memo = new Map();
    cache.set(L, memo);
  }
  const hit = memo.get(sym);
  if (hit !== undefined) return hit;
  const answer = computeEvolvedArrayIr(L, sym);
  memo.set(sym, answer);
  return answer;
}

function isAssignTargetOf(node: ts.Node): boolean {
  const p = node.parent;
  if (p === undefined) return false;
  if (ts.isBinaryExpression(p) && p.left === node && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if (ts.isDeleteExpression(p)) return true;
  if (ts.isForInStatement(p) || ts.isForOfStatement(p)) return p.initializer === node;
  return false;
}

function hasUntypedPart(t: ts.Type, depth: number): boolean {
  if (depth === 0) return true;
  if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return true;
  if (t.isUnionType()) return ts.constituentTypes(t).some((a) => hasUntypedPart(a, depth - 1));
  return false;
}

function deepUntyped(L: Lowerer, t: ts.Type, depth: number): boolean {
  if (hasUntypedPart(t, depth)) return true;
  if (depth === 0) return true;
  if (t.isUnionType()) return ts.constituentTypes(t).some((a) => deepUntyped(L, a, depth - 1));
  if (L.checker.isArrayType(t) || L.checker.isTupleType(t)) {
    return L.checker.getTypeArguments(t as ts.TypeReference).some((a) => deepUntyped(L, a, depth - 1));
  }
  return false;
}

function computeEvolvedArrayIr(L: Lowerer, sym: ts.Symbol): IrType | null {
  // --dynamic builds keep the checked-dynamic handle-element story for
  // evolving arrays (corpus 2510-2513): this is a static-build answer only.
  if (L.dynamic) return null;
  const decl = L.checker.valueDeclarationOf(sym);
  if (decl === undefined || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return null;
  if (decl.type !== undefined || decl.initializer === undefined) return null;
  if (!ts.isArrayLiteralExpression(decl.initializer) || decl.initializer.elements.length !== 0) return null;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || !ts.isVariableStatement(list.parent)) return null;
  if ((list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) return null;
  const stmt = list.parent;
  if (isJsSourceFile(decl.getSourceFile())) return null;
  if (ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true) return null;
  // Only the evolving declaration: tsc's declared type is an array whose
  // element is still `any` or `never` (nothing else reaches this path).
  const declT = L.checker.getTypeAtLocation(decl.name);
  if (!L.checker.isArrayType(declT)) return null;
  const declEl = L.checker.getTypeArguments(declT as ts.TypeReference)[0];
  if (declEl === undefined || (declEl.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) === 0) return null;

  const name = decl.name.text;
  const writes: ts.Expression[] = [];
  const reads: ts.Type[] = [];
  let bad = false;

  const classify = (id: ts.Identifier): void => {
    const p = id.parent;
    // A member of the array written through a destructuring pattern
    // (`[a[0]] = xs`, `[a.length] = xs`, `for ([a[0]] of xs)`) is a write
    // the rules below would miss.
    if ((ts.isElementAccessExpression(p) || ts.isPropertyAccessExpression(p)) && p.expression === id && inDestructuringTarget(p)) {
      bad = true;
      return;
    }
    // push/unshift are only writes as direct calls on the array.
    if (ts.isPropertyAccessExpression(p) && p.expression === id && WRITE_CALLS.has(p.name.text) &&
        !(ts.isCallExpression(p.parent) && p.parent.expression === p)) {
      bad = true;
      return;
    }
    // a.push(e...) / a.unshift(e...)
    if (ts.isPropertyAccessExpression(p) && p.expression === id && WRITE_CALLS.has(p.name.text) && ts.isCallExpression(p.parent) && p.parent.expression === p) {
      for (const arg of p.parent.arguments) {
        if (ts.isSpreadElement(arg)) { bad = true; return; }
        writes.push(arg);
      }
      return;
    }
    // a[i] = e (plain assignment only; compound, update and delete refuse)
    if (ts.isElementAccessExpression(p) && p.expression === id) {
      const gp = p.parent;
      if (isAssignTargetOf(p)) {
        // Only `a[0] = e`: index 0 never leaves a hole (it overwrites or
        // appends), while `a[k] = e` past the length leaves holes that a
        // static array reads as a trap (h01: `a[3] = 7` after one push).
        if (ts.isBinaryExpression(gp) && gp.left === p && gp.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isNumericLiteral(p.argumentExpression) && p.argumentExpression.text === "0") {
          writes.push(gp.right);
          return;
        }
        bad = true;
        return;
      }
      if (ts.isDeleteExpression(gp)) { bad = true; return; }
    }
    // `a.length` reads no element: tsc types its receiver by the declared
    // evolving array (any[]) there, so the flow type says nothing about E.
    if (ts.isPropertyAccessExpression(p) && p.expression === id && p.name.text === "length" && !isAssignTargetOf(p) && !ts.isDeleteExpression(p.parent)) return;
    // Reads only past this point: the reference's flow type is the evidence.
    const readOk =
      (ts.isPropertyAccessExpression(p) && p.expression === id && !UNSAFE_METHODS.has(p.name.text) && !isAssignTargetOf(p)) ||
      (ts.isElementAccessExpression(p) && p.expression === id) ||
      (ts.isForOfStatement(p) && p.expression === id) ||
      ts.isReturnStatement(p) ||
      (ts.isArrowFunction(p) && p.body === id) ||
      (ts.isVariableDeclaration(p) && p.initializer === id && ts.isIdentifier(p.name) && p.type === undefined) ||
      (ts.isCallExpression(p) && p.arguments.includes(id) && isConsoleCall(p));
    if (!readOk) { bad = true; return; }
    const t = L.checker.getTypeAtLocation(id);
    if (!L.checker.isArrayType(t)) { bad = true; return; }
    reads.push(L.checker.getTypeArguments(t as ts.TypeReference)[0]!);
  };

  const visit = (n: ts.Node): void => {
    if (bad) return;
    if (ts.isIdentifier(n) && n !== decl.name && n.text === name && L.checker.getSymbolAtLocation(n) === sym) {
      classify(n);
      if (bad) return;
    }
    ts.forEachChild(n, visit);
  };
  const scope = list.parent.parent;
  ts.forEachChild(scope, visit);
  if (bad) return null;
  if (writes.length === 0) return null;

  let elem: ts.Type | undefined;
  for (const r of reads) {
    if (r === undefined) return null;
    if (elem === undefined) elem = r;
    else if (elem !== r) return null;
  }
  const wTypes = writes.map((w) => L.checker.getBaseTypeOfLiteralType(L.checker.getTypeAtLocation(w)));
  if (elem === undefined) {
    elem = wTypes[0];
    if (elem === undefined || wTypes.some((w) => w !== elem)) return null;
  }
  const arms = elem.isUnionType() ? ts.constituentTypes(elem) : [elem];
  for (const w of wTypes) {
    if (w === undefined || deepUntyped(L, w, 4)) return null;
    if (w !== elem && !arms.some((x) => x === w || sameObjectShape(L, w, x))) return null;
  }
  if (deepUntyped(L, elem, 4)) return null;
  const elemIr = L.mapTypeOf(elem);
  if (elemIr === null) return null;
  return arrayOf(elemIr);
}

/** `node` is (part of) an assignment or loop target pattern. */
function inDestructuringTarget(node: ts.Node): boolean {
  let cur: ts.Node = node;
  for (;;) {
    const p: ts.Node | undefined = cur.parent;
    if (p === undefined) return false;
    if (ts.isArrayLiteralExpression(p) || ts.isSpreadElement(p) || ts.isParenthesizedExpression(p) || ts.isObjectLiteralExpression(p) || ts.isSpreadAssignment(p) || ts.isShorthandPropertyAssignment(p)) { cur = p; continue; }
    if (ts.isPropertyAssignment(p) && p.initializer === cur) { cur = p; continue; }
    // A plain `a[0] = e` is a direct write (handled by the caller), not a pattern.
    if (ts.isBinaryExpression(p) && p.left === cur && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return cur !== node;
    if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === cur) return cur !== node;
    return false;
  }
}

/** Two distinct checker types of one plain object shape: tsc gives the
 * evolving array's element the WIDENED type of the pushed literal, a
 * different type object than the literal's own (same members, mutually
 * assignable). Arrays and tuples never qualify. */
function sameObjectShape(L: Lowerer, a: ts.Type, b: ts.Type): boolean {
  if ((a.flags & ts.TypeFlags.Object) === 0 || (b.flags & ts.TypeFlags.Object) === 0) return false;
  if (L.checker.isArrayType(a) || L.checker.isTupleType(a) || L.checker.isArrayType(b) || L.checker.isTupleType(b)) return false;
  const names = (t: ts.Type): string[] => L.checker.getPropertiesOfType(t).map((p) => p.name).sort();
  const na = names(a);
  const nb = names(b);
  if (na.length !== nb.length || na.some((n, i) => n !== nb[i])) return false;
  return L.checker.isTypeAssignableTo(a, b) && L.checker.isTypeAssignableTo(b, a);
}

function isConsoleCall(call: ts.CallExpression): boolean {
  const c = call.expression;
  return ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "console" && CONSOLE_NAMES.has(c.name.text);
}
