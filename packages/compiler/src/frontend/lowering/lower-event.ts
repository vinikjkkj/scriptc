/* Node's global `Event` (scr_event.c) as a native lowered handle.
 *
 * What lowers here is what Node's Event does, measured against v24.15.0
 * (scr_event.c's header lists the exact rules):
 *
 *   new Event(type, init?)       libCall evt.new / evt.newMissing / evt.newDyn
 *   ev.type .defaultPrevented .cancelable .bubbles .composed .isTrusted
 *     .timeStamp .eventPhase .cancelBubble .returnValue .target
 *     .currentTarget .srcElement        property reads
 *   ev.cancelBubble = b / ev.returnValue = b    statement-position writes
 *   ev.preventDefault() .stopPropagation() .stopImmediatePropagation()
 *     .composedPath() .initEvent(type, bubbles?, cancelable?)
 *   Event.NONE / CAPTURING_PHASE / AT_TARGET / BUBBLING_PHASE   constants
 *   x instanceof Event           (see lowerEventInstanceOf)
 *
 * `target` / `currentTarget` answer `EventTarget | null`, and the only
 * EventTarget with a native representation is the AbortSignal, so the
 * checker's type maps to `AbortSignal | null` (types.ts) and the read is
 * `has ? signal : null`.
 *
 * The lib types the INSTANCE constants (`ev.NONE`) as numbers, but Node's
 * instances do not carry them (they are statics on the constructor): the
 * read answers the checked-dynamic `undefined`, which is what Node prints. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { dynUndefinedExpr } from "./lowerer.js";
import { locOf } from "../program.js";
import { ABORTSIGNAL_T, BOOL, DYN, EVENT_T, F64, IrExpr, IrType, NULL_T, SrcLoc, STRING, VOID, arrayOf } from "../../ir/nodes.js";

const EVENT_HINT =
  "type, defaultPrevented, cancelable, bubbles, composed, isTrusted, timeStamp, eventPhase, cancelBubble, " +
  "returnValue, target, currentTarget, srcElement, preventDefault, stopPropagation, stopImmediatePropagation, " +
  "composedPath and initEvent are the supported Event members";

const PHASES: Record<string, number> = { NONE: 0, CAPTURING_PHASE: 1, AT_TARGET: 2, BUBBLING_PHASE: 3 };

const BOOL_GETTERS: Record<string, string> = {
  defaultPrevented: "evt.defaultPrevented",
  cancelable: "evt.cancelable",
  bubbles: "evt.bubbles",
  composed: "evt.composed",
  isTrusted: "evt.isTrusted",
  cancelBubble: "evt.cancelBubble",
  returnValue: "evt.returnValue",
};

/** `ToString(arg)` for the type argument: a string passes, anything with a
 * JS string form goes through the toString node (a Symbol throws Node's
 * TypeError there, as `${type}` does). */
function typeString(L: Lowerer, a: ts.Expression): IrExpr {
  const v = L.lowerExpr(a);
  if (v.type.kind === "string") return v;
  if (v.kind === "unitLit") return { kind: "strLit", value: v.unit, type: STRING, loc: locOf(a) };
  if (v.type.kind === "f64" || v.type.kind === "bool" || v.type.kind === "dyn") {
    return { kind: "toString", operand: v, type: STRING, loc: locOf(a) };
  }
  L.noLowering(
    `Event with a '${L.fmt(v.type)}' type argument`,
    a,
    "the type argument is a string (a number, boolean or dynamic value is converted with ToString)",
  );
}

/** The identifier `Event` resolving to the stdlib global (not a user class). */
function isEventGlobal(L: Lowerer, e: ts.Expression): boolean {
  if (!ts.isIdentifier(e) || e.text !== "Event") return false;
  const sym = L.resolveValueSymbol(e);
  return sym !== null && sym !== undefined && L.isStdlibSymbol(sym);
}

