/* THE PIECE TWO DEBTS WANT - what a record can and cannot say about its own
 * keys, pinned at the level where the answer is decided.
 *
 * Two silent-wrong-value debts converge on one missing thing:
 *
 *   the LISTING half   `{a?: T}` and `{a: T | undefined}` intern to the same
 *                      record shape, so "written undefined" and "never
 *                      written" have ONE representation and the compiler
 *                      must answer them identically. It answers ABSENT.
 *   the ORDER half     toDynHelper is a per-SHAPE helper and one shape serves
 *                      several literal orders, so the crossing answers key
 *                      ORDER from the shape's static table when Node's answer
 *                      is a per-object runtime fact.
 *
 * They ARE one piece at the far end - a per-instance insertion vector answers
 * both, and presence falls out of order (a key not in the vector was never
 * inserted) - but they are NOT one piece at the near end, and these tests pin
 * exactly that asymmetry, because it is what decides what a fix costs:
 *
 *   ORDER survives to the IR.    `recordLit.fields` is in SOURCE order.
 *   PRESENCE does not.           the lowerer SYNTHESISES an entry for every
 *                                omitted optional field, carrying the same
 *                                undefined arm an explicit `b: undefined`
 *                                carries, and nothing on the node tells the
 *                                two apart.
 *
 * So the order half is a backend question and the listing half is a frontend
 * one, and a fix that starts in the backend cannot reach the listing half at
 * all. Measured, not assumed: estado-perinstance.md.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { IrExpr, IrModule } from "../src/ir/nodes.js";

function lower(source: string): { module: IrModule | null; codes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-perinstance-"));
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

/** Every recordLit in the module, with its field names in IR order. */
function recordLits(mod: IrModule): { shapeId: string; fields: string[] }[] {
  const out: { shapeId: string; fields: string[] }[] = [];
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
    if (e.kind === "recordLit") {
      out.push({
        shapeId: e.type.kind === "record" ? e.type.shapeId : "?",
        fields: e.fields.map((f) => f.name),
      });
    }
    for (const v of Object.values(n as Record<string, unknown>)) walk(v);
  };
  walk(mod);
  return out;
}

/* -- the representation fact both debts sit on ------------------------ */

test("an optional field and an undefined-armed one are ONE shape", () => {
  // Not a style point: it is why "written undefined" and "never written"
  // cannot both be answered. Two interfaces, two literals, ONE record.
  const r = lower(`
interface A { a?: number }
interface B { a: number | undefined }
const x: A = { a: 1 };
const y: B = { a: 1 };
console.log(x.a, y.a);
`);
  expect(r.module).not.toBeNull();
  const recs = r.module!.records ?? [];
  expect(recs.length).toBe(1);
  expect(recs[0]!.fields.map((f) => f.name)).toEqual(["a"]);
  // And the one field is a union carrying an undefined arm - which is the
  // whole of what the record remembers about the key.
  const f = recs[0]!.fields[0]!;
  expect(f.type.kind).toBe("union");
  const u = (r.module!.unions ?? []).find((x) => f.type.kind === "union" && x.id === f.type.unionId);
  expect(u).toBeDefined();
  expect(u!.arms.some((a) => a.kind === "undefinedT")).toBe(true);
});

/* -- the ORDER half: it is all still there in the IR ------------------ */

test("a record literal keeps its SOURCE order in the IR", () => {
  // The order debt is not a lost fact, it is an unread one: the crossing
  // walks the shape's declaredOrder while the literal that built the value
  // is right here, in the order the program spelled it.
  // TWO literals, spelled differently, because the divergence this test is
  // about needs a shape that cannot take either one's order. With ONE
  // literal reconcileKeyOrders re-picks declaredOrder to it and there is no
  // divergence left to show.
  const r = lower(`
interface W { inner: number; middle: string; tag: boolean }
const w: W = { tag: true, inner: 1, middle: "m" };
const v: W = { inner: 9, middle: "z", tag: false };
console.log(w.inner, v.inner);
`);
  expect(r.module).not.toBeNull();
  const lits = recordLits(r.module!);
  expect(lits.length).toBe(2);
  expect(lits[0]!.fields).toEqual(["tag", "inner", "middle"]);
  // ... while the SHAPE says something else, and that is the divergence.
  const rec = (r.module!.records ?? [])[0]!;
  expect(rec.declaredOrder).toEqual(["inner", "middle", "tag"]);
});

