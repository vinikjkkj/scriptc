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
import { ownMaskBit, ownMaskBytes, ownMaskKeyBit, type IrFunction, type IrModule } from "../src/ir/nodes.js";
import { ownPresentCondC } from "../src/backend/emission/emit-shapes.js";
import { emitOwnPresentLl } from "../src/backend/llvm/shapes.js";
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