/** `new Event(type, init?)`. */
export function lowerEventNew(L: Lowerer, expr: ts.NewExpression, loc: SrcLoc): IrExpr {
  const args = expr.arguments ?? [];
  if (args.length > 2) {
    L.noLowering(`new Event with ${args.length} arguments`, expr, "Event(type, init?) is the shape");
  }
  for (const a of args) {
    if (ts.isSpreadElement(a)) L.noLowering("new Event with a spread argument", a, "Event(type, init?) is the shape");
  }
  if (args.length === 0) return { kind: "libCall", fn: "evt.newMissing", args: [], type: EVENT_T, loc };
  const type = typeString(L, args[0]!);
  const init = args[1];
  const fb = (v: boolean): IrExpr => ({ kind: "boolLit", value: v, type: BOOL, loc });
  if (init === undefined || init.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(init) && init.text === "undefined")) {
    if (init !== undefined) L.lowerExpr(init);
    return { kind: "libCall", fn: "evt.new", args: [type, fb(false), fb(false), fb(false)], type: EVENT_T, loc };
  }
  // An object literal of plain `bubbles`/`cancelable`/`composed` members
  // lowers field by field (JS truthiness of each value, evaluated in
  // source order); anything else crosses as a checked-dynamic value and
  // the runtime reads it (and throws Node's validateObject error for a
  // non-object).
  if (ts.isObjectLiteralExpression(init)) {
    const fields: { name: string; value: ts.Expression }[] = [];
    let plain = true;
    for (const p of init.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) &&
          (p.name.text === "bubbles" || p.name.text === "cancelable" || p.name.text === "composed") &&
          !fields.some((f) => f.name === (p.name as ts.Identifier).text)) {
        fields.push({ name: p.name.text, value: p.initializer });
      } else {
        plain = false;
        break;
      }
    }
    if (plain) {
      const slots: Record<string, IrExpr> = {};
      const hidden: { id: string; init: IrExpr }[] = [];
      for (const f of fields) {
        const cond = L.lowerCondition(f.value);
        const local = L.declareHiddenLocal(`%evinit_${f.name}`, BOOL);
        hidden.push({ id: local.id, init: cond });
        slots[f.name] = { kind: "varRef", localId: local.id, type: BOOL, loc };
      }
      const call: IrExpr = {
        kind: "libCall",
        fn: "evt.new",
        args: [type, slots["bubbles"] ?? fb(false), slots["cancelable"] ?? fb(false), slots["composed"] ?? fb(false)],
        type: EVENT_T,
        loc,
      };
      if (hidden.length === 0) return call;
      return {
        kind: "seqExpr",
        stmts: hidden.map((h) => ({ kind: "varDecl" as const, localId: h.id, init: h.init, loc })),
        result: call,
        type: EVENT_T,
        loc,
      };
    }
  }
  const o = L.lowerExpr(init);
  const dyn: IrExpr = o.type.kind === "dyn"
    ? o
    : o.kind === "unitLit" || L.dynConvertible(o.type)
      ? { kind: "dynFrom", value: o, type: DYN, loc }
      : L.noLowering(
          `Event with a '${L.fmt(o.type)}' options argument`,
          init,
          "an object literal of bubbles/cancelable/composed, or a value that crosses as a checked-dynamic object",
        );
  return { kind: "libCall", fn: "evt.newDyn", args: [type, dyn], type: EVENT_T, loc };
}

/** `AbortSignal | null` for target/currentTarget, built through the same
 * coercion every union slot uses: `has(ev) ? signal(ev) : null`. */
function nullableSignal(L: Lowerer, expr: ts.Node, evt: IrExpr, has: string, get: string, loc: SrcLoc): IrExpr {
  const want = L.mapTypeOf(L.typeOf(expr));
  if (want === null || want === undefined) L.badType(expr, L.typeOf(expr));
  const local = L.declareHiddenLocal("%evtgt", EVENT_T);
  const ref = (): IrExpr => ({ kind: "varRef", localId: local.id, type: EVENT_T, loc });
  const sig: IrExpr = { kind: "libCall", fn: get as "evt.target", args: [ref()], type: ABORTSIGNAL_T, loc };
  const hasCall: IrExpr = { kind: "libCall", fn: has as "evt.hasTarget", args: [ref()], type: BOOL, loc };
  const nul = L.coerceToExpected({ kind: "unitLit", unit: "null", type: NULL_T, loc }, want);
  const some = L.coerceToExpected(sig, want);
  return {
    kind: "seqExpr",
    stmts: [{ kind: "varDecl", localId: local.id, init: evt, loc }],
    result: { kind: "ternary", cond: hasCall, then: some, else_: nul, type: want, loc },
    type: want,
    loc,
  };
}

/** Property reads on an `event` receiver, and the constants on the global
 * `Event`. Null for every other receiver, so the property chain keeps
 * trying. */
