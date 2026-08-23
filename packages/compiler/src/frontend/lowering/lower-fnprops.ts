/* `f.name` and `f.length` on an ordinary USER function value.
 *
 * Every JS function object carries these two own properties, and this
 * compiler refused BOTH of them for EVERY function in the language:
 * `function g(n: number) {}; g.name` answered SC2020, and so did
 * `g.length`, an arrow's, a class method's and a bound function's. That
 * is a whole family of ordinary JavaScript declined at the door.
 *
 * WHY A STATIC FOLD RATHER THAN A RUNTIME READ. A compiled function value
 * is a `ScrClosure` -- a code pointer plus captures -- and it carries no
 * arity and no name. There IS a runtime name table (scr_closure.c,
 * `scr_fn_name_of`, the one `[Function: g]` resolves through), but it is
 * keyed by the ENTRY POINT and is therefore per-BODY, while JS's `.name`
 * is per-VALUE: `f.bind(a)` and `f.bind(b)` are two function objects over
 * one body, and a bound function's name is the target's with a prefix, so
 * a per-body table cannot spell it. It also has no arity column at all.
 * So the honest mechanism is the one JS's own naming rules are written in
 * terms of: the value's CREATION SITE.
 *
 * That is exactly the walk `jsFuncValueSourceOf` / `jsFuncValueNameOf`
 * already perform for the inspect path (lowerer.ts). This file reuses
 * their shape and their refusals, with ONE difference that is the whole
 * point of the file: the inspect walk FALLS BACK to the reference-site
 * spelling when it cannot prove a creation site, because a wrong name in
 * `[Function: x]` is cosmetic. Here it is the program's answer, so an
 * unprovable creation site KEEPS ITS SC2020. A refusal replaced by a
 * wrong answer is worse than the refusal.
 *
 * WHAT IS PROVABLE, and it is a wider set than it looks:
 *
 *   - a function DECLARATION -- its own name;
 *   - a `const` (or a `let`/`var` never written again) holding a function
 *     expression or an arrow: a NAMED function expression keeps its own
 *     name (`const f = function inner(){}` is `"inner"`), an anonymous
 *     one takes the binding's by JS's NamedEvaluation (`const f = () =>
 *     {}` is `"f"`);
 *   - the same binding holding another such binding -- followed through,
 *     so `const h = g` is `"g"` and not `"h"`;
 *   - a class method or an object-literal method/property;
 *   - `X.bind(...)` -- `"bound "` plus the target's name, stacking on a
 *     rebind, and `length` reduced by the bound argument count, floored
 *     at zero.
 *
 * WHAT IS NOT, and each keeps its SC2020:
 *
 *   - a PARAMETER (`function take(f) { return f.name }`) -- the value
 *     comes from the caller; nothing at this site knows it. This is the
 *     case that decides the file's honesty: a static answer here would
 *     have printed `"f"` where Node prints the caller's `"g"`.
 *   - a reassigned binding, an element read, a call result, a receiver
 *     that could do something when evaluated.
 *
 * `length` COUNTS THE ERASED PARAMETER LIST, not the TypeScript type.
 * `function g(n: number, m?: number)` has length 2 -- the `?` erases to a
 * plain parameter -- while `m = 2` has length 1 and a rest parameter
 * stops the count. Reading the count off the MAPPED func type answers 1
 * for the first of those, which is why the walk returns the DECLARATION
 * and not a type.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { F64, type IrExpr, type SrcLoc, STRING } from "../../ir/nodes.js";
import { bindingNeverReassigned } from "./lower-calls.js";

/** A proven creation site: the function-like node the value was made at,
 * or a `bind` chain over one. */
type Creation =
  | { kind: "node"; node: ts.SignatureDeclaration; name: string | null }
  | { kind: "bound"; target: Creation; boundArgs: number };

/** `.bind(...)` with no spread, so the bound-argument count is known. */
function bindCallOf(n: ts.Node): ts.CallExpression | null {
  if (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "bind" &&
    n.expression.questionDotToken === undefined &&
    !n.arguments.some((a) => ts.isSpreadElement(a))
  ) {
    return n;
  }
  return null;
}

/** Pure enough to fold away: evaluating it twice, or not at all, is
 * unobservable. The fold emits a literal and never lowers the receiver,
 * so a receiver that could DO something must decline. */
function isEffectFree(n: ts.Expression): boolean {
  let e: ts.Expression = n;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isStringLiteral(e) || ts.isNumericLiteral(e)) return true;
  if (
    e.kind === ts.SyntaxKind.NullKeyword ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return true;
  }
  if (ts.isFunctionExpression(e) || ts.isArrowFunction(e)) return true;
  if (ts.isPropertyAccessExpression(e)) return isEffectFree(e.expression);
  const bind = bindCallOf(e);
  if (bind) {
    return (
      isEffectFree((bind.expression as ts.PropertyAccessExpression).expression) &&
      bind.arguments.every((a) => isEffectFree(a))
    );
  }
  return false;
}

function ownNameOfFunctionNode(d: ts.SignatureDeclaration): string | null {
  const nm = (d as { name?: ts.Node }).name;
  return nm !== undefined && ts.isIdentifier(nm) ? nm.text : null;
}