test("the written keys keep their order and the omitted ones follow", () => {
  // Node's own-key list for `{ c: 1, a: 2 }` is exactly "c,a". The IR field
  // list here is "c,a,b" - the written prefix IS Node's answer, and `b` is
  // an entry the LOWERER added.
  const r = lower(`
interface W { a?: number; b?: number; c?: number }
const w: W = { c: 1, a: 2 };
console.log(w.a);
`);
  expect(r.module).not.toBeNull();
  const lits = recordLits(r.module!);
  expect(lits.length).toBe(1);
  expect(lits[0]!.fields).toEqual(["c", "a", "b"]);
});

/* -- the LISTING half: the fact is gone before any backend sees it ---- */

test("an omitted optional field is INDISTINGUISHABLE from an explicit undefined", () => {
  // The two literals below are different programs with different answers in
  // Node (`{a:1}` has no `b`; `{a:1,b:undefined}` has one). They lower to
  // the same shape AND to the same field list carrying the same kind of
  // value in the same position. That is where the listing half is lost -
  // in the FRONTEND, not at the crossing - and it is why the fix for it is
  // a lowering change and not an emission one.
  const r = lower(`
interface W { a?: number; b?: number }
const p: W = { a: 1 };
const q: W = { a: 1, b: undefined };
console.log(p.a, q.a);
`);
  expect(r.module).not.toBeNull();
  const lits = recordLits(r.module!);
  expect(lits.length).toBe(2);
  expect(lits[0]!.fields).toEqual(["a", "b"]);
  expect(lits[1]!.fields).toEqual(["a", "b"]);
  expect(lits[0]!.shapeId).toBe(lits[1]!.shapeId);
});

/* -- and the fences that stand where the debt is not payable ---------- */

test("a record whose order is NOT KNOWABLE still refuses to cross", () => {
  // The order half is LOUD where no answer is available (SC1090 at the
  // crossing). Nothing here may quietly stop refusing: a per-instance
  // representation that landed halfway would take this refusal away before
  // it could answer in its place.
  //
  // Two literals spelling one shape differently IS "no answer available".
  // The one-literal case does not refuse any more and does not have to:
  // reconcileKeyOrders gives the shape the program's own order and the
  // crossing materialises Node's key list -- measured MATCH byte-exact on
  // both backends through Object.keys, JSON.stringify and console.log,
  // which is answering in its place rather than landing halfway.
  const r = lower(`
interface W { inner: number; middle: string; tag: boolean }
const w: W = { tag: true, inner: 1, middle: "m" };
const v: W = { inner: 9, middle: "z", tag: false };
const o: object = w;
console.log(Object.keys(o).join(","), v.inner);
`);
  expect(r.codes).toContain("SC1090");
});

test("a width copy still refuses to cross, and for its OWN reason", () => {
  // The key a width copy drops has no SLOT in the narrower shape, so no
  // per-instance key vector can carry it: this refusal outlives the order
  // one and must not be taken down with it. Measured on a 660-cell
  // population: standing this fence down under a per-instance vector turned
  // 79 loud refusals into 79 silent wrong values.
  const r = lower(`
interface Wide { inner: number; middle: string; tag: boolean; extra: string }
interface W { inner: number; middle: string; tag: boolean }
const wide: Wide = { inner: 1, middle: "m", tag: true, extra: "x" };
const w: W = wide;
const o: object = w;
console.log(Object.keys(o).join(","));
`);
  expect(r.codes).toContain("SC1090");
});
