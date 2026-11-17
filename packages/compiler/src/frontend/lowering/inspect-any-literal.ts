/* A literal that is printed, and whose members are `any`.
 *
 * `console.log({ e })`, `console.log([e, 1])` and `console.log(new Map([["k", e]]))` with `e: any` were refused (SC2001 for the inferred literal type): the static type
 * mapper keeps `any` unmappable inside an inferred object, array or Map type (an `any` member of a LITERAL has no declared annotation to vouch for it, and mapping it
 * everywhere regressed programs that rely on the refusal). Inside a literal that is only handed to a print call the member is simply a checked-dynamic value: the literal
 * is built with the `any` slots as dyn, exactly as the same literal over `unknown` values is, and the print reads them through the dyn renderer.
 *
 * The scope is the literal's position, not the type: only an object, array or `new` expression reached from a print call's argument through other literals qualifies. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

const PRINT_OBJECTS = new Map<string, ReadonlySet<string>>([
  ["console", new Set(["log", "info", "warn", "error", "debug", "dir"])],
  ["util", new Set(["inspect", "format"])],
  ["JSON", new Set(["stringify"])],
]);

/* The ts7 adapter hands out a fresh wrapper per access, so nodes compare by span. */
function same(a: ts.Node, b: ts.Node): boolean {
  return a === b || (a.pos === b.pos && a.end === b.end && a.kind === b.kind);
}

function isPrintCallee(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
  const names = PRINT_OBJECTS.get(callee.expression.text);
  return names !== undefined && names.has(callee.name.text);
}

function isLiteralLike(node: ts.Node): boolean {
  return ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node);
}

/** An initializer slot with no annotation to vouch for its type: `const r = { n }` / `let r = [n]` (the binding's type IS the literal's inferred type, so the any member must be
 * the checked-dynamic slot in the binding as well as in the literal). */
function isUnannotatedInit(p: ts.Node, n: ts.Node): boolean {
  return ts.isVariableDeclaration(p) && p.type === undefined && p.initializer !== undefined && same(p.initializer, n) && ts.isIdentifier(p.name);
}

/** Where a literal sits: the climb through nested literals ends at a print call's argument (`print`), at an unannotated variable's initializer (`init`), or at neither. */
function literalSite(node: ts.Node): "print" | "init" | null {
  if (!isLiteralLike(node)) return null;
  let n: ts.Node = node;
  for (;;) {
    const p: ts.Node | undefined = n.parent;
    if (p === undefined) return null;
    if (ts.isParenthesizedExpression(p) || ts.isSpreadElement(p) || ts.isSpreadAssignment(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p)) { n = p; continue; }
    if (ts.isPropertyAssignment(p) && same(p.initializer, n)) { n = p; continue; }
    if (ts.isShorthandPropertyAssignment(p)) { n = p; continue; }
    if (ts.isNewExpression(p) && p.arguments !== undefined && p.arguments.some((a) => same(a, n))) { n = p; continue; }
    if (ts.isCallExpression(p) && p.arguments.some((a) => same(a, n))) return isPrintCallee(p.expression) || isJsonStringify(p.expression) || isEnumerationCall(p) ? "print" : null;
    if (isUnannotatedInit(p, n)) return "init";
    // A literal consumed in place as a method receiver: [...list].reverse(), [n, o].map(...)
    if (ts.isPropertyAccessExpression(p) && same(p.expression, n)) return "print";
    return null;
  }
}

/** True when `node` is an object/array literal or a `new` expression that sits, through nested literals only, in an argument of console.log/info/warn/error/debug/dir,
 * util.inspect/format or JSON.stringify, or is the initializer of an unannotated variable. */
export function isPrintedLiteral(node: ts.Node): boolean {
  return literalSite(node) !== null;
}

/** True when the literal is (through nested literals) an argument of a print call: a value consumed only as a dyn argument, which is where a dyn-flavored container may stand in for a static one. */
export function isPrintArgLiteral(node: ts.Node): boolean {
  return literalSite(node) === "print";
}

/** `Object.values(r)` / `Object.entries(r)` — the enumeration calls whose result element type is the join of a record's field types, `any` when a member is. */
function isJsonStringify(callee: ts.Expression): boolean {
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "JSON" && callee.name.text === "stringify";
}

function isEnumerationCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !ts.isIdentifier(node.expression.expression)) return false;
  return node.expression.expression.text === "Object" && (node.expression.name.text === "values" || node.expression.name.text === "entries");
}

/** True when `node` is an Object.values/entries call that is directly a print argument or the initializer of an unannotated variable. */
export function isAnyResultCall(node: ts.Node): boolean {
  if (!isEnumerationCall(node)) return false;
  let n: ts.Node = node;
  while (n.parent !== undefined && ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  if (p === undefined) return false;
  if (isUnannotatedInit(p, n)) return true;
  // The result consumed in place: a method receiver (Object.values(r).map(...)), a for-of iterable, an element read.
  if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && same(p.expression, n)) return true;
  if (ts.isForOfStatement(p) && same(p.expression, n)) return true;
  return ts.isCallExpression(p) && p.arguments.some((a) => same(a, n)) && (isPrintCallee(p.expression) || isJsonStringify(p.expression));
}

/** True when `node` names (declaration or reference) an unannotated variable whose initializer is a literal, or an Object.values/entries call: its type is the initializer's own inferred type. */
export function isAnyLiteralBinding(checker: Pick<Lowerer["checker"], "getSymbolAtLocation" | "valueDeclarationOf">, node: ts.Node): boolean {
  if (!ts.isIdentifier(node)) return false;
  const sym = checker.getSymbolAtLocation(node);
  const decl = sym === undefined ? undefined : checker.valueDeclarationOf(sym);
  if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.type !== undefined || decl.initializer === undefined) return false;
  let init: ts.Node = decl.initializer;
  while (ts.isParenthesizedExpression(init)) init = init.expression;
  return isLiteralLike(init) || isEnumerationCall(init);
}

/** True when `node` is a literal on the right of `=` whose left side is an identifier bound to an any-literal variable (`let r = { n }; r = { n: 7 }`): the new value must have the variable's slot types. */
export function isAnyLiteralAssignRhs(checker: Pick<Lowerer["checker"], "getSymbolAtLocation" | "valueDeclarationOf">, node: ts.Node): boolean {
  if (!isLiteralLike(node)) return false;
  let n: ts.Node = node;
  while (n.parent !== undefined && ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  return p !== undefined && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && same(p.right, n) && isAnyLiteralBinding(checker, p.left);
}
