/* `applyMixin(Y, EventEmitter)`: the ioredis shape. A helper copies every
 * own name of EventEmitter.prototype onto Y.prototype through
 * Object.defineProperty (utils/applyMixin.js). Node then makes Y an emitter
 * for every program that reads it through the EventEmitter API.
 *
 * The compiler does not model Y as an emitter-rooted class (Y extends some
 * other program class, so its layout has no ScrEmitter prefix). Instead the
 * recogniser marks Y, Y gets ONE hidden trailing field of the runtime
 * emitter type (its initializer is `new EventEmitter()`, eager, which is
 * not observable through the EventEmitter API), and an EventEmitter member
 * call on a Y receiver lowers through lowerEmitterMethodCall on that field,
 * exactly like `this.ee.emit(...)` on an ordinary field of EventEmitter type.
 *
 * Recognition is by shape: a top-level `applyMixin(Y, EventEmitter)`
 * statement whose callee is a same-file function whose body walks
 * getOwnPropertyNames and calls defineProperty. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import type { IrExpr } from "../../ir/nodes.js";
import { RUNTIME_EMITTER_CLASS, UNDEFINED_T } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import { lowerEmitterMethodCall } from "./lower-emitter.js";

/** The hidden instance slot holding the ScrEmitter for a mixin-grafted class. */
export const EMITTER_MIXIN_FIELD = "__scrEmitter";

/** The EventEmitter API members a graft installs on Y (Node's prototype names). */
const EMITTER_API = new Set([
  "on", "once", "off", "emit", "addListener", "removeListener", "removeAllListeners",
  "prependListener", "prependOnceListener", "listenerCount", "listeners", "rawListeners",
  "eventNames", "setMaxListeners", "getMaxListeners",
]);

/** The helper's exact copy loop, with its two parameters named (derived, mixin):
 * the statement is compared after removing whitespace and semicolons, so the
 * JS and any reformatting agree, and any other body (an extra statement, a
 * different descriptor source, a skipped name) is not this shape. */
function canonicalCopy(d: string, m: string): string {
  return `Object.getOwnPropertyNames(${m}.prototype).forEach((name)=>{Object.defineProperty(${d}.prototype,name,Object.getOwnPropertyDescriptor(${m}.prototype,name));})`;
}
function squash(text: string): string {
  return text.replace(/\s+/g, "").replace(/;/g, "");
}
function isApplyMixinBody(fn: ts.Node): boolean {
  if (!ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) && !ts.isArrowFunction(fn)) return false;
  if (fn.parameters.length !== 2 || !fn.body || !ts.isBlock(fn.body) || fn.body.statements.length !== 1) return false;
  const [p0, p1] = fn.parameters;
  if (!p0 || !p1 || !ts.isIdentifier(p0.name) || !ts.isIdentifier(p1.name)) return false;
  const stmt = fn.body.statements[0]!;
  return squash(stmt.getText()) === squash(canonicalCopy(p0.name.text, p1.name.text));
}

/** The symbol a name resolves to (aliases followed), or undefined. */
function symbolOfName(L: Lowerer, n: ts.Node): ts.Symbol | undefined {
  let sym = L.checker.getSymbolAtLocation(n);
  if (sym && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = L.checker.getAliasedSymbol(sym);
  return sym;
}

/** Strip parentheses and the `(0, f)` comma head esbuild/tsc emit around a
 * callee (`(0, applyMixin_1.default)(Redis, events_1.EventEmitter)`). */
function unwrapCallee(e: ts.Expression): ts.Expression {
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isParenthesizedExpression(x)) x = x.expression;
    else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.CommaToken) x = x.right;
    else return x;
  }
}

/** The function declaring the helper behind a callee symbol. Follows one
 * `exports.default = applyMixin` alias chain (CommonJS re-export) to the
 * declaration; null for anything that is not a plain function. */
function helperFunctionOf(L: Lowerer, sym: ts.Symbol | undefined, depth = 0): ts.Node | null {
  if (!sym || depth > 3) return null;
  for (const d of L.checker.declarationsOf(sym)) {
    if (ts.isFunctionDeclaration(d)) return d;
    if (ts.isVariableDeclaration(d) && d.initializer && (ts.isFunctionExpression(d.initializer) || ts.isArrowFunction(d.initializer))) return d.initializer;
    if (ts.isBinaryExpression(d) && ts.isIdentifier(d.right)) {
      const inner = helperFunctionOf(L, symbolOfName(L, d.right), depth + 1);
      if (inner !== null) return inner;
    }
  }
  return null;
}

