/* A literal that is printed, and whose members are `any`.
 *
 * `console.log({ e })`, `console.log([e, 1])` and `console.log(new Map([["k", e]]))` with `e: any` were refused (SC2001 for the inferred literal type): the static type
 * mapper keeps `any` unmappable inside an inferred object, array or Map type (an `any` member of a LITERAL has no declared annotation to vouch for it, and mapping it
 * everywhere regressed programs that rely on the refusal). Inside a literal that is only handed to a print call the member is simply a checked-dynamic value: the literal
 * is built with the `any` slots as dyn, exactly as the same literal over `unknown` values is, and the print reads them through the dyn renderer.
 *
 * The scope is the literal's position, not the type: only an object, array or `new` expression reached from a print call's argument through other literals qualifies. */
import * as ts from "../ts7/adapter.js";

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

/** True when `node` is an object/array literal or a `new` expression that sits, through nested literals only, in an argument of console.log/info/warn/error/debug/dir or util.inspect/format. */
export function isPrintedLiteral(node: ts.Node): boolean {
  if (!(ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node) || ts.isNewExpression(node))) return false;
  let n: ts.Node = node;
  for (;;) {
    const p: ts.Node | undefined = n.parent;
    if (p === undefined) return false;
    if (ts.isParenthesizedExpression(p) || ts.isSpreadElement(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p)) { n = p; continue; }
    if (ts.isPropertyAssignment(p) && same(p.initializer, n)) { n = p; continue; }
    if (ts.isShorthandPropertyAssignment(p)) { n = p; continue; }
    if (ts.isNewExpression(p) && p.arguments !== undefined && p.arguments.some((a) => same(a, n))) { n = p; continue; }
    if (ts.isCallExpression(p) && p.arguments.some((a) => same(a, n))) return isPrintCallee(p.expression);
    return false;
  }
}
