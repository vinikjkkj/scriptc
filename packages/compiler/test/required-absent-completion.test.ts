/* THE COMPLETED LITERAL — what `{} as Record<K, V>` is allowed to leave out.
 *
 * `{} as Record<AbPropName, AbPropConfigEntry>` is the accumulator spelling
 * TypeScript forces on a bag keyed by a literal union, and it was the last
 * refusal standing between zapo-js 1.8.2 and a binary. The literal names no
 * field; the shape declares 1,900 REQUIRED ones. Completing them in the SLOT
 * is impossible by definition — a required field's type has no value that
 * means "absent" — so before this the pair simply declined.
 *
 * The per-instance OWN-KEY MASK is where the fact goes instead. The literal
 * omits the field, its bit stays clear, and every enumeration surface then
 * answers what Node answers for `{}`: no such key. Three properties make
 * that a fix rather than a trade, and this file pins each of them.
 *
 *   THE MASK WRITER IS AT THE CONSTRUCTION, AND THERE IS ONE. A partial
 *     literal of a `reqabsent` shape must carry `ownmask`; a literal that
 *     names every field must not. The invariant test below walks EVERY
 *     recordLit in a module rather than the ones this file remembered to
 *     write, so a future construction path that produced a partial literal
 *     without the flag fails here instead of shipping an Object.keys that
 *     answers a key the object does not have.
 *
 *   THE CROSSING POPULATION IS UNTOUCHED. OWNMASK_COMPLETED separates the
 *     two reasons an instance can carry a mask. Both ENUMERATE from the
 *     bits — a crossing and a completion agree there — but they part on the
 *     READ: a clear bit on a crossing means the source INHERITED the member
 *     and the slot holds the value JS would return, while a clear bit on a
 *     completion means the slot was never written at all. Only the second
 *     may throw, and only shapes a completion targeted carry `reqabsent`.
 *
 * ORDER IS THE ONE THING THIS DOES NOT DECIDE, and the boundary is worth
 * writing down. A record enumerates in its shape's declared order and
 * JavaScript enumerates in per-object INSERTION order; reconcileKeyOrders
 * makes them agree wherever the walk can read the spelling, and the
 * presence walk refuses a STATIC fill whose order disagrees (pinned
 * below). A RUN-TIME key is the case neither can see, and it is a
 * PRE-EXISTING hazard rather than one the completion adds: measured on
 * this box, the OPTIONAL spelling that compiles on main today
 *
 *     const view = {} as Record<Name, Entry | undefined>
 *     for (const k of ["omega","alpha","zeta","mid"]) view[k] = ...
 *     Object.keys(view)
 *
 * answers ["alpha","mid","omega","zeta"] where node answers
 * ["omega","alpha","zeta","mid"], silently, at exit 0. The required
 * spelling this file adds behaves the same way and no worse.
 *
 * A fence over every run-time-keyed write was built, measured, and taken
 * back out: it refused tests/corpus/7793, which fills by run-time key from
 * `Object.entries(SOURCE)` and is CORRECT — the fill order there is the
 * SOURCE shape's enumeration order, which agrees with the target's.
 * Refusing a program that answers exactly what node answers is worse than
 * the class it guards. What would close it properly is the comparison that
 * program makes true: the fill order IS knowable when the key comes from
 * an enumeration of a record (that shape's declaredOrder) or from a
 * literal array of literal-typed elements, so the rule is to compare THAT
 * order against the target's declaredOrder and refuse only a provable
 * disagreement.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { emitModule } from "../src/backend/emission/emitter.js";
import { emitLlvmModule } from "../src/backend/llvm/emitter.js";
import { validateModule } from "../src/ir/validate.js";
import {
  OWNMASK_COMPLETED,
  OWNMASK_VALID,
  ownMaskKeyBit,
  type IrExpr,
  type IrModule,
  type IrRecordShape,
} from "../src/ir/nodes.js";

function lower(source: string): { module: IrModule | null; codes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-reqabsent-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    return { module: r.module, codes: r.diagnostics.map((d) => d.code) };
  } finally {
    load.dispose();
  }
}

function lowerOk(source: string): IrModule {
  const r = lower(source);
  if (r.module === null) throw new Error(`lowering refused: ${r.codes.join(", ")}`);
  return r.module;
}

/** Every recordLit in the module, with its shape, its written field names
 * and whether it establishes the mask. */
