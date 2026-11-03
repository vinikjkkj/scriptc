/* Class expressions evaluated INSIDE a function: the syntax-only half of the
 * per-evaluation class story (lowering/lower-evalclass.ts holds the rest).
 *
 * Every evaluation of such an expression mints a DISTINCT class in JS (fresh
 * identity, its own captured environment). The compiler lowers the class body
 * once (one IR class, one struct layout) and represents each EVALUATION as an
 * ordinary heap object of a synthetic "static side" class that carries the
 * captured bindings; instances point at the evaluation that made them. This
 * module only answers whether an expression has a shape that story covers, so
 * the type mapper (which has no Lowerer) and the lowerer agree. */
import * as ts from "./ts7/adapter.js";

/** True when `decl` sits under a function-like body (or a class static block),
 * i.e. each evaluation of the expression mints its own class. */
export function classExprInsideFunction(decl: ts.ClassLikeDeclaration): boolean {
  if (!ts.isClassExpression(decl)) return false;
  for (let p: ts.Node = decl.parent; !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p)) return true;
  }
  return false;
}

/** The syntactic shapes the per-evaluation lowering covers: no type
 * parameters, no decorators, no static members or static blocks (a static
 * side with state is a separate piece), no computed member names. Anything
 * else keeps the named fence. */
export function evalClassSyntaxOk(decl: ts.ClassLikeDeclaration): boolean {
  if (!classExprInsideFunction(decl)) return false;
  if (decl.typeParameters !== undefined) return false;
  const mods = (decl as { modifiers?: readonly ts.Node[] }).modifiers ?? [];
  if (mods.some((m) => m.kind === ts.SyntaxKind.Decorator)) return false;
  // A class-static-block ancestor evaluates once per CLASS evaluation with its
  // own `this`; keep that fenced.
  for (let p: ts.Node = decl.parent; !ts.isSourceFile(p); p = p.parent) {
    if (ts.isClassStaticBlockDeclaration(p)) return false;
  }
  for (const m of decl.members) {
    if (ts.isClassStaticBlockDeclaration(m)) return false;
    const mm = (m as { modifiers?: readonly ts.Node[] }).modifiers ?? [];
    if (mm.some((x) => x.kind === ts.SyntaxKind.StaticKeyword || x.kind === ts.SyntaxKind.Decorator)) return false;
    const name = (m as { name?: ts.Node }).name;
    if (name !== undefined && ts.isComputedPropertyName(name as ts.PropertyName)) return false;
  }
  return true;
}

/** The IR name of an evaluated class's STATIC SIDE (the per-evaluation
 * object). The suffix cannot collide with a user identifier ('%'). */
export function evalStaticClassName(instanceClassName: string): string {
  return `${instanceClassName}.%static`;
}
