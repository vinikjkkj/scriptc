/* THE OWN-KEY MASK — what a checked cast is allowed to forget.
 *
 * A dynCheck MATERIALISES a record out of a dynamic value by READING every
 * declared member, and a read is JS's [[Get]]: own data, else the PROTOTYPE
 * chain. That widening was deliberate (an own-only read made every inherited
 * member invisible, so protobufjs's Long and every JS class stopped matching
 * a record arm), and it is also how a prototype-carried DEFAULT ends up in a
 * struct slot. Every own-key surface then reads the slot and answers
 * "present", so `Object.keys(message)` listed ~200 keys where Node listed
 * one — 1,790 of the 1,794 payload leaf differences on a paired zapo run.
 *
 * The slot cannot carry both facts. `{a?: T}` and `{a: T | undefined}` intern
 * to ONE shape (per-instance-keys.test.ts), so the undefined arm is a
 * record's only presence signal and it is a fact about the VALUE: writing
 * "absent" there for an inherited member fixes Object.keys and breaks the
 * read. IrRecordShape.ownmask separates them — the slot keeps the value, a
 * trailing byte array carries the own-ness — and this file pins the three
 * properties that make it shippable rather than another trade:
 *
 *   ARMED ONLY WHERE IT CAN MATTER. A shape no dynCheck materialises does
 *     not carry the mask, so its struct and its surfaces are byte-identical
 *     to before.
 *   ADDITIVE AT THE SURFACES. An unarmed shape's Object.keys helper still
 *     guards on the undefined arm — the exact node
 *     record-presence-two-surfaces.test.ts pins.
 *   ORDER-INDEPENDENT. Arming happens after the whole walk, so a cast that
 *     appears BELOW the enumeration arms the shape just the same.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { nullProtoRule, OWNMASK_SRC_NULL_PROTO, OWNMASK_VALID, ownMaskBit, ownMaskBytes, ownMaskKeyBit, STRING, type IrFunction, type IrModule } from "../src/ir/nodes.js";
import { nullProtoCondC, ownPresentCondC } from "../src/backend/emission/emit-shapes.js";
import { emitOwnPresentLl, ownMaskSlotIndex, srcProtoSlotIndex } from "../src/backend/llvm/shapes.js";
import { BlockBuilder } from "../src/backend/llvm/blocks.js";

function lower(source: string): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-ownmask-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) {
      throw new Error(
        `lowering refused: ${r.diagnostics.map((d) => `${d.code} ${d.message}`).join("; ")}`,
      );
    }
    return r.module;
  } finally {
    load.dispose();
  }
}

/** Every node of `n` whose `kind` is `kind`, in walk order. */
function nodesOfKind(n: unknown, kind: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<object>();
  const walk = (x: unknown): void => {
    if (x === null || typeof x !== "object") return;
    if (seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    const o = x as Record<string, unknown>;
    if (o["kind"] === kind) out.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(n);
  return out;
}

function keysHelper(mod: IrModule): IrFunction | undefined {
  return mod.functions.find(
    (f) => f.name.startsWith("%obj.keys.") && f.params[0]?.type.kind === "record",
  );
}

const SHAPE = `interface M { readonly a: number; readonly b?: number; readonly c?: string }`;

/* -- armed only where a crossing can reach ---------------------------- */

test("a shape NO dynCheck materialises does not carry the mask", () => {
  const mod = lower(`${SHAPE}
const m: M = { a: 1 };
console.log(Object.keys(m).join("|"), JSON.stringify(m));
`);
  expect((mod.records ?? []).length).toBeGreaterThan(0);
  for (const r of mod.records ?? []) expect(r.ownmask).toBeUndefined();
});

test("a shape a checked cast materialises DOES", () => {
  const mod = lower(`${SHAPE}
const m = JSON.parse('{"a":1}') as M;
console.log(Object.keys(m).join("|"));
`);
  const armed = (mod.records ?? []).filter((r) => r.ownmask === true);
  expect(armed.length).toBe(1);
  expect(armed[0]!.fields.some((f) => f.name === "b")).toBe(true);
});

test("an ALL-REQUIRED shape arms too — a required member can be inherited", () => {
  // The first cut of the arming gate asked for an optional member, on the
  // reasoning that a required one always exists. protobufjs's Long is the
  // counterexample: `L.prototype.high = 0` makes `high` a member the cast
  // finds and Object.keys must not list.
  const mod = lower(`interface Long { low: number; high: number; unsigned: boolean }
const m = JSON.parse('{"low":1,"high":0,"unsigned":false}') as Long;
console.log(Object.keys(m).join("|"));
`);
  expect((mod.records ?? []).filter((r) => r.ownmask === true).length).toBe(1);
});

test("a TUPLE is never armed — positional arity, no key set", () => {
  const mod = lower(`const t = JSON.parse('[1,"a"]') as [number, string];
console.log(String(t[0]), t[1]);
`);
  const tuples = (mod.records ?? []).filter((r) => r.tuple === true);
  expect(tuples.length).toBeGreaterThan(0);
  for (const r of tuples) expect(r.ownmask).toBeUndefined();
});

test("a NESTED record field arms too — the builder recurses into it", () => {
  // The first cut armed the cast's target and its union arms and array
  // elements, and not its FIELDS. On zapo that left the top-level message
  // keys right and `message.protocolMessage` still listing all 108 of its
  // own: 290 of the 295 remaining payload differences, from one missing
  // line of walk.
  const mod = lower(`interface Inner { a: number; b?: string }
interface Outer { name: string; inner: Inner }
const m = JSON.parse('{"name":"x","inner":{"a":1}}') as Outer;
console.log(Object.keys(m).join("|"), Object.keys(m.inner).join("|"));
`);
  const armed = (mod.records ?? []).filter((r) => r.ownmask === true);
  expect(armed.length).toBe(2);
  expect(armed.some((r) => r.fields.some((f) => f.name === "inner"))).toBe(true);
  expect(armed.some((r) => r.fields.some((f) => f.name === "b"))).toBe(true);
});

test("a SELF-REFERENTIAL shape arms without recursing forever", () => {
  const mod = lower(`interface Node2 { v: number; next?: Node2 }
const n = JSON.parse('{"v":1}') as Node2;
console.log(Object.keys(n).join("|"));
`);
  expect((mod.records ?? []).filter((r) => r.ownmask === true).length).toBe(1);
});

test("a cast to an ARRAY of records arms the element shape (the builder is the same one)", () => {
  const mod = lower(`${SHAPE}
const ms = JSON.parse('[{"a":1}]') as M[];
console.log(String(ms.length));
`);
  expect((mod.records ?? []).filter((r) => r.ownmask === true).length).toBe(1);
});

/* -- additive at the surfaces ------------------------------------------ */

test("an UNARMED shape's Object.keys helper still guards on the undefined arm", () => {
  // record-presence-two-surfaces.test.ts's node, unchanged: nothing about
  // this program's IR moved.
  const mod = lower(`${SHAPE}
const m: M = { a: 1 };
console.log(Object.keys(m).join("|"));
`);
  const keys = keysHelper(mod);
  expect(keys).toBeDefined();
  expect(nodesOfKind(keys!.body, "unionIsTag").length).toBe(2);
  expect(nodesOfKind(keys!.body, "recordKeyPresent").length).toBe(0);
});

test("an ARMED shape's Object.keys helper asks the own-key question instead", () => {
  const mod = lower(`${SHAPE}
const m = JSON.parse('{"a":1}') as M;
console.log(Object.keys(m).join("|"));
`);
  const keys = keysHelper(mod);
  expect(keys).toBeDefined();
  // Three declared fields, three own-key questions — the REQUIRED one too:
  // a member the source object merely inherited is not its own key whether
  // or not the type says the member always exists.
  expect(nodesOfKind(keys!.body, "recordKeyPresent").length).toBe(3);
  expect(nodesOfKind(keys!.body, "unionIsTag").length).toBe(0);
});

/* -- order-independent -------------------------------------------------- */

test("the cast may appear BELOW the enumeration and the shape still arms", () => {
  const mod = lower(`${SHAPE}
function show(m: M): string { return Object.keys(m).join("|"); }
const built: M = { a: 1 };
console.log(show(built));
const parsed = JSON.parse('{"a":1}') as M;
console.log(show(parsed));
`);
  const armed = (mod.records ?? []).filter((r) => r.ownmask === true);
  expect(armed.length).toBe(1);
  const keys = keysHelper(mod);
  expect(keys).toBeDefined();
  expect(nodesOfKind(keys!.body, "recordKeyPresent").length).toBe(3);
});

/* -- an INTERNAL SLOT is never masked; a '%'-SPELLED key is ------------- */

test("an internal slot is exempt from the mask on BOTH backends", () => {
  // declaredOrder omits an internal slot, every key surface hides it, and
  // the record→dyn walker sends it to ScrDyn's slot table so a
  // record→dyn→record round trip keeps its data (Dirent's %dtype).
  // Masking one would DELETE it on every crossing of a record a dynCheck
  // built, because the builder never stamps its bit either — found by
  // reading the diff, not by a failing test, which is why it has one now.
  const shape = {
    id: "r0",
    ownmask: true as const,
    declaredOrder: ["a"],
    fields: [{ name: "a" }, { name: "%dtype" }],
  };
  expect(ownPresentCondC(shape, "%dtype", "v", -1, false)).toBeNull();
  expect(ownPresentCondC(shape, "a", "v", -1, false)).not.toBeNull();
  const B = new BlockBuilder();
  expect(emitOwnPresentLl(B as never, shape as never, "%dtype", "%v", -1, false)).toBeNull();
  expect(emitOwnPresentLl(B as never, shape as never, "a", "%v", -1, false)).not.toBeNull();
});

test("a user's own '%'-spelled KEY is masked like any other key", () => {
  // The version of the test above that this replaces asked
  // f.name.startsWith("%"), and it passed. It was wrong, and the merge
  // with the internal-slot work is what showed it: '%' is a legal first
  // character of a JavaScript property name, so a user's own
  // { "%dtype": 7, name: "n" } IS in its shape's declaredOrder and IS an
  // ordinary key. Exempting it by SPELLING left the builder never
  // stamping its bit while the record→dyn walker masked the key anyway —
  // which demotes it to the prototype on every crossing, silently, and
  // only in the one namespace nobody would think to look at.
  //
  // internalFieldNamesOf is the distinction that already existed, and it
  // is a per-SHAPE fact rather than a per-NAME one.
  const own = {
    id: "r1",
    ownmask: true as const,
    declaredOrder: ["%dtype", "name"],
    fields: [{ name: "%dtype" }, { name: "name" }],
  };
  expect(ownPresentCondC(own, "%dtype", "v", -1, false)).not.toBeNull();
  const B = new BlockBuilder();
  expect(emitOwnPresentLl(B as never, own as never, "%dtype", "%v", -1, false)).not.toBeNull();
  // The two shapes differ only in declaredOrder, and that is the whole
  // difference — ownMaskKeyBit answers opposite ways for the same name.
  expect(ownMaskKeyBit(own, "%dtype")).not.toBeNull();
  expect(ownMaskKeyBit({ ...own, declaredOrder: ["name"] }, "%dtype")).toBeNull();
});

/* -- the layout, stated once ------------------------------------------- */

test("the mask is one validity byte plus one bit per field, and the bits do not overlap", () => {
  const shape = { fields: Array.from({ length: 17 }, (_, i) => ({ name: `f${i}` })) };
  expect(ownMaskBytes(shape)).toBe(1 + 3);
  expect(ownMaskBit(shape, "f0")).toEqual({ byte: 1, bit: 1 });
  expect(ownMaskBit(shape, "f7")).toEqual({ byte: 1, bit: 128 });
  expect(ownMaskBit(shape, "f8")).toEqual({ byte: 2, bit: 1 });
  expect(ownMaskBit(shape, "f16")).toEqual({ byte: 3, bit: 1 });
  expect(ownMaskBit(shape, "nope")).toBeNull();
  const seen = new Set<string>();
  for (const f of shape.fields) {
    const b = ownMaskBit(shape, f.name)!;
    const key = `${b.byte}:${b.bit}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }
  // Byte 0 is the validity flag and no field may claim it.
  for (const f of shape.fields) expect(ownMaskBit(shape, f.name)!.byte).toBeGreaterThan(0);
});

/* -- byte 0 carries the CROSSING's own facts, not any one field's ------ */

test("byte 0's second bit is the source object's [[Prototype]]-is-null fact, and no field may claim it", () => {
  // The two bits of byte 0 are disjoint from every field bit by
  // construction (field bits start at byte 1, pinned above), so the only
  // thing to state here is that the two constants really are the low two
  // bits of ONE byte and that the arming they gate is the same arming.
  expect(OWNMASK_VALID).toBe(1);
  expect(OWNMASK_SRC_NULL_PROTO).toBe(2);
  expect(OWNMASK_VALID & OWNMASK_SRC_NULL_PROTO).toBe(0);
});

test("a shape no crossing armed folds its null-prototype claim at compile time", () => {
  // The claim is a per-SHAPE constant when nothing can contradict it, so a
  // module with no crossing emits exactly the literal it always emitted.
  const plain = { fields: [{ name: "uid" }] };
  expect(nullProtoRule(plain)).toEqual({ kind: "const", value: false });
  expect(nullProtoRule({ ...plain, builtin: { nullProto: true as const } }))
    .toEqual({ kind: "const", value: true });
  expect(nullProtoCondC(plain, "v")).toBe("false");
  expect(nullProtoCondC({ ...plain, builtin: { nullProto: true as const } }, "v")).toBe("true");
});

test("an ARMED shape asks the INSTANCE, and keeps the claim for one no crossing wrote", () => {
  // This is the whole repair. Retracting the claim for the entire armed
  // shape made os.userInfo()'s own result print plain AND — through the
  // record→dyn walker's twin of this decision, which ScrDyn.null_proto
  // feeds and deepStrictEqual gates on — made
  // `deepStrictEqual(os.userInfo(), {…the same five members…})` compare
  // EQUAL where Node throws. Corpus 5880 is the program.
  const armed = { fields: [{ name: "uid" }], ownmask: true as const, builtin: { nullProto: true as const } };
  expect(nullProtoRule(armed)).toEqual({ kind: "instance", claim: true });
  const cond = nullProtoCondC(armed, "v");
  // an instance NO crossing wrote falls back to the shape's own claim...
  expect(cond).toContain("sc_own[0] ?");
  expect(cond.endsWith(": true)")).toBe(true);
  // ...and one a crossing DID write answers from the bit the builder
  // stamped off the source object.
  expect(cond).toContain(`& ${OWNMASK_SRC_NULL_PROTO}`);
  // A shape with no builtin claim at all still asks, because a crossing
  // out of an Object.create(null) source is a null-prototype instance of
  // an ordinary shape.
  const noClaim = { fields: [{ name: "uid" }], ownmask: true as const };
  expect(nullProtoRule(noClaim)).toEqual({ kind: "instance", claim: false });
  expect(nullProtoCondC(noClaim, "v").endsWith(": false)")).toBe(true);
});

/* -- the SOURCE [[Prototype]] slot: same arming, one more question ----- */

test("the source-prototype slot arms exactly with the mask, and never without it", () => {
  // One arming, because it is the mask that MAKES the slot necessary: the
  // mask lets the record→dyn walker demote an inherited member instead of
  // writing it as an own key, and a demotion with nowhere to demote INTO
  // had to synthesise a fresh prototype per crossing (which is what broke
  // deepStrictEqual's [[Prototype]] identity — corpus 5881).
  const crossed = lower(`${SHAPE}
const m = JSON.parse('{"a":1}') as M;
console.log(Object.keys(m).join("|"));
`);
  const armed = (crossed.records ?? []).filter((r) => r.ownmask === true);
  expect(armed.length).toBe(1);
  for (const r of armed) expect(r.srcproto).toBe(true);

  const plain = lower(`${SHAPE}
const m: M = { a: 1 };
console.log(Object.keys(m).join("|"), JSON.stringify(m));
`);
  expect((plain.records ?? []).length).toBeGreaterThan(0);
  for (const r of plain.records ?? []) expect(r.srcproto).toBeUndefined();
});

test("an index-signature shape arms with NO declared field at all", () => {
  // `Record<string, unknown>` has none, and it is the shape both remaining
  // defects were measured through: the zapo driver's `normalize()` takes an
  // `unknown` parameter and casts it back to exactly this. It takes no
  // field BITS — there are no fields — but byte 0 still carries the
  // crossing's own facts and the shape still carries the source's chain,
  // which is what makes `rec[k]` and `k in rec` answer what JS answers for
  // a member the source only inherited (corpus 5882).
  const mod = lower(`const v: unknown = JSON.parse('{"a":1}');
const rec = v as Record<string, unknown>;
console.log(String(rec["a"]), String("a" in rec));
`);
  const armed = (mod.records ?? []).filter((r) => r.ownmask === true);
  expect(armed.length).toBeGreaterThan(0);
  const pure = armed.filter((r) => r.indexValue !== undefined && r.fields.length === 0);
  expect(pure.length).toBe(1);
  expect(pure[0]!.srcproto).toBe(true);
  // ...and it really is one VALIDITY byte and no field bits.
  expect(ownMaskBytes(pure[0]!)).toBe(1);
});

test("the two hidden slots keep their own struct positions, and neither moves the other", () => {
  // The layout is stated once per backend and the two must agree, so the
  // index arithmetic is pinned here rather than discovered by a segfault.
  const base = { id: "r0", fields: [{ name: "a", type: STRING }, { name: "b", type: STRING }] };
  expect(ownMaskSlotIndex(base as never)).toBe(3);
  expect(srcProtoSlotIndex(base as never)).toBe(3);
  const masked = { ...base, ownmask: true as const };
  expect(ownMaskSlotIndex(masked as never)).toBe(3);
  expect(srcProtoSlotIndex(masked as never)).toBe(4);
  const full = { ...base, ownmask: true as const, tostr: true as const, indexValue: STRING };
  expect(ownMaskSlotIndex(full as never)).toBe(5);
  expect(srcProtoSlotIndex(full as never)).toBe(6);
});
