/* The AbortController / AbortSignal value surface (scr_abort.c).
 *
 * SEVEN operations, and the seven are not a menu. Six of them are what a
 * trap census sees — `new AbortController()`, `controller.abort(reason?)`,
 * `controller.signal`, `signal.aborted`. The other three —
 * `signal.reason`, `signal.addEventListener('abort', fn, {once})`,
 * `signal.removeEventListener('abort', fn)` — are INVISIBLE to a census
 * until the first four exist, because they sit inside branches whose
 * conditions the first four fence away. Lower the visible ones alone and
 * the hidden ones surface as NEW refusals: the family gets worse before it
 * gets better. So they land together.
 *
 * What is NOT here, deliberately: the statics (AbortSignal.abort/timeout/
 * any), `onabort`, and `throwIfAborted`. Each keeps its existing fence.
 * They are not part of the seven — no reachable code needs them to stop
 * refusing — and `timeout` in particular wants a raw-timer entry point
 * that does not exist. A fence that stays a fence is not a regression;
 * shipping half of an entangled family is.
 *
 * The 'abort' listener is pinned to the ZERO-PARAMETER shape. Node hands
 * the callback an Event, and an Event has no representation here, so a
 * listener that declares the parameter fences by name rather than
 * receiving something invented. Every listener in reach writes
 * `() => ...`, which is what the lib's `(ev: Event) => void` accepts. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { locOf } from "../program.js";
import { ABORTCONTROLLER_T, ABORTSIGNAL_T, BOOL, DYN, IrExpr, SrcLoc, VOID } from "../../ir/nodes.js";

const SIGNAL_HINT =
  "aborted, reason, addEventListener('abort', fn, { once }) and " +
  "removeEventListener('abort', fn) are the supported AbortSignal members";
const CONTROLLER_HINT = "signal and abort(reason?) are the supported AbortController members";

/** `new AbortController()` — the controller mints its one signal, and
 * `controller.signal` answers that same object every time (Node's getter
 * identity, which listener bookkeeping depends on). */
export function lowerAbortControllerNew(L: Lowerer, expr: ts.NewExpression, loc: SrcLoc): IrExpr {
  const args = expr.arguments ?? [];
  if (args.length !== 0) {
    L.noLowering(
      `new AbortController with ${args.length} argument${args.length === 1 ? "" : "s"}`,
      expr,
      "the constructor takes none",
    );
  }
  return { kind: "libCall", fn: "abort.newController", args: [], type: ABORTCONTROLLER_T, loc };
}

/** The reason ARGUMENT of abort(reason?). `reason` is `any` in the lib and
 * Node keeps the value it was given — `c.abort(err)` leaves
 * `signal.reason === err` with `.code` intact — so it crosses as a dyn
 * (scr_dyn_from_error's identity cache makes the Error crossing stable and
 * carries `code` with it). An omitted reason is NULL at the C boundary and
 * mints the AbortError DOMException there; the dyn `undefined` is the same
 * thing, which is what Node's `reason === undefined` test says. */
function reasonArg(L: Lowerer, call: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  if (call.arguments.length === 0) return null;
  if (call.arguments.length > 1) {
    L.noLowering("AbortController.abort with more than one argument", call, "abort(reason?) is the shape");
  }
  const a = call.arguments[0]!;
  const v = L.lowerExpr(a);
  if (v.type.kind === "dyn") return v;
  if (v.kind === "unitLit" || L.dynConvertible(v.type)) {
    return { kind: "dynFrom", value: v, type: DYN, loc };
  }
  L.noLowering(
    `AbortController.abort with a '${L.fmt(v.type)}' reason`,
    a,
    "the reason crosses as a checked-dynamic value — an Error, a string, or any other convertible value",
  );
}

/** The listener ARGUMENT: a zero-parameter void closure, by identity. The
 * runtime stores the ScrClosure pointer and both the duplicate-add test
 * and removeEventListener key on it, which is exactly JS's `f === f`. */
