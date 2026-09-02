/* Unit tests for the prototype-class slot typer.
 *
 * No parser and no Lowerer: TS 7 ships no client-side parser, so the ts7 adapter
 * has no createSourceFile and a test here cannot parse a fixture. It does not
 * need to -- protoSlotTypes never inspects a node, it only hands each one to the
 * injected irTypeOf. So the "expressions" below are unique sentinel objects and
 * the fake checker is a Map lookup, which lets every case state exactly what the
 * checker answered for each write. */

import { describe, expect, it } from "vitest";
import type * as ts from "../ts7/adapter.js";
import { BOOL, DYN, F64, type IrType, STRING, UNDEFINED_T, typeKey } from "../../ir/nodes.js";
import { type SlotDeps, protoSlotTypes } from "./proto-class-synth.js";
import type { ProtoClass, ProtoField } from "./proto-class.js";

const NULL_T: IrType = { kind: "nullT" };

/** A fake union registry with the real interner's identity: the sorted arm list.
 * Ids are strings because IrType's unionId is. */
function fakeDeps(types: Map<unknown, IrType>): SlotDeps & { unions: Map<string, IrType[]> } {
  const unions = new Map<string, IrType[]>();
  return {
    unions,
    irTypeOf: (n) => {
      const t = types.get(n);
      if (t === undefined) throw new Error("test bug: no type registered for node");
      return t;
    },
    unionArms: (id) => unions.get(id),
    internUnion: (arms) => {
      const key = arms.map(typeKey).join("|");
      if (!unions.has(key)) unions.set(key, arms);
      return key;
    },
  };
}

let seq = 0;
/** A sentinel standing in for an expression node. Identity is all that matters. */
function node(): ts.Expression {
  return { __probe: ++seq } as unknown as ts.Expression;
}

function field(name: string, opts: { init: ts.Expression; writes?: ts.Expression[]; conditional?: boolean }): ProtoField {
  return {
    name,
    init: opts.init,
    conditional: opts.conditional ?? false,
    reassignedInMethod: (opts.writes?.length ?? 0) > 0,
    methodWrites: opts.writes ?? [],
  };
}

function klass(fields: ProtoField[]): ProtoClass {
  return {
    name: "S",
    scope: {} as ts.Node,
    ctor: {} as ProtoClass["ctor"],
    fields,
    methods: [],
    protoConsts: [],
    statics: [],
    mergedMethods: [],
    bailouts: [],
  };
}

/** Resolve a slot to its arm list, so assertions read in types not union ids. */
function arms(d: { unions: Map<string, IrType[]> }, t: IrType): string[] {
  if (t.kind !== "union") return [typeKey(t)];
  return (d.unions.get(t.unionId) ?? []).map(typeKey);
}

describe("protoSlotTypes", () => {
  it("unions the constructor initializer with every method write", () => {
    // The measured motivating case: the checker answers `number` for this
    // property because it reads the initializer alone, and the method write of
    // null would then violate the slot.
    const init = node(), write = node();
    const d = fakeDeps(new Map([[init, F64], [write, NULL_T]]));
    const r = protoSlotTypes(d, klass([field("pos", { init, writes: [write] })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(arms(d, r.slots[0]!.type).sort()).toEqual([typeKey(F64), typeKey(NULL_T)].sort());
  });

  it("collapses to the bare type when every write agrees", () => {
    // Reader.pos's real shape: sixteen writes, all number. A one-arm union would
    // be a distinct interned type holding exactly the same values.
    const init = node();
    const writes = Array.from({ length: 16 }, () => node());
    const m = new Map<unknown, IrType>([[init, F64]]);
    for (const w of writes) m.set(w, F64);
    const d = fakeDeps(m);
    const r = protoSlotTypes(d, klass([field("pos", { init, writes })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots[0]!.type).toEqual(F64);
    expect(d.unions.size).toBe(0);
  });

  it("flattens a union write instead of nesting it", () => {
    // The interner's identity is the sorted arm list, so a nested union interns
    // as a DISTINCT type holding exactly the same values.
    const init = node(), write = node();
    const d = fakeDeps(new Map<unknown, IrType>());
    const inner: IrType = { kind: "union", unionId: d.internUnion([STRING, NULL_T]) };
    (d as { irTypeOf: SlotDeps["irTypeOf"] }).irTypeOf = ((n: unknown) =>
      n === init ? BOOL : inner) as SlotDeps["irTypeOf"];
    const r = protoSlotTypes(d, klass([field("buf", { init, writes: [write] })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(arms(d, r.slots[0]!.type).sort())
      .toEqual([typeKey(BOOL), typeKey(STRING), typeKey(NULL_T)].sort());
  });

  it("admits undefined for a conditionally assigned field", () => {
    // Assigned under a branch: an instance that skips it reads undefined in
    // Node, so a slot that cannot hold undefined misdescribes the shape.
    const init = node();
    const d = fakeDeps(new Map([[init, F64]]));
    const r = protoSlotTypes(d, klass([field("opt", { init, conditional: true })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(arms(d, r.slots[0]!.type).sort())
      .toEqual([typeKey(F64), typeKey(UNDEFINED_T)].sort());
  });

  it("refuses a write whose type has no fixed slot layout", () => {
    const init = node(), write = node();
    const d = fakeDeps(new Map<unknown, IrType>([[init, F64], [write, { kind: "jsval" }]]));
    const r = protoSlotTypes(d, klass([field("x", { init, writes: [write] })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.bail).toContain("jsval");
    expect(r.bail).toContain("'x'");
  });

  it("lets dyn absorb the slot rather than nesting it in a union", () => {
    const init = node(), write = node();
    const d = fakeDeps(new Map<unknown, IrType>([[init, BOOL], [write, DYN]]));
    const r = protoSlotTypes(d, klass([field("v", { init, writes: [write] })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots[0]!.type).toEqual(DYN);
  });

  it("keeps declaration order and mirrors slots into the field map", () => {
    const a = node(), b = node();
    const d = fakeDeps(new Map([[a, F64], [b, STRING]]));
    const r = protoSlotTypes(d, klass([field("first", { init: a }), field("second", { init: b })]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.slots.map((s) => s.name)).toEqual(["first", "second"]);
    expect(r.fields.get("second")).toEqual(STRING);
  });
});
