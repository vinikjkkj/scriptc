/**
 * Instance-level method overrides assigned OUTSIDE the class: `pipeline.exec = function (...) {...}` where `pipeline` is an
 * instance of a class that has a method `exec`. JS creates an OWN property on that one object, and a later `pipeline.exec()`
 * runs it (with the instance as `this`) ahead of the prototype's method.
 *
 * The scan runs before any class shape is collected (the layout is decided once, at collection) and answers, per class
 * declaration, the method names some assignment writes over an instance of that class (the receiver's STATIC class: a write
 * through a subclass-typed value lands on the subclass). The class then collects the same undefined-armed function slot a
 * constructor-assigned override takes (lower-classes' shadowFields), so calls through the class family test the slot first
 * (shadowMethodFn). A class nothing assigns over carries no slot and no wrapper: its emitted code is unchanged.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

export interface InstanceOverride {
  /** The assigned function expressions, in source order (all writes to this name over this class). */
  readonly fns: ts.Node[];
  /** The member is a LATE method (`C.prototype.m = function`) of the receiver's own class: no signature exists at collection, so the
   * class takes the slot only and the wrapper is built over the lowered method (lower-protoslots' applyInstanceOverrides). */
  late?: true;
}

/** Class declaration -> overridden method name -> writes. Filled by scanInstanceOverrides. */
export type InstanceOverrides = Map<ts.Node, Map<string, InstanceOverride>>;

function classDeclOfType(L: Lowerer, e: ts.Expression): ts.ClassLikeDeclaration | null {
  const sym = L.checker.getTypeAtLocation(e).getSymbol();
  if (!sym) return null;
  for (const d of L.checker.declarationsOf(sym)) {
    if (ts.isClassDeclaration(d) || ts.isClassExpression(d)) return d;
  }
  return null;
}

/** Does the member `m` of the class family rooted at `cls` resolve to a method (declared in a class body, or a prototype-assigned
 * function of a JS pre-class)? Walks the checker's own answer for the property at the write. */
function namesMethod(L: Lowerer, left: ts.PropertyAccessExpression): boolean {
  const sym = L.checker.getSymbolAtLocation(left);
  if (!sym) return false;
  for (const d of L.checker.declarationsOf(sym)) {
    if (ts.isMethodDeclaration(d)) return true;
    // `C.prototype.m = function () {}` (a late method of a JS class)
    if (
      ts.isBinaryExpression(d) && d.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(d.left) &&
      ts.isPropertyAccessExpression(d.left.expression) && d.left.expression.name.text === "prototype"
    ) return true;
  }
  return false;
}

/** Class declaration -> names written as `Cls.prototype.name = <function>` (late methods of a JS class). */
function lateMethodNames(L: Lowerer, files: readonly ts.SourceFile[]): Map<ts.Node, Set<string>> {
  const out = new Map<ts.Node, Set<string>>();
  for (const sf of files) {
    if (sf.isDeclarationFile || !sf.text.includes(".prototype.")) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (
        ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) &&
        ts.isPropertyAccessExpression(n.left.expression) && n.left.expression.name.text === "prototype" &&
        ts.isIdentifier(n.left.expression.expression) && (ts.isFunctionExpression(n.right) || ts.isArrowFunction(n.right))
      ) {
        let sym = L.checker.getSymbolAtLocation(n.left.expression.expression);
        if (sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = L.checker.getAliasedSymbol(sym);
        const decl = sym === undefined ? undefined : L.checker.declarationsOf(sym).find((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d));
        if (decl !== undefined) {
          let set = out.get(decl);
          if (set === undefined) out.set(decl, (set = new Set()));
          set.add(n.left.name.text);
        }
      }
      n.forEachChild((c) => {
        stack.push(c);
      });
    }
  }
  return out;
}

export function scanInstanceOverrides(L: Lowerer, files: readonly ts.SourceFile[]): void {
  L.instanceOverrides.clear();
  let late: Map<ts.Node, Set<string>> | null = null;
  for (const sf of files) {
    if (sf.isDeclarationFile) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (
        ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(n.left) &&
        n.left.questionDotToken === undefined &&
        n.left.expression.kind !== ts.SyntaxKind.ThisKeyword && n.left.expression.kind !== ts.SyntaxKind.SuperKeyword &&
        !(ts.isIdentifier(n.left.expression) && n.left.expression.text === "exports") &&
        !(ts.isPropertyAccessExpression(n.left.expression) && n.left.expression.name.text === "exports") &&
        !(ts.isPropertyAccessExpression(n.left.expression) && n.left.expression.name.text === "prototype") &&
        (ts.isFunctionExpression(n.right) || ts.isArrowFunction(n.right))
      ) {
        const cls = classDeclOfType(L, n.left.expression);
        const name = n.left.name.text;
        const isMethod = namesMethod(L, n.left);
        if (cls !== null && !isMethod && late === null) late = lateMethodNames(L, files);
        const isLate = cls !== null && !isMethod && late!.get(cls)?.has(name) === true;
        if (cls !== null && (isMethod || isLate)) {
          let per = L.instanceOverrides.get(cls);
          if (per === undefined) L.instanceOverrides.set(cls, (per = new Map()));
          const rec = per.get(name);
          if (rec === undefined) per.set(name, { fns: [n.right], ...(isLate ? { late: true as const } : {}) });
          else rec.fns.push(n.right);
        }
      }
      n.forEachChild((c) => {
        stack.push(c);
      });
    }
  }
}