function recordLits(mod: IrModule): { shapeId: string; fields: string[]; ownmask: boolean }[] {
  const out: { shapeId: string; fields: string[]; ownmask: boolean }[] = [];
  const seen = new Set<object>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    const e = n as IrExpr;
    if (e.kind === "recordLit" && e.type.kind === "record") {
      out.push({
        shapeId: e.type.shapeId,
        fields: e.fields.filter((f) => !f.overflow && !f.drop).map((f) => f.name),
        ownmask: e.ownmask === true,
      });
    }
    for (const v of Object.values(n as Record<string, unknown>)) walk(v);
  };
  walk(mod);
  return out;
}

function shape(mod: IrModule, id: string): IrRecordShape {
  const s = (mod.records ?? []).find((r) => r.id === id);
  if (!s) throw new Error(`no shape ${id}`);
  return s;
}

/** THE INVARIANT, over the WHOLE module: on a shape a completion targeted,
 * every construction either names every declared field or establishes the
 * mask. Asserted by walking the IR, so it covers construction paths this
 * file never thought to write. */
function assertEveryConstructionIsAccountedFor(mod: IrModule): void {
  const completed = new Set((mod.records ?? []).filter((r) => r.reqabsent === true).map((r) => r.id));
  expect(completed.size).toBeGreaterThan(0);
  for (const lit of recordLits(mod)) {
    if (!completed.has(lit.shapeId)) continue;
    const declared = shape(mod, lit.shapeId).fields.length;
    if (lit.fields.length === declared) {
      // A total literal needs no mask: byte 0 stays zero and every surface
      // falls back to the undefined-arm rule, which is right when every
      // slot was written.
      expect(lit.ownmask).toBe(false);
      continue;
    }
    expect(lit.ownmask).toBe(true);
  }
}

/* -- the shape flags --------------------------------------------------- */

test("a literal that omits a REQUIRED field arms the mask and marks the shape", () => {
  const mod = lowerOk(`
type Name = "a" | "b";
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
view["a"] = { code: 1 };
console.log(view.a.code);
`);
  const target = (mod.records ?? []).find((r) => r.reqabsent === true);
  expect(target).toBeDefined();
  expect(target!.fields.map((f) => f.name)).toEqual(["a", "b"]);
  // `reqabsent` never travels alone: the mask is where the fact lives, and
  // the source-prototype slot arms with the mask as it always has.
  expect(target!.ownmask).toBe(true);
  assertEveryConstructionIsAccountedFor(mod);
});

test("a shape only a CROSSING armed carries the mask and NOT reqabsent", () => {
  // The separation the read trap depends on. A dynCheck target's clear bit
  // means "inherited", whose value the read must still return.
  const mod = lowerOk(`
interface Entry { readonly code: number; readonly kind: string }
const raw: unknown = JSON.parse('{"code":1,"kind":"k"}');
const e = raw as Entry;
console.log(Object.keys(e).length, e.code);
`);
  const armed = (mod.records ?? []).filter((r) => r.ownmask === true);
  expect(armed.length).toBeGreaterThan(0);
  for (const r of armed) expect(r.reqabsent).toBeUndefined();
});

test("a literal that names EVERY field leaves the mask alone", () => {
  const mod = lowerOk(`
interface Entry { readonly code: number; readonly kind: string }
const e: Entry = { code: 1, kind: "k" };
console.log(e.code, e.kind);
`);
  expect((mod.records ?? []).some((r) => r.reqabsent === true)).toBe(false);
  for (const lit of recordLits(mod)) expect(lit.ownmask).toBe(false);
});

/* -- the invariant, over every construction path ----------------------- */

