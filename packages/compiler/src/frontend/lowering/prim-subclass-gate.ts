/* Program-level gate for primitive-wrapper subclasses (prim-subclass-desugar.ts). */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

const memo = new WeakMap<object, boolean>();

/** Does any source file of the program carry the primitive-subclass rewrite's reserved call (`__scrSuperString(` and its Number /
 * Boolean siblings, authored only by the desugar)? Decided once per program from the files' text. Every lowering that must answer
 * differently only when such a wrapper can exist asks this, so a program without one lowers exactly as before. */
export function programHasPrimSubclass(L: Lowerer): boolean {
  let r = memo.get(L.program);
  if (r === undefined) {
    r = false;
    for (const sf of L.program.getSourceFiles()) {
      if (!sf.isDeclarationFile && sf.text.includes("__scrSuper")) { r = true; break; }
    }
    memo.set(L.program, r);
  }
  return r;
}

const protoAssignMemo = new WeakMap<object, boolean>();

/** Does any non-declaration source file of the program give a `.prototype` a value that is not shown to be a plain object?
 * Shown plain: an object literal, an `Object.create(...)` call, `new F()` of a function declaration, or another `X.prototype`.
 * Any other assigned value (an array, a function, a Map, a variable of unknown kind, ...), a defineProperty-style call naming
 * "prototype", or an element-access write of "prototype" makes the answer true, so `Object.setPrototypeOf(F.prototype, ..)` is
 * refused at compile time: `F.prototype` might hold something that cannot keep a link. Decided once per program (files that never
 * spell `prototype` are skipped from their text). */
export function programAssignsNonPlainPrototype(L: Lowerer): boolean {
  let r = protoAssignMemo.get(L.program);
  if (r !== undefined) return r;
  r = false;
  const plainValue = (e: ts.Expression): boolean => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isObjectLiteralExpression(e)) return true;
    if (ts.isPropertyAccessExpression(e) && e.name.text === "prototype") return true;
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "create" &&
        ts.isIdentifier(e.expression.expression) && e.expression.expression.text === "Object") return true;
    if (ts.isNewExpression(e) && ts.isIdentifier(e.expression)) {
      const s = L.checker.getSymbolAtLocation(e.expression);
      const ds = s ? L.checker.declarationsOf(s) : [];
      return ds.length === 1 && ts.isFunctionDeclaration(ds[0]!);
    }
    return false;
  };
  const isProtoKey = (n: ts.Expression): boolean =>
    (ts.isPropertyAccessExpression(n) && n.name.text === "prototype") ||
    (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && n.argumentExpression.text === "prototype");
  outer: for (const sf of L.program.getSourceFiles()) {
    if (sf.isDeclarationFile || !sf.text.includes("prototype")) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (ts.isBinaryExpression(node) && isProtoKey(node.left) &&
          (node.operatorToken.kind === ts.SyntaxKind.EqualsToken || node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
           node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken)) {
        if (!plainValue(node.right)) { r = true; break outer; }
      } else if (ts.isCallExpression(node) && node.arguments.some((a) => ts.isStringLiteral(a) && a.text === "prototype")) {
        r = true; break outer; // Object.defineProperty(F, "prototype", ..), Reflect.set(F, "prototype", ..)
      }
      ts.forEachChild(node, (c) => { stack.push(c); });
    }
  }
  protoAssignMemo.set(L.program, r);
  return r;
}
