/* proto-class-synth.ts -- turning a RECOGNISED prototype-class into the field
 * layout a synthesized ClassInfo needs.
 *
 * proto-class.ts answers "does this JS constructor have a fixed shape". This
 * module answers the next question: what TYPE does each slot hold. They are
 * separate because the first is a pure AST walk and the second needs the
 * checker, and keeping the walk checker-free is what lets the probe run it
 * against a real bundle with no build.
 *
 * WHY THE CHECKER CANNOT SIMPLY BE ASKED. The obvious implementation is to ask
 * for the type of the `this` property and use it. Measured, it does not work:
 *
 *     function S(b) { this.pos = 0; this.flag = false }
 *     S.prototype.clear = function () { this.pos = null }
 *     S.prototype.tag   = function () { this.flag = "yes" }
 *
 *     allowJs                    ->  pos: number   flag: boolean
 *     allowJs + checkJs          ->  pos: number   flag: boolean
 *     allowJs + checkJs + strict ->  pos: number   flag: boolean
 *
 * The checker types a this-property from the CONSTRUCTOR's initializer alone;
 * prototype-method writes never widen it. A slot typed that way is a slot the
 * first method write violates, and the validator's fieldSet expectType rejects
 * it. On zapo's bundle protobufjs's Reader seeds `pos` to 0 and then writes it
 * SIXTEEN times from methods, so this is the common case, not the corner.
 *
 * What the checker WILL do is type each write EXPRESSION individually. So the
 * union is computed here from the initializer plus every ProtoField.methodWrites
 * arm the recognizer collected.
 *
 * The dependencies arrive injected rather than as a Lowerer. Two reasons: the
 * unit test needs no Lowerer and no parser (TS 7 ships no client-side parser, so
 * the adapter has no createSourceFile and a test cannot parse a fixture), and
 * the nodes are opaque tokens to this module -- it only ever hands them back. */

import type * as ts from "../ts7/adapter.js";
import { type IrType, UNDEFINED_T, typeKey } from "../../ir/nodes.js";
import type { ProtoClass } from "./proto-class.js";

export interface SlotDeps {
  /** L.irTypeOf -- the checker's type for an expression, mapped to IR. */
  irTypeOf: (n: ts.Node) => IrType;
  /** L.unions.get(id)?.arms -- to FLATTEN a union arm rather than nest it. */
  unionArms: (id: string) => readonly IrType[] | undefined;
  /** L.unions.intern -- identity is the typeKey-sorted arm list. */
  internUnion: (arms: IrType[]) => string;
}

export interface ProtoSlot {
  name: string;
  type: IrType;
  initializer: ts.Expression;
}

export type SlotResult =
  | { ok: true; slots: ProtoSlot[]; fields: Map<string, IrType> }
  | { ok: false; bail: string };

/** Kinds that cannot be a monomorphic slot. Mirrors the deferred-init helper in
 * lower-classes.ts: a value whose layout the class cannot fix is exactly the
 * silently-wrong-shape this whole path exists to refuse. `void` joins because a
 * field cannot hold it. */
function unslottable(t: IrType): string | null {
  switch (t.kind) {
    case "map": case "regex": case "jsval": case "generator": case "void":
      return t.kind;
    default:
      return null;
  }
}

/** The slot type for one field: the initializer's type unioned with every
 * method write's, flattened, deduped, and interned.
 *
 * `dyn` ABSORBS. A dyn arm means the checker could not pin that write, and a
 * union with dyn in it is not a thing the layout can express -- but a wholly dyn
 * slot is, and it still buys the fixed layout and the static dispatch for every
 * OTHER field. That is a weaker win, not a wrong answer. */
export function protoSlotTypes(d: SlotDeps, c: ProtoClass): SlotResult {
  const slots: ProtoSlot[] = [];
  const fields = new Map<string, IrType>();

  for (const f of c.fields) {
    const byKey = new Map<string, IrType>();
    let dyn: IrType | null = null;

    const add = (t: IrType): string | null => {
      if (t.kind === "dyn") { dyn = t; return null; }
      const bad = unslottable(t);
      if (bad !== null) return bad;
      byKey.set(typeKey(t), t);
      return null;
    };

    for (const expr of [f.init, ...f.methodWrites]) {
      const t = d.irTypeOf(expr);
      // A union arm is FLATTENED, never nested: the interner's identity is the
      // sorted arm list, so a nested union would intern as a distinct type that
      // holds the same values.
      const parts = t.kind === "union" ? (d.unionArms(t.unionId) ?? [t]) : [t];
      for (const p of parts) {
        const bad = add(p);
        if (bad !== null) {
          return { ok: false, bail:
            `field '${f.name}' takes a ${bad} value, which has no fixed slot layout` };
        }
      }
    }

    // Assigned under a branch: instances that skip it read undefined in Node, so
    // the slot has to admit it or the layout lies about the shape.
    if (f.conditional) byKey.set(typeKey(UNDEFINED_T), UNDEFINED_T);

    let type: IrType;
    if (dyn !== null) type = dyn;
    else {
      const arms = [...byKey.values()];
      if (arms.length === 0) {
        return { ok: false, bail: `field '${f.name}' has no typeable write` };
      }
      type = arms.length === 1
        ? arms[0]!
        : { kind: "union", unionId: d.internUnion(
            arms.sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1))) };
    }

    slots.push({ name: f.name, type, initializer: f.init });
    fields.set(f.name, type);
  }

  return { ok: true, slots, fields };
}