test("EVERY construction of a completed shape is accounted for", () => {
  // Four constructions of ONE shape in one program: the completed literal,
  // a total literal, a nested completed literal inside another literal, and
  // a literal built inside a function the walk reaches later. The assertion
  // walks the IR, so a construction path added tomorrow that produced a
  // partial literal without the flag fails HERE — which is the whole point
  // of asserting over the module instead of over a list of cases.
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
type Bag = Record<Name, Entry>;
const partial = {} as Bag;
partial["a"] = { code: 1 };
const total: Bag = { a: { code: 1 }, b: { code: 2 }, c: { code: 3 } };
function later(): Bag {
  const inner = {} as Bag;
  inner["b"] = { code: 9 };
  return inner;
}
const wrapper = { held: {} as Bag };
console.log(partial.a.code, total.a.code, later().b.code, wrapper.held.b.code);
`);
  assertEveryConstructionIsAccountedFor(mod);
  const target = (mod.records ?? []).find((r) => r.reqabsent === true)!;
  const lits = recordLits(mod).filter((l) => l.shapeId === target.id);
  // Three partial literals and one total one, and every partial carries the
  // flag. If a fifth construction ever appears with no flag the loop above
  // is what catches it; this count is here so a construction that stops
  // being built at all is noticed too.
  expect(lits.filter((l) => l.ownmask).length).toBe(3);
  expect(lits.filter((l) => !l.ownmask).length).toBe(1);
});

/* -- the emitted mask, on both backends -------------------------------- */

test("the completed literal writes VALID|COMPLETED on both tiers, and a WRITE hands a bit back", () => {
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
view["b"] = { code: 2 };
console.log(view.b.code);
`);
  expect(validateModule(mod)).toEqual([]);
  const target = (mod.records ?? []).find((r) => r.reqabsent === true)!;
  const c = emitModule(mod);
  // Byte 0 carries BOTH facts: the surfaces read the bits (VALID), and the
  // READ knows a clear bit means "never written" rather than "inherited"
  // (COMPLETED).
  expect(c).toContain(`sc_own[0] = ${OWNMASK_VALID | OWNMASK_COMPLETED};`);
  // The literal writes NO field here. A key the walk can SPELL lowers to
  // recordSet, whose bit-set predates this work and is what makes the
  // completed value usable at all.
  const bitB = ownMaskKeyBit(target, "b")!;
  expect(c).toContain(`sc_own[${bitB.byte}] |= ${bitB.bit}; /* a write is an own key */`);
  const ll = emitLlvmModule(mod);
  expect(ll).toContain(`store i8 ${OWNMASK_VALID | OWNMASK_COMPLETED}, ptr`);
  expect(ll).toContain("completed literal: the bits are the own keys");
});

test("a RUN-TIME keyed write hands the bit back too, on both tiers", () => {
  // The dynamic-key helper did NOT set the bit before this work, and that
  // is the gap the completion turns from latent into fatal: `{} as
  // Record<K, V>` starts with every bit clear and zapo's own fill is
  // exactly this loop, so without it the value would enumerate EMPTY after
  // being completely filled.
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
const order: Name[] = ["b"];
for (const k of order) { view[k] = { code: 2 }; }
console.log(view.b.code);
`);
  expect(validateModule(mod)).toEqual([]);
  const target = (mod.records ?? []).find((r) => r.reqabsent === true)!;
  const bitB = ownMaskKeyBit(target, "b")!;
  const c = emitModule(mod);
  expect(c).toContain(`sc_own[${bitB.byte}] |= ${bitB.bit}; /* a keyed write is an own key */`);
  expect(emitLlvmModule(mod)).toContain("own key b");
});

test("a literal that WRITES a field sets that field's bit at construction", () => {
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const view = { a: { code: 1 } } as Record<Name, Entry>;
console.log(view.a.code);
`);
  expect(validateModule(mod)).toEqual([]);
  const target = (mod.records ?? []).find((r) => r.reqabsent === true)!;
  const bitA = ownMaskKeyBit(target, "a")!;
  const c = emitModule(mod);
  expect(c).toContain(`sc_own[${bitA.byte}] |= ${bitA.bit}; /* own key a */`);
  // ...and only that one. `b` and `c` were never written, so their bits
  // stay clear and Object.keys answers what Node answers for the literal.
  const bitB = ownMaskKeyBit(target, "b")!;
  expect(c).not.toContain(`sc_own[${bitB.byte}] |= ${bitB.bit}; /* own key b */`);
});

/* -- the READ, and who it may throw for -------------------------------- */

test("a required read on a completed shape asks the bit; a crossing's read does not", () => {
  const completed = lowerOk(`
type Name = "a" | "b"
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
view["a"] = { code: 1 };
console.log(view.b.code);
`);
  const c = emitModule(completed);
  expect(c).toContain("SC9005");
  expect(c).toContain(`& ${OWNMASK_COMPLETED})`);
  expect(emitLlvmModule(completed)).toContain("SC9005");

  // The same read on a shape only a CROSSING armed emits no check at all:
  // there a clear bit is an inherited member and the slot is its value.
  const crossed = lowerOk(`
interface Entry { readonly code: number; readonly kind: string }
const raw: unknown = JSON.parse('{"code":1,"kind":"k"}');
const e = raw as Entry;
console.log(Object.keys(e).length, e.code);
`);
  expect(emitModule(crossed)).not.toContain("SC9005");
  expect(emitLlvmModule(crossed)).not.toContain("SC9005");
});

