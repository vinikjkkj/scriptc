/* A whole-program AT-MOST-ONCE proof for a class expression inside a function.
 *
 * A class expression creates a fresh class object each time its enclosing
 * function body runs (each evaluation gets its own identity and statics), so
 * the compiler refuses it: classExprNeverRegisters, and the two SC1090 fences in
 * lower-classes.ts. When the enclosing function provably runs AT MOST ONCE in
 * the whole program, one class object is created, and registering it like a
 * top-level class is exact.
 *
 * evalCount(F) bounds how many times F's body runs. It is 0 (never runs), 1
 * (runs at most once) or Infinity (unknown or many). Every rule below answers
 * Infinity when it cannot prove the bound:
 *   - F must have a binding (a function declaration, or a function expression /
 *     arrow directly assigned to a variable). Anything else (a method, a value
 *     passed around, `module.exports = F`) is Infinity.
 *   - Every reference to F's binding must be the callee of a call or a `new`.
 *     Any other use of the binding (a property read, an argument, an export) is
 *     an escape and Infinity.
 *   - A reference inside a loop is Infinity.
 *   - A reference at top level (no enclosing function) runs once.
 *   - A reference inside another function G contributes evalCount(G), and the
 *     references of F sum. A cycle is Infinity.
 *   - A reference inside the `get` of an Object.defineProperty(_, 'native', ...)
 *     getter contributes 0 when NATIVE IS DEAD (see nativeDead), else Infinity.
 *
 * nativeDead: the getter runs only when some program reads the property named
 * `native`. The rule: every identifier or string literal spelling `native` in the
 * program lies inside that defineProperty call. A read of `native` by any other
 * spelling would be a dynamic name (`pg[k]`), which this rule does not cover; the
 * proof is therefore stated for programs that spell the name (documented in the
 * report, not silently assumed). */
import * as ts from "./ts7/adapter.js";

type Count = 0 | 1 | number; // number === Infinity

export class ClassOnceProof {
  private refIndex: Map<ts.Symbol, ts.Identifier[]> | undefined;
  private nativeSpellings: { node: ts.Node; fileName: string }[] | undefined;
  private readonly memo = new Map<ts.Node, Count>();

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly files: readonly ts.SourceFile[],
  ) {}

  /** True when the class expression's body-owning function runs at most once. */
  classExprAtMostOnce(expr: ts.ClassLikeDeclaration): boolean {
    const fn = innermostFunction(expr);
    if (fn === undefined) return true; // a top-level class expression is one class already
    if (loopBetween(expr, fn)) return false;
    return this.evalCount(fn, new Set()) <= 1;
  }

  private evalCount(fn: ts.Node, visiting: Set<ts.Node>): Count {
    const cached = this.memo.get(fn);
    if (cached !== undefined) return cached;
    if (visiting.has(fn)) return Infinity;
    visiting.add(fn);
    const result = this.computeEvalCount(fn, visiting);
    visiting.delete(fn);
    this.memo.set(fn, result);
    return result;
  }

  private computeEvalCount(fn: ts.Node, visiting: Set<ts.Node>): Count {
    const sym = this.bindingSymbolOf(fn);
    if (sym === undefined) return Infinity;
    const refs = this.referencesOf(sym);
    let total = 0;
    for (const ref of refs) {
      const site = ref.parent;
      const isCallee =
        (ts.isCallExpression(site) || ts.isNewExpression(site)) && site.expression === ref;
      if (!isCallee) return Infinity; // an escape of the binding
      if (loopBetween(site, undefined)) return Infinity;
      const enc = innermostFunction(site);
      let add: Count;
      if (enc === undefined) {
        add = 1;
      } else if (this.isNativeGetter(enc) && this.nativeDead()) {
        add = 0;
      } else {
        add = this.evalCount(enc, visiting);
      }
      total += add;
      if (total > 1) return Infinity;
    }
    return total as Count;
  }

  /** The symbol a function's body is bound to, or undefined. */
  private bindingSymbolOf(fn: ts.Node): ts.Symbol | undefined {
    if (ts.isFunctionDeclaration(fn) && fn.name !== undefined) return this.checker.getSymbolAtLocation(fn.name);
    if ((ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)) {
      return this.checker.getSymbolAtLocation(fn.parent.name);
    }
    return undefined;
  }

  private referencesOf(sym: ts.Symbol): ts.Identifier[] {
    if (this.refIndex === undefined) {
      const index = new Map<ts.Symbol, ts.Identifier[]>();
      for (const sf of this.files) {
        const visit = (n: ts.Node): void => {
          if (ts.isIdentifier(n)) {
            const s = this.checker.getSymbolAtLocation(n);
            if (s !== undefined && !isDeclarationName(n)) {
              const list = index.get(s);
              if (list === undefined) index.set(s, [n]);
              else list.push(n);
            }
          }
          ts.forEachChild(n, visit);
        };
        ts.forEachChild(sf, visit);
      }
      this.refIndex = index;
    }
    return this.refIndex.get(sym) ?? [];
  }

  /** The getter `get() {...}` of an Object.defineProperty(_, 'native', { get }) call. */
  private isNativeGetter(fn: ts.Node): boolean {
    if (!ts.isMethodDeclaration(fn) || fn.name === undefined || !ts.isIdentifier(fn.name) || fn.name.text !== "get") return false;
    const obj = fn.parent;
    if (!ts.isObjectLiteralExpression(obj)) return false;
    const call = obj.parent;
    return ts.isCallExpression(call) && isDefinePropertyOfNative(call) && call.arguments[2] === obj;
  }

  /** True when every identifier or string literal spelling `native` in the program
   * lies inside a defineProperty(_, 'native', { get }) call, so nothing can read it. */
  private nativeDead(): boolean {
    if (this.nativeSpellings === undefined) {
      const out: { node: ts.Node; fileName: string }[] = [];
      for (const sf of this.files) {
        const visit = (n: ts.Node): void => {
          if ((ts.isIdentifier(n) && n.text === "native") || (ts.isStringLiteral(n) && n.text === "native")) {
            out.push({ node: n, fileName: sf.fileName });
          }
          ts.forEachChild(n, visit);
        };
        ts.forEachChild(sf, visit);
      }
      this.nativeSpellings = out;
    }
    return this.nativeSpellings.every(({ node }) => insideNativeDefine(node));
  }
}

/** The nearest enclosing function-like node (a body that runs when called), or undefined. */
function innermostFunction(node: ts.Node): ts.Node | undefined {
  for (let p: ts.Node | undefined = node.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p)) return p;
  }
  return undefined;
}

/** True when a loop statement sits between `node` and `stop` (or the source file). */
function loopBetween(node: ts.Node, stop: ts.Node | undefined): boolean {
  for (let p: ts.Node | undefined = node.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
    if (p === stop) return false;
    if (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p)) return false;
    if (ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return true;
  }
  return false;
}

function isDeclarationName(id: ts.Identifier): boolean {
  const p = id.parent;
  return (
    (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p) || ts.isMethodDeclaration(p)) &&
    p.name === id
  );
}

function isDefinePropertyOfNative(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const isDefine =
    (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Object" && callee.name.text === "defineProperty");
  const key = call.arguments[1];
  return isDefine && key !== undefined && ts.isStringLiteral(key) && key.text === "native";
}

/** A spelling of `native` is inside the defineProperty call that installs the getter. */
function insideNativeDefine(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node; p !== undefined; p = p.parent) {
    if (ts.isCallExpression(p) && isDefinePropertyOfNative(p)) return true;
    if (ts.isSourceFile(p)) return false;
  }
  return false;
}
