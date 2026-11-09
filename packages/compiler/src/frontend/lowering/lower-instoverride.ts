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

/** `(x as unknown as { m: F })` over a plain-named class instance `x`: the program asserts a view of the instance through `unknown` (zapo wraps its
 * ioredis client's sendCommand this way). The view is the instance itself, so a member written or read through it is the instance's own. Returns `x`
 * when `e` is such a view of a class object, else null. */
export function castViewInner(L: Lowerer, e: ts.Expression): ts.Expression | null {
  let n: ts.Expression = e;
  let throughUnknown = false;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
    else if (ts.isAsExpression(n)) {
      if (n.type.kind === ts.SyntaxKind.UnknownKeyword) throughUnknown = true;
      n = n.expression;
    } else break;
  }
  if (!throughUnknown || n === e) return null;
  if (n.kind !== ts.SyntaxKind.ThisKeyword && !ts.isIdentifier(n)) return null;
  return L.mapTypeOf(L.typeOf(n))?.kind === "object" ? n : null;
}

function classDeclOfType(L: Lowerer, e: ts.Expression): ts.ClassLikeDeclaration | null {
  const sym = L.checker.getTypeAtLocation(e).getSymbol();
  if (!sym) return null;
  for (const d of L.checker.declarationsOf(sym)) {
    if (!(ts.isClassDeclaration(d) || ts.isClassExpression(d))) continue;
    // A package's types resolve the class to its declaration file (`Pipeline.d.ts`); the class the program collects is the same-named class of the
    // `.js` twin, which is the declaration every class table is keyed by.
    if (d.getSourceFile().isDeclarationFile && d.name !== undefined) {
      const twinName = d.getSourceFile().fileName.replace(/\.d\.(c|m)?ts$/, ".$1js");
      const twin = twinName === d.getSourceFile().fileName ? undefined : L.program.getSourceFile(twinName);
      const impl = twin?.statements.find((x) => ts.isClassDeclaration(x) && x.name?.text === d.name!.text);
      if (impl !== undefined) return impl as ts.ClassLikeDeclaration;
    }
    return d;
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

/** The member `name` of the (class) type of `recv` resolves to a method declaration. */
function namesMethodOfType(L: Lowerer, recv: ts.Expression, name: string): boolean {
  const sym = L.checker.getPropertyOfType(L.typeOf(recv), name);
  if (!sym) return false;
  return L.checker.declarationsOf(sym).some((d) => ts.isMethodDeclaration(d) || d.kind === ts.SyntaxKind.MethodSignature);
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
        const viewRecv = castViewInner(L, n.left.expression);
        const cls = classDeclOfType(L, viewRecv ?? n.left.expression);
        const name = n.left.name.text;
        const isMethod = viewRecv !== null ? namesMethodOfType(L, viewRecv, name) : namesMethod(L, n.left);
        // A `C.prototype.m = function` declaration is a LATE method (registered after the shape is collected) whether or not the checker resolved
        // the member at this receiver (a package's types declare it on a base interface): the class's own late names decide.
        if (cls !== null && late === null) late = lateMethodNames(L, files);
        const isLate = cls !== null && late!.get(cls)?.has(name) === true;
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

/** `(x as unknown as { m: F }).m = fn` over a class instance whose family carries the override slot of `m` (scanInstanceOverrides takes the same
 * view): the write is the instance's own property, exactly as `x.m = fn` writes it. Null when the write is not this shape. */
export function lowerCastViewOverrideWrite(L: Lowerer, expr: ts.BinaryExpression, loc: import("../../ir/nodes.js").SrcLoc): import("../../ir/nodes.js").IrStmt | null {
  const left = expr.left;
  if (!ts.isPropertyAccessExpression(left) || left.questionDotToken !== undefined) return null;
  const inner = castViewInner(L, left.expression);
  if (inner === null) return null;
  const recvT = L.mapTypeOf(L.typeOf(inner));
  if (recvT?.kind !== "object") return null;
  const info = L.classes.get(recvT.className);
  if (info === undefined) return null;
  const name = left.name.text;
  let owns = false;
  for (let c: typeof info | null = info; c !== null; c = c.base) if (c.shadowFields?.has(name) === true || c.shadowLate?.has(name) === true) owns = true;
  const slotT = info.fields.get(name);
  if (!owns || slotT === undefined) return null;
  const obj = L.lowerExpr(inner);
  const value = L.coerceInto(expr.right, L.lowerExpr(expr.right), slotT);
  return { kind: "fieldSet", obj, className: recvT.className, field: name, value, loc };
}
