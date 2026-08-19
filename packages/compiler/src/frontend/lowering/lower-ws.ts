/* `globalThis.WebSocket` — the one global whose VALUE is a constructor
 * this compiler synthesizes.
 *
 * Everything under it already existed and was linked by nobody:
 * scr_websocket.c is the RFC 6455 frame codec, scr_ws_client.c dials and
 * pumps it over scr_net (wss:// through the same TLS wrap the native
 * fetch bridge uses), and both have their own C tests. What was missing
 * was the API OBJECT — a value with mutable on* slots, a live
 * readyState, send and close — and a name to reach it by.
 *
 * TWO THINGS MAKE THIS DIFFERENT FROM AN ORDINARY GLOBAL.
 *
 * 1. There is no lib.dom in a scriptc program, so the shape of the value
 *    comes from the PROGRAM's own declaration of the API. zapo writes
 *    its own `RawWebSocket` interface and casts globalThis to a type
 *    carrying it. So the surface is matched STRUCTURALLY against
 *    wsGlobalPlan, the single proof the IR validator and the C emitter
 *    also read — a shape it declines keeps its SC2020 fence, because a
 *    field the emitter cannot fill would be read out of uninitialized
 *    memory.
 *
 * 2. The value has IDENTITY. `globalThis.WebSocket === globalThis
 *    .WebSocket` is true in every runtime that has one, and zapo's
 *    WaWebSocket.createRawSocket depends on it: it compares the ctor it
 *    was handed against the global one to decide whether it may pass
 *    headers. So the node lowers to ONE interned immortal closure per
 *    func type (the emitter's fnValues discipline), never a fresh
 *    allocation per read.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { locOf } from "../program.js";
import { IrExpr, wsGlobalPlan } from "../../ir/nodes.js";
import { stdlibGlobalNameOf } from "./surfaces.js";

/** `globalThis` behind the casts a program needs to name a global the
 * ambient types do not declare for it — `(globalThis as typeof
 * globalThis & { WebSocket?: Ctor }).WebSocket` is the canonical
 * spelling, and stdlibGlobalNameOf stops at the AsExpression. Peeling is
 * safe here because an `as` changes only the static view: the RECEIVER
 * is still the one global object. */
function globalThisReceiver(L: Lowerer, expr: ts.Expression): boolean {
  let e = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e)) { e = e.expression; continue; }
    if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) { e = e.expression; continue; }
    if (ts.isNonNullExpression(e)) { e = e.expression; continue; }
    break;
  }
  return stdlibGlobalNameOf(L, e) === "globalThis";
}

/** `globalThis.WebSocket` as a VALUE. Null leaves the access to the rest
 * of the chain (and, in the end, to the member fence) — which is the
 * right answer for every shape this compiler cannot build. */