/** The grafted class identifier of a recognised `applyMixin(Y, EventEmitter)`
 * call, or null. The callee resolves to a plain function whose body is exactly
 * the descriptor copy loop, and the second argument resolves to the runtime
 * EventEmitter (bare, or a namespace member such as `events_1.EventEmitter`). */
export function emitterMixinCallTarget(L: Lowerer, call: ts.CallExpression): ts.Identifier | null {
  if (call.arguments.length !== 2) return null;
  const [target, mixin] = call.arguments;
  if (!target || !mixin || !ts.isIdentifier(target)) return null;
  const callee = unwrapCallee(call.expression);
  const calleeName = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : null;
  if (calleeName === null) return null;
  const helper = helperFunctionOf(L, symbolOfName(L, calleeName));
  if (helper === null || !isApplyMixinBody(helper)) return null;
  const mixinName = ts.isPropertyAccessExpression(mixin) ? mixin.name : ts.isIdentifier(mixin) ? mixin : null;
  if (mixinName === null) return null;
  if (L.builtinEmitterInfoOf(symbolOfName(L, mixinName)) === null) return null;
  return target;
}

/** True when a top-level `applyMixin(<decl>, EventEmitter)` statement grafts
 * the emitter onto the class declared by `decl`. */
export function appliesEmitterMixin(L: Lowerer, decl: ts.ClassLikeDeclaration): boolean {
  if (!decl.name) return false;
  for (const st of decl.getSourceFile().statements) {
    if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue;
    const target = emitterMixinCallTarget(L, st.expression);
    if (target !== null && target.text === decl.name.text) return true;
  }
  return false;
}

/** True when this top-level statement is the recognised graft call itself
 * (lowered to nothing: the hidden slot already holds the emitter). */
export function isEmitterMixinStatement(L: Lowerer, stmt: ts.Statement): boolean {
  return ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) &&
    stmt.parent !== undefined && ts.isSourceFile(stmt.parent) &&
    emitterMixinCallTarget(L, stmt.expression) !== null;
}

/** The hidden-field read on a receiver value. */
function slotOf(L: Lowerer, className: string, recv: IrExpr, loc: ReturnType<typeof locOf>): IrExpr {
  return {
    kind: "fieldGet",
    obj: recv,
    className,
    field: EMITTER_MIXIN_FIELD,
    type: { kind: "object", className: RUNTIME_EMITTER_CLASS },
    loc,
  };
}

/** `recv.<emitter member>(...)` on a grafted class. Null when the call is not
 * an EventEmitter member on such a receiver (the caller keeps its path). */
export function lowerEmitterMixinCall(L: Lowerer, call: ts.CallExpression): IrExpr | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const access = call.expression;
  if (access.questionDotToken !== undefined || !EMITTER_API.has(access.name.text)) return null;
  const recvT = L.typeOf(access.expression);
  const mapped = L.mapTypeOf(recvT);
  if (mapped?.kind !== "object") return null;
  const info = L.classes.get(mapped.className);
  if (!info || !info.emitterMixin) return null;
  const emitterInfo = L.classes.get(RUNTIME_EMITTER_CLASS);
  if (!emitterInfo) return null;
  const loc = locOf(call);
  const recv = L.lowerExpr(access.expression);
  return lowerEmitterMethodCall(L, call, access, emitterInfo, undefined, slotOf(L, mapped.className, recv, loc));
}

/** `(EventEmitter as any).call(this)` inside a grafted class's own declaration:
 * Node initialises the emitter's own state on `this`, and the hidden slot is
 * created eagerly by the field initialiser, so the call is a no-op. Null for
 * any other call. */
export function emitterCtorCallOnGraft(L: Lowerer, call: ts.CallExpression): IrExpr | null {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "call") return null;
  let inner: ts.Expression = call.expression.expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isAssertionExpression(inner)) {
    inner = (inner as ts.ParenthesizedExpression | ts.AsExpression | ts.TypeAssertion).expression;
  }
  if (call.arguments.length !== 1 || call.arguments[0]!.kind !== ts.SyntaxKind.ThisKeyword) return null;
  const innerName = ts.isPropertyAccessExpression(inner) ? inner.name : ts.isIdentifier(inner) ? inner : null;
  if (innerName === null || L.builtinEmitterInfoOf(symbolOfName(L, innerName)) === null) return null;
  let cls: ts.Node | undefined = call.parent;
  while (cls && !ts.isClassDeclaration(cls)) cls = cls.parent;
  if (!cls || !ts.isClassDeclaration(cls) || !appliesEmitterMixin(L, cls)) return null;
  return { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc: locOf(call) };
}