function listenerArg(L: Lowerer, call: ts.CallExpression, a: ts.Expression, what: string): IrExpr {
  const v = L.lowerExpr(a);
  if (v.type.kind !== "func" || v.type.params.length !== 0 || v.type.ret.kind !== "void") {
    L.noLowering(
      `${what} with a '${L.fmt(v.type)}' listener`,
      a,
      "the lowered listener shape is () => void — the Event argument has no representation",
    );
  }
  return v;
}

/** The `{ once }` options argument. Only the literal forms lower: `once`
 * decides whether the entry leaves the list before its call, and a
 * computed value would have to be threaded into a boolean the runtime
 * already takes — which it does, so a non-literal `once` is fine too as
 * long as it is a boolean expression. `capture`/`signal`/`passive` are
 * refused by name: this listener list has no capture phase to honor. */
function onceArg(L: Lowerer, call: ts.CallExpression, loc: SrcLoc): IrExpr {
  if (call.arguments.length < 3) return { kind: "boolLit", value: false, type: BOOL, loc };
  if (call.arguments.length > 3) {
    L.noLowering("AbortSignal.addEventListener with more than three arguments", call,
      "addEventListener('abort', fn, { once }) is the shape");
  }
  const o = call.arguments[2]!;
  if (o.kind === ts.SyntaxKind.TrueKeyword || o.kind === ts.SyntaxKind.FalseKeyword) {
    // The boolean `useCapture` overload: `true` is a capture registration.
    if (o.kind === ts.SyntaxKind.TrueKeyword) {
      L.noLowering("addEventListener with capture: true", o,
        "this listener list has no capture phase — the abort event has no propagation path");
    }
    return { kind: "boolLit", value: false, type: BOOL, loc };
  }
  if (!ts.isObjectLiteralExpression(o)) {
    L.noLowering("addEventListener with a computed options argument", o,
      "an object literal ({ once: true }) is the lowered form");
  }
  let once: IrExpr = { kind: "boolLit", value: false, type: BOOL, loc };
  for (const p of o.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) {
      L.noLowering("a spread or computed key in addEventListener options", p,
        "{ once: <boolean> } is the lowered form");
    }
    const key = p.name.text;
    if (key !== "once") {
      L.noLowering(`the addEventListener option '${key}'`, p,
        "only 'once' is honored — this listener list has no capture phase and no nested signal");
    }
    const v = L.lowerExpr(p.initializer);
    if (v.type.kind !== "bool") L.badType(p.initializer, L.typeOf(p.initializer));
    once = v;
  }
  return once;
}

/** The 'abort' event NAME argument: a string literal, and only 'abort'.
 * EventTarget ignores every other type silently; ignoring silently is the
 * one answer worse than refusing, so a different literal refuses and a
 * computed name refuses too. */
function requireAbortType(L: Lowerer, a: ts.Expression | undefined, what: string): void {
  if (a === undefined || !ts.isStringLiteral(a)) {
    L.noLowering(`${what} with a computed event name`, a ?? undefined!,
      "'abort' is the only event an AbortSignal has — pass the literal");
  }
  if (a.text !== "abort") {
    L.noLowering(`${what}('${a.text}')`, a,
      "'abort' is the only event an AbortSignal has (EventTarget would ignore this registration silently)");
  }
}

/** Property reads on abortSignal / abortController receivers. Null for
 * every other receiver, so the property chain keeps trying. */