test("an OPTIONAL field on a completed shape keeps the undefined arm and no trap", () => {
  // The slot can carry "absent" here, so there is nothing for the mask to
  // add and nothing for the read to check — the completion is only ever
  // about the fields that have no arm.
  const mod = lowerOk(`
type Name = "a" | "b"
interface Entry { readonly code: number }
interface Bag { a: Entry; b: Entry; note?: string }
const view = {} as Bag;
view.a = { code: 1 };
console.log(view.note ?? "none");
`);
  const c = emitModule(mod);
  // `note` is read, and its read is a plain load: the arm is the answer.
  expect(c.split("SC9005").length - 1).toBe(0);
});

/* -- the gate: what the completion still declines ---------------------- */

test("a field whose slot zero is not inert keeps the shape mismatch", () => {
  // The completion claims exactly one thing about the SLOT: the allocator's
  // zero is inert for the RC and trace walkers. A `void`-typed member is
  // outside that claim, and the refusal stands rather than guessing.
  const r = lower(`
type Name = "a" | "b"
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
const t = view as unknown as { a: Entry; b: Entry; c: void };
console.log(t.a.code);
`);
  // Either the checker or the lowerer refuses this; what must NOT happen is
  // a module in which a void-slotted field was completed.
  if (r.module !== null) {
    for (const rec of r.module.records ?? []) {
      if (rec.reqabsent !== true) continue;
      expect(rec.fields.every((f) => f.type.kind !== "void")).toBe(true);
    }
  }
});

/* -- `in`, which is a DIFFERENT question from own-ness ------------------ */

test("`in` over a required field asks the COMPLETED bit, not the own bit", () => {
  // `in` is "own OR INHERITED", so the two populations that carry a mask
  // answer a clear bit oppositely and recordKeyPresent is the wrong node
  // here. This was a real miss: the corpus program built for this work
  // answered `true` for `"alpha" in ({} as Record<Name, Entry>)` where Node
  // answers false, and only running it found that.
  const mod = lowerOk(`
type Name = "a" | "b";
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
view.a = { code: 1 };
console.log("a" in view, "b" in view);
`);
  expect(validateModule(mod)).toEqual([]);
  const c = emitModule(mod);
  expect(c).toContain(`& ${OWNMASK_COMPLETED})`);
  expect(emitLlvmModule(mod)).toContain("slot-filled");
});

test("`in` on a shape NO completion targeted keeps its static answer", () => {
  // The fold this replaced. A program with no completed literal must emit
  // exactly what it emitted before: the guard installs only for the shapes
  // requiredAbsentTargets names.
  const mod = lowerOk(`
interface Entry { readonly code: number; readonly kind: string }
const e: Entry = { code: 1, kind: "k" };
console.log("code" in e);
`);
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    const k = (n as { kind?: unknown }).kind;
    if (typeof k === "string") found.push(k);
    for (const v of Object.values(n as Record<string, unknown>)) walk(v);
  };
  walk(mod);
  expect(found).not.toContain("recordSlotFilled");
});

/* -- the WALKERS, which read the slot before they ask ------------------- */

test("the record-to-dyn walker asks before it loads, on both tiers", () => {
  // Found by RUNNING, not by reading: `const u: unknown = bag` over a
  // partly-filled completed record was an ACCESS VIOLATION on both tiers,
  // because the walker converts the field and tests the mask afterwards.
  // The guard has to be above the LOAD, not above the store.
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const bag = {} as Record<Name, Entry>;
bag.a = { code: 1 };
const u: unknown = bag;
console.log(JSON.stringify(u));
`);
  expect(validateModule(mod)).toEqual([]);
  const c = emitModule(mod);
  expect(c).toContain("the completed literal may never have written this slot");
  expect(emitLlvmModule(mod)).toContain("completed?");
});

test("the inspect renderer asks before it renders", () => {
  // `console.log(bag)` walks every declared field and renders its VALUE;
  // the same access violation, one helper over.
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const bag = {} as Record<Name, Entry>;
bag.a = { code: 1 };
console.log(bag);
`);
  expect(validateModule(mod)).toEqual([]);
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    const k = (n as { kind?: unknown }).kind;
    if (typeof k === "string") found.push(k);
    for (const v of Object.values(n as Record<string, unknown>)) walk(v);
  };
  walk(mod);
  expect(found).toContain("recordSlotFilled");
});