export function lowerWebSocketGlobal(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  if (expr.questionDotToken) return null;
  if (expr.name.text !== "WebSocket") return null;
  // SCRIPTC_WSGLOBAL_WHY: the surface is matched structurally, so a
  // near-miss looks exactly like "no lowering" from the outside. This
  // says WHICH step declined — the only way to tell a program that spells
  // the API differently from one this compiler simply does not reach.
  const why = (step: string): null => {
    if (process.env["SCRIPTC_WSGLOBAL_WHY"] !== undefined) {
      const l = locOf(expr);
      console.error(
        `WSGLOBAL decline=${step} at ${l.file}:${l.start} type=${L.checker.typeToString(L.typeOf(expr)).slice(0, 200)}`,
      );
    }
    return null;
  };
  if (!globalThisReceiver(L, expr.expression)) return why("receiver");

  const loc = locOf(expr);
  // The site the emitted wrapper's DEFERRED refusals tag with. The two
  // `ws` init-bag refusals (`agent`, `dispatcher`) are raised by the
  // backend, from a wrapper interned per construct-signature type and
  // reached only through a closure VALUE, so they have no diagnostic and no
  // location of their own — and they were the two rows in zapo's TU that
  // no bracket-keyed instrument could see. This is the one real source
  // location on the path: where the program READ globalThis.WebSocket and
  // got the constructor those refusals belong to. Rendered here because the
  // backends have no source text to turn an offset into a line.
  const site = `${loc.file}:${
    ts.getLineAndCharacterOfPosition(expr.getSourceFile(), loc.start).line + 1
  }`;
  const getRecord = (id: string) => L.shapes.get(id);
  const getUnion = (id: string) => L.unions.get(id);
  const mapped = L.mapTypeOf(L.typeOf(expr));
  if (mapped === null) return castConstructorArm(L, expr, loc, site, why);

  // The bare construct signature: the program declared the property
  // non-optional, or narrowed it before this read.
  if (mapped.kind === "func") {
    if (wsGlobalPlan(mapped, getRecord, getUnion) === null) return why("shape");
    return { kind: "wsCtor", type: mapped, site, loc };
  }

  // `WebSocket?: Ctor` — the optional spelling, which is what a program
  // that has to declare the global itself always writes. The value is
  // the function arm: a compiled binary always HAS the global (the
  // socket units are in the link exactly because this node is in the
  // IR), so the undefined arm is dead — but it must still be built as a
  // union, because that is the slot the program declared.
  if (mapped.kind === "union") {
    const def = getUnion(mapped.unionId);
    if (!def) return why("union");
    const fnTags = def.arms
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.kind === "func");
    if (fnTags.length !== 1) return why("arms");
    const { a: fnType, i: tag } = fnTags[0]!;
    // Every other arm must be the absent one: a union carrying a SECOND
    // real arm is not the global's type, and wrapping into it would be
    // guessing.
    if (!def.arms.every((a, i) => i === tag || a.kind === "undefinedT" || a.kind === "nullT")) {
      return why("arms");
    }
    if (wsGlobalPlan(fnType, getRecord, getUnion) === null) return why("shape");
    return {
      kind: "unionWrap",
      unionId: mapped.unionId,
      tag,
      value: { kind: "wsCtor", type: fnType, site, loc },
      type: mapped,
      loc,
    };
  }

  return why("kind");
}

/** The spelling a program that has to declare the global for itself
 * always ends up with, and the reason the site had no lowering before:
 *
 *   (globalThis as typeof globalThis & { WebSocket?: Ctor }).WebSocket
 *
 * With @types/node adopted, `typeof globalThis` ALREADY declares
 * `WebSocket` (undici's class), so the checker hands back the
 * INTERSECTION `typeof WebSocket & Ctor` — not the Ctor the cast was
 * written to assert. That intersection cannot map: undici's class object
 * carries `prototype`, the four readyState statics, and a construct
 * signature over its own `WebSocket` interface, none of which this
 * compiler builds.
 *
 * The value, though, is ONE object, and one constituent describes a
 * shape that can be built. That constituent is what the program is
 * actually asking for — this is the `Socket & { encrypted?: boolean }`
 * refinement rule one level up, and the same fence discipline covers the
 * rest: a read of `Ctor.CLOSED` on the func-typed value is a member on a
 * non-record receiver and reports its own SC2020.
 *
 * Exactly one constituent may qualify. Two would be a choice, and a
 * choice here is a guess. */
function castConstructorArm(
  L: Lowerer,
  expr: ts.PropertyAccessExpression,
  loc: ReturnType<typeof locOf>,
  site: string,
  why: (step: string) => null,
): IrExpr | null {
  const t = L.typeOf(expr);
  // The optional spelling puts an `undefined` arm around it; a compiled
  // binary that names the global always HAS it (the socket units are in
  // the link precisely because of this node), so the arm is dropped
  // rather than represented — the same narrowing `if (!ctor) throw` does
  // one line later in every program that writes this.
  const armsOf = (x: ts.Type): readonly ts.Type[] => (x.isUnionType() ? x.getTypes() : [x]);
  const parts: ts.Type[] = [];
  for (const arm of armsOf(t)) {
    if ((arm.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0) continue;
    if (arm.isIntersectionType()) parts.push(...arm.getTypes());
    else parts.push(arm);
  }
  const found: IrExpr[] = [];
  for (const part of parts) {
    const m = L.mapTypeOf(part);
    if (m === null || m.kind !== "func") continue;
    if (wsGlobalPlan(m, (id) => L.shapes.get(id), (id) => L.unions.get(id)) === null) continue;
    found.push({ kind: "wsCtor", type: m, site, loc });
  }
  if (found.length !== 1) return why(found.length === 0 ? "unmapped" : "ambiguous");
  return found[0]!;
}