export function lowerAbortProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  const kind = L.mapTypeOf(L.typeOf(expr.expression))?.kind;
  if (kind !== "abortSignal" && kind !== "abortController") return null;
  if (!L.isStdlibMember(expr)) return null;
  const name = expr.name.text;
  const loc = locOf(expr);
  if (kind === "abortController") {
    if (name === "signal") {
      const receiver = L.lowerExpr(expr.expression);
      return { kind: "libCall", fn: "abort.signal", args: [receiver], type: ABORTSIGNAL_T, loc };
    }
    if (name === "abort") L.unsupported("SC1090", expr, "AbortController.abort as a value (call it directly)");
    L.noLowering(`AbortController.${name}`, expr, CONTROLLER_HINT, L.checker.getSymbolAtLocation(expr.name));
  }
  if (name === "aborted") {
    const receiver = L.lowerExpr(expr.expression);
    return { kind: "libCall", fn: "abort.aborted", args: [receiver], type: BOOL, loc };
  }
  if (name === "reason") {
    const receiver = L.lowerExpr(expr.expression);
    return { kind: "libCall", fn: "abort.reason", args: [receiver], type: DYN, loc };
  }
  if (name === "addEventListener" || name === "removeEventListener" || name === "throwIfAborted") {
    L.unsupported("SC1090", expr, `AbortSignal.${name} as a value (call it directly)`);
  }
  L.noLowering(`AbortSignal.${name}`, expr, SIGNAL_HINT, L.checker.getSymbolAtLocation(expr.name));
}

/** Method calls on abortSignal / abortController receivers. */
export function lowerAbortMethodCall(
  L: Lowerer,
  call: ts.CallExpression,
  access: ts.PropertyAccessExpression,
): IrExpr | null {
  if (call.questionDotToken || access.questionDotToken) return null;
  const kind = L.mapTypeOf(L.typeOf(access.expression))?.kind;
  if (kind !== "abortSignal" && kind !== "abortController") return null;
  if (!L.isStdlibMember(access)) return null;
  const name = access.name.text;
  const loc = locOf(call);
  if (kind === "abortController") {
    if (name === "abort") {
      const receiver = L.lowerExpr(access.expression);
      const reason = reasonArg(L, call, loc);
      // Two entry points rather than a sentinel argument: an omitted
      // reason is not `undefined` passed along, it is the runtime minting
      // the AbortError DOMException — and the IR's libCall slots are
      // arity-checked, so the distinction lives in the name (fs.watch /
      // fs.watchCb's precedent).
      return reason === null
        ? { kind: "libCall", fn: "abort.abort", args: [receiver], type: VOID, loc }
        : { kind: "libCall", fn: "abort.abortReason", args: [receiver, reason], type: VOID, loc };
    }
    L.noLowering(`AbortController.${name}`, call, CONTROLLER_HINT, L.checker.getSymbolAtLocation(access.name));
  }
  if (name === "addEventListener") {
    requireAbortType(L, call.arguments[0], "AbortSignal.addEventListener");
    if (call.arguments.length < 2) {
      L.noLowering("AbortSignal.addEventListener with one argument", call, "addEventListener('abort', fn) is the shape");
    }
    const receiver = L.lowerExpr(access.expression);
    const fn = listenerArg(L, call, call.arguments[1]!, "AbortSignal.addEventListener");
    const once = onceArg(L, call, loc);
    return { kind: "libCall", fn: "abort.on", args: [receiver, fn, once], type: VOID, loc };
  }
  if (name === "removeEventListener") {
    requireAbortType(L, call.arguments[0], "AbortSignal.removeEventListener");
    if (call.arguments.length < 2 || call.arguments.length > 2) {
      L.noLowering(
        `AbortSignal.removeEventListener with ${call.arguments.length} argument${call.arguments.length === 1 ? "" : "s"}`,
        call,
        "removeEventListener('abort', fn) is the shape — the options overload has no capture phase to distinguish",
      );
    }
    const receiver = L.lowerExpr(access.expression);
    const fn = listenerArg(L, call, call.arguments[1]!, "AbortSignal.removeEventListener");
    return { kind: "libCall", fn: "abort.off", args: [receiver, fn], type: VOID, loc };
  }
  L.noLowering(`AbortSignal.${name}`, call, SIGNAL_HINT, L.checker.getSymbolAtLocation(access.name));
}
