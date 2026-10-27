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
import { RUNTIME_EMITTER_CLASS } from "../../ir/nodes.js";
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

function isApplyMixinBody(fn: ts.FunctionDeclaration): boolean {
  const text = fn.getText();
  return text.includes("getOwnPropertyNames") && text.includes("defineProperty");
}

/** True when a top-level `applyMixin(<decl>, EventEmitter)` statement grafts
 * the emitter onto the class declared by `decl`. */
export function appliesEmitterMixin(L: Lowerer, decl: ts.ClassLikeDeclaration): boolean {
  if (!decl.name) return false;
  const sf = decl.getSourceFile();
  for (const st of sf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue;
    const call = st.expression;
    if (!ts.isIdentifier(call.expression) || call.arguments.length !== 2) continue;
    const [target, mixin] = call.arguments;
    if (!target || !mixin || !ts.isIdentifier(target) || target.text !== decl.name.text) continue;
    if (!ts.isIdentifier(mixin)) continue;
    const fnName = call.expression.text;
    const fn = sf.statements.find(
      (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === fnName,
    );
    if (!fn || !isApplyMixinBody(fn)) continue;
    let emitterSym = L.checker.getSymbolAtLocation(mixin);
    if (emitterSym && (emitterSym.flags & ts.SymbolFlags.Alias) !== 0) emitterSym = L.checker.getAliasedSymbol(emitterSym);
    if (L.builtinEmitterInfoOf(emitterSym) === null) continue;
    return true;
  }
  return false;
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