test("Object.assign's keyed walk copies only the source's OWN keys", () => {
  // recordAssignHelper always asked; its index-signature twin never did,
  // which made `Object.assign(t, bag)` throw where Node copies the one key
  // the value has. The same gap answered a CROSSED record's inherited
  // members as own keys, so this closes two populations at once.
  const mod = lowerOk(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const bag = {} as Record<Name, Entry>;
bag.a = { code: 1 };
const t: Record<string, Entry> = {};
Object.assign(t, bag);
console.log(JSON.stringify(Object.keys(t)));
`);
  expect(validateModule(mod)).toEqual([]);
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { for (const x of n) walk(x); return; }
    const k = (n as { kind?: unknown }).kind;
    if (typeof k === "string") found.push(k);
    for (const v of Object.values(n as Record<string, unknown>)) walk(v);
  };
  walk(mod);
  expect(found).toContain("recordKeyPresent");
});

test("a SPREAD of a completed value refuses instead of answering", () => {
  // The one whole-shape copy with nowhere to put "absent": the spread
  // builds a literal whose field list is fixed at compile time. Refused
  // rather than trapped at run time, and refused only for the shapes a
  // completion actually targeted - which is why it is judged after the
  // walk rather than at the spread.
  const r = lower(`
type Name = "a" | "b" | "c";
interface Entry { readonly code: number }
const bag = {} as Record<Name, Entry>;
bag.a = { code: 1 };
const copy = { ...bag };
console.log(JSON.stringify(copy));
`);
  expect(r.module).toBeNull();
  expect(r.codes).toContain("SC1090");
});

test("a spread of a shape NO completion targeted still compiles", () => {
  const mod = lowerOk(`
interface Entry { readonly code: number; readonly kind: string }
const e: Entry = { code: 1, kind: "k" };
const copy = { ...e };
console.log(copy.code, copy.kind);
`);
  expect(validateModule(mod)).toEqual([]);
});

/* -- key ORDER ---------------------------------------------------------- */

test("a STATIC-key fill is judged key by key, and only the disagreeing order refuses", () => {
  // The completed value's own keys enumerate in the SHAPE's declared order
  // filtered by the bits, and Node's are the insertion order. The existing
  // presence-order walk already compares the two whenever the keys are
  // spelled, and it does not need to know a completion happened.
  //
  // Agreeing (declared "alpha,mid,omega,zeta"; written mid then zeta):
  // measured, both answer ["mid","zeta"].
  const ok = lower(`
type Name = "zeta" | "alpha" | "mid" | "omega";
interface Entry { readonly code: number }
const part = {} as Record<Name, Entry>;
part["mid"] = { code: 1 };
part["zeta"] = { code: 2 };
console.log(JSON.stringify(Object.keys(part)));
`);
  expect(ok.module).not.toBeNull();

  // Disagreeing (written zeta then mid): node answers ["zeta","mid"] and
  // the filtered declared order is ["mid","zeta"], so it refuses.
  const bad = lower(`
type Name = "zeta" | "alpha" | "mid" | "omega";
interface Entry { readonly code: number }
const part = {} as Record<Name, Entry>;
part["zeta"] = { code: 1 };
part["mid"] = { code: 2 };
console.log(JSON.stringify(Object.keys(part)));
`);
  expect(bad.module).toBeNull();
  expect(bad.codes).toContain("SC1090");
});

test("a RUN-TIME-key fill compiles, and the invariant still covers it", () => {
  // zapo's own shape, and tests/corpus/7793's: the value is completed, then
  // filled through a key the walk cannot spell, then used. The mask makes
  // the KEY SET exact at every point in between (the corpus program checks
  // that against node); the key ORDER is the pre-existing hazard this file's
  // header states and does not close.
  const mod = lowerOk(`
type Name = "zeta" | "alpha" | "mid" | "omega";
interface Entry { readonly code: number }
const view = {} as Record<Name, Entry>;
const order: Name[] = ["omega", "alpha", "zeta", "mid"];
for (const k of order) { view[k] = { code: 1 }; }
console.log(view.zeta.code);
`);
  assertEveryConstructionIsAccountedFor(mod);
});

test("the corpus-7793 shape - a run-time key off another record's entries - still compiles", () => {
  // The program the withdrawn fence refused. Its fill order IS the source
  // shape's enumeration order, so it answers exactly what node answers, and
  // a rule that refused it would be refusing a correct program.
  const mod = lowerOk(`
type Name = "alpha" | "beta" | "gamma";
interface Entry { readonly code: number }
const SOURCE: Record<Name, Entry> = { alpha: { code: 1 }, beta: { code: 2 }, gamma: { code: 3 } };
function view(): Record<Name, Entry> {
  const out = {} as Record<Name, Entry>;
  for (const [name, entry] of Object.entries(SOURCE)) { out[name as Name] = entry; }
  return out;
}
console.log(JSON.stringify(Object.keys(view())));
`);
  assertEveryConstructionIsAccountedFor(mod);
});