export function lowerEventProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  const name = expr.name.text;
  if (isEventGlobal(L, expr.expression)) {
    const v = PHASES[name];
    if (v !== undefined) return { kind: "numLit", value: v, type: F64, loc: locOf(expr) };
    return null;
  }
  if (L.mapTypeOf(L.typeOf(expr.expression))?.kind !== "event") return null;
  // No isStdlibMember gate: the `event` kind only comes from the stdlib
  // Event symbol, and Node members the lib omits (initEvent) must lower.
  const loc = locOf(expr);
  const receiver = L.lowerExpr(expr.expression);
  if (name === "type") return { kind: "libCall", fn: "evt.type", args: [receiver], type: STRING, loc };
  const b = BOOL_GETTERS[name];
  if (b !== undefined) return { kind: "libCall", fn: b as "evt.cancelable", args: [receiver], type: BOOL, loc };
  if (name === "timeStamp") return { kind: "libCall", fn: "evt.timeStamp", args: [receiver], type: F64, loc };
  if (name === "eventPhase") return { kind: "libCall", fn: "evt.eventPhase", args: [receiver], type: F64, loc };
  if (name === "target" || name === "srcElement") {
    return nullableSignal(L, expr, receiver, "evt.hasTarget", "evt.target", loc);
  }
  if (name === "currentTarget") {
    return nullableSignal(L, expr, receiver, "evt.hasCurrentTarget", "evt.currentTarget", loc);
  }
  if (PHASES[name] !== undefined) {
    // Typed as a number by the lib, absent from Node's instances.
    return { kind: "seqExpr", stmts: [{ kind: "exprStmt", expr: receiver, loc }], result: dynUndefinedExpr(loc), type: DYN, loc };
  }
  if (name === "preventDefault" || name === "stopPropagation" || name === "stopImmediatePropagation" ||
      name === "composedPath" || name === "initEvent") {
    L.unsupported("SC1090", expr, `Event.${name} as a value (call it directly)`);
  }
  L.noLowering(`Event.${name}`, expr, EVENT_HINT, L.checker.getSymbolAtLocation(expr.name));
}

/** Method calls on an `event` receiver. */
export function lowerEventMethodCall(
  L: Lowerer,
  call: ts.CallExpression,
  access: ts.PropertyAccessExpression,
): IrExpr | null {
  if (L.chainBlocked(call, access)) return null;
  if (L.mapTypeOf(L.typeOf(access.expression))?.kind !== "event") return null;
  const name = access.name.text;
  const loc = locOf(call);
  const noArgs = (): void => {
    if (call.arguments.length !== 0) {
      L.noLowering(`Event.${name} with arguments`, call, `${name}() takes none`);
    }
  };
  if (name === "preventDefault" || name === "stopPropagation" || name === "stopImmediatePropagation") {
    noArgs();
    const receiver = L.lowerExpr(access.expression);
    const fn = name === "preventDefault" ? "evt.preventDefault"
      : name === "stopPropagation" ? "evt.stopPropagation" : "evt.stopImmediate";
    return { kind: "libCall", fn, args: [receiver], type: VOID, loc };
  }
  if (name === "composedPath") {
    noArgs();
    const receiver = L.lowerExpr(access.expression);
    const t: IrType = arrayOf(ABORTSIGNAL_T);
    const want = L.mapTypeOf(L.typeOf(call));
    const out: IrExpr = { kind: "libCall", fn: "evt.composedPath", args: [receiver], type: t, loc };
    return want !== null && want !== undefined && want.kind === "array" ? out : L.coerceToExpected(out, want ?? t);
  }
  if (name === "initEvent") {
    const receiver = L.lowerExpr(access.expression);
    if (call.arguments.length === 0) {
      return {
        kind: "seqExpr",
        stmts: [{ kind: "exprStmt", expr: receiver, loc }],
        result: { kind: "libCall", fn: "evt.missingType", args: [], type: VOID, loc },
        type: VOID,
        loc,
      };
    }
    if (call.arguments.length > 3) L.noLowering("Event.initEvent with more than three arguments", call, "initEvent(type, bubbles?, cancelable?) is the shape");
    const type = typeString(L, call.arguments[0]!);
    const flag = (i: number): IrExpr =>
      call.arguments[i] === undefined ? { kind: "boolLit", value: false, type: BOOL, loc } : L.lowerCondition(call.arguments[i]!);
    return { kind: "libCall", fn: "evt.init", args: [receiver, type, flag(1), flag(2)], type: VOID, loc };
  }
  L.noLowering(`Event.${name}`, call, EVENT_HINT, L.checker.getSymbolAtLocation(access.name));
}

/** `ev.cancelBubble = v` / `ev.returnValue = v` in statement position. Null
 * for every other target. */
export function lowerEventPropertyAssignment(
  L: Lowerer,
  left: ts.PropertyAccessExpression,
  right: ts.Expression,
  loc: SrcLoc,
): IrExpr | null {
  const name = left.name.text;
  if (name !== "cancelBubble" && name !== "returnValue") return null;
  if (left.questionDotToken) return null;
  if (L.mapTypeOf(L.typeOf(left.expression))?.kind !== "event") return null;
  const receiver = L.lowerExpr(left.expression);
  const v = L.lowerCondition(right);
  return {
    kind: "libCall",
    fn: name === "cancelBubble" ? "evt.setCancelBubble" : "evt.setReturnValue",
    args: [receiver, v],
    type: VOID,
    loc,
  };
}