/** The value's creation site, or null when nothing here can prove one.
 * `seen` breaks `var a = b, b = a` cycles, like the two walks in
 * lowerer.ts this one is modelled on. */
function creationOf(L: Lowerer, node: ts.Node, seen: Set<ts.Symbol>): Creation | null {
  let n: ts.Node = node;
  while (ts.isParenthesizedExpression(n)) n = n.expression;

  const bind = bindCallOf(n);
  if (bind) {
    const target = creationOf(L, (bind.expression as ts.PropertyAccessExpression).expression, seen);
    if (target === null) return null;
    // `f.bind()` with NO arguments is still a bound function in JS
    // (`this` becomes undefined); it binds zero arguments.
    return { kind: "bound", target, boundArgs: Math.max(0, bind.arguments.length - 1) };
  }

  if (ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
    return { kind: "node", node: n, name: ownNameOfFunctionNode(n) };
  }

  if (ts.isIdentifier(n)) {
    const sym = L.resolveValueSymbol(n);
    if (sym === null || sym === undefined || seen.has(sym)) return null;
    seen.add(sym);
    const decls = L.checker.declarationsOf(sym);
    // Two declarations means two possible values behind one name (a
    // redeclared `var`, an overload/implementation pair, a user
    // declaration MERGED with an ambient one): nothing here can say which
    // one a use sees.
    if (decls.length !== 1) return null;
    const d = decls[0];
    if (d === undefined) return null;
    if (ts.isFunctionDeclaration(d)) {
      return { kind: "node", node: d, name: d.name !== undefined ? d.name.text : null };
    }
    if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || d.initializer === undefined) return null;
    const isConst = (ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) !== 0;
    if (!isConst && !bindingNeverReassigned(L, sym, d)) return null;
    const inner = creationOf(L, d.initializer, seen);
    if (inner === null) return null;
    // NamedEvaluation: an ANONYMOUS function literal bound straight to a
    // name takes that name. A named one keeps its own, and a value that
    // merely FLOWED here (`const h = g`) keeps g's -- which is why the
    // rename applies only when the initializer IS the literal.
    if (
      inner.kind === "node" &&
      inner.name === null &&
      (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
    ) {
      return { kind: "node", node: inner.node, name: d.name.text };
    }
    return inner;
  }

  // `o.m` / a class method reference -- the property symbol names exactly
  // one declaration when it has one.
  if (ts.isPropertyAccessExpression(n) && n.questionDotToken === undefined) {
    const psym = L.checker.getSymbolAtLocation(n.name);
    if (psym === undefined || seen.has(psym)) return null;
    seen.add(psym);
    const decls = L.checker.declarationsOf(psym);
    if (decls.length !== 1) return null;
    const d = decls[0];
    if (d === undefined) return null;
    if (ts.isMethodDeclaration(d)) return { kind: "node", node: d, name: n.name.text };
    const init = ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d) ? d.initializer : undefined;
    if (init === undefined) return null;
    const inner = creationOf(L, init, seen);
    if (inner === null) return null;
    if (
      inner.kind === "node" &&
      inner.name === null &&
      (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
    ) {
      return { kind: "node", node: inner.node, name: n.name.text };
    }
    return inner;
  }

  return null;
}

/** JS's `Function.prototype.name` for a proven creation site. An
 * anonymous literal that took no binding name is `""` -- a real answer,
 * not a missing one, and `"bound "` WITH the trailing space is Node's
 * answer for a bound anonymous function. */
function nameOf(c: Creation): string {
  return c.kind === "bound" ? `bound ${nameOf(c.target)}` : (c.name ?? "");
}

/** JS's `Function.prototype.length`: parameters before the first one with
 * a default or a rest, over the ERASED list (a TypeScript `?` is not a
 * default). A `this` parameter is type space and is not a parameter at
 * runtime. */
function lengthOf(c: Creation): number {
  if (c.kind === "bound") return Math.max(0, lengthOf(c.target) - c.boundArgs);
  let n = 0;
  for (const p of c.node.parameters) {
    if (p.dotDotDotToken === undefined && ts.isIdentifier(p.name) && p.name.text === "this") continue;
    if (p.dotDotDotToken !== undefined || p.initializer !== undefined) break;
    n++;
  }
  return n;
}

/** `f.name` / `f.length` on a receiver whose value is a compiled
 * function. Answers null for every other receiver, for a member this
 * family does not cover, and -- deliberately -- for a function value
 * whose creation site is not provable, which keeps its SC2020. */
export function funcObjectPropOf(L: Lowerer, expr: ts.PropertyAccessExpression, loc: SrcLoc): IrExpr | null {
  const member = expr.name.text;
  if (member !== "name" && member !== "length") return null;
  if (expr.questionDotToken !== undefined) return null;
  const recv = expr.expression;
  if (L.mapTypeOf(L.typeOf(recv))?.kind !== "func") return null;
  if (!isEffectFree(recv)) return null;
  const c = creationOf(L, recv, new Set<ts.Symbol>());
  if (c === null) return null;
  return member === "name"
    ? { kind: "strLit", value: nameOf(c), type: STRING, loc }
    : { kind: "numLit", value: lengthOf(c), type: F64, loc };
}
