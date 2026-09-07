/* SHAPE UNIFICATION — which width pairs become one shape, and which do not.
 *
 * The record width copy makes a FRESH struct where JavaScript hands over the
 * same object, so a write through the narrow view never reaches the original.
 * Where the narrow shape can afford to carry the wide one's extra members,
 * shape-unify.ts merges the two into ONE shape and the copy between them
 * becomes the identity — offsets stay compile-time constants, neither backend
 * changes, and an edge it declines keeps exactly the copy it has today.
 *
 * This file pins the ADMISSION RULE, at the IR. The behaviour a unified pair
 * produces (identity restored, own keys and their order unchanged) is
 * tests/harness/record-width-unify.test.ts, against node.
 *
 * The two that are easy to get wrong and are pinned here on purpose:
 *
 *   THE FIXPOINT. Merging changes field TYPES, so a pair whose fields
 *     disagree today can agree once the pass has run — and the disagreeing
 *     pair is very often itself a width pair one level down. Judging
 *     conflicts on the types as they are PRINTED declines components the
 *     pass can serve; `the nested pair` below is exactly that shape.
 *   THE OWN-KEY OBLIGATION. A grown shape must not start reporting its added
 *     members to Object.keys. The unset slot answers "absent" only for an
 *     OPTIONAL-flavored member, so a required one declines the edge — see
 *     `a required extra member` below, which is the pass's biggest single
 *     decline class and is a decline rather than a trade on purpose.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { IrModule, IrRecordShape } from "../src/ir/nodes.js";
import type { ScrDiagnostic } from "../src/diagnostics/diagnostic.js";

interface Lowered {
  module: IrModule;
  advisories: ScrDiagnostic[];
}

function lower(source: string): Lowered {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-unify-"));
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
    return { module: r.module, advisories: r.advisories ?? [] };
  } finally {
    load.dispose();
  }
}

/** The interned width copies the module still contains. Empty means every
 * pair the program asked to copy became one shape. */
const widthHelpers = (m: IrModule): string[] =>
  m.functions.map((f) => f.name).filter((n) => n.startsWith("%rec.width."));

const shapeWith = (m: IrModule, ...names: string[]): IrRecordShape | undefined =>
  m.records.find((r) => names.every((n) => r.fields.some((f) => f.name === n)));

const sc6004 = (l: Lowered): number => l.advisories.filter((d) => d.code === "SC6004").length;

/* The flow every case below uses: an ARGUMENT-position upcast, which is the
 * position the width copy is silent at (assignment and return are refused by
 * SC1090). */
const PAIR = (wide: string, narrow: string, lit: string) => `export {}
interface Wide ${wide}
interface Narrow ${narrow}
function take(x: Narrow): Narrow { return x }
const w: Wide = ${lit}
const n = take(w)
n.a = 9
console.log(String(w.a) + " " + String(n.a))
`;

test("an OPTIONAL extra member is carried: the two shapes become one and the copy goes", () => {
  const l = lower(PAIR("{ a: number; b?: number }", "{ a: number }", "{ a: 1, b: 2 }"));
  expect(
    widthHelpers(l.module),
    "the narrow shape can hold `b` (its unset slot IS the undefined arm), so the pair merges " +
      "and there is nothing left to copy",
  ).toEqual([]);
  const merged = shapeWith(l.module, "a", "b");
  expect(merged, "one shape now carries both members").toBeDefined();
  expect(
    l.module.records.filter((r) => r.fields.some((f) => f.name === "a")).length,
    "and it is the ONLY shape with an `a`: the narrow one is gone, not shadowed",
  ).toBe(1);
  expect(
    sc6004(l),
    "SC6004 advises about a copy. There is no copy here, so it must fall silent",
  ).toBe(0);
});

test("a REQUIRED extra member declines: no mask writer, so no merge", () => {
  const l = lower(PAIR("{ a: number; b: number }", "{ a: number }", "{ a: 1, b: 2 }"));
  expect(
    widthHelpers(l.module).length,
    "`b: number` has no undefined arm, so a narrow literal that gained the slot would answer " +
      "`present` to Object.keys for a key the object does not have. Trading the identity bug " +
      "for an enumeration bug is not a trade: the copy stays",
  ).toBe(1);
  expect(sc6004(l), "...and SC6004 keeps speaking at the site it kept").toBeGreaterThan(0);
});

test("the cap is +2 members: a third declines the whole edge", () => {
  const two = lower(PAIR("{ a: number; b?: number; c?: number }", "{ a: number }", "{ a: 1 }"));
  expect(widthHelpers(two.module), "+2 is inside the cap").toEqual([]);
  const three = lower(
    PAIR("{ a: number; b?: number; c?: number; d?: number }", "{ a: number }", "{ a: 1 }"),
  );
  expect(
    widthHelpers(three.module).length,
    "+3 is not. A one-field view is what gets allocated in a loop; growing it without bound to " +
      "spare a copy is a trade nobody asked for",
  ).toBe(1);
});

test("the nested pair proves the FIXPOINT: a conflict its own merge dissolves", () => {
  const l = lower(`export {}
interface Inner { p: number }
interface InnerW { p: number; q?: number }
interface Outer { i: Inner }
interface OuterW { i: InnerW }
function tin(x: Inner): Inner { return x }
function tout(x: Outer): Outer { return x }
const iw: InnerW = { p: 1, q: 2 }
const ow: OuterW = { i: iw }
console.log(String(tin(iw).p) + " " + String(tout(ow).i.p))
`);
  // Judged on the types as they are PRINTED, Outer.i (`Inner`) and OuterW.i
  // (`InnerW`) disagree and the outer pair is a conflict. They are themselves
  // a width pair, so the inner merge makes them the same type — and the outer
  // pair is admissible only because admission re-asks after every merge.
  expect(
    widthHelpers(l.module),
    "both levels merge: the inner pair first (tightest union), then the outer one, whose only " +
      "disagreement the inner merge dissolved",
  ).toEqual([]);
});

test("own-key ORDER survives, or the edge declines", () => {
  const kept = lower(`export {}
interface OWide { zz: number; a: number; q?: number }
interface ONarrow { zz: number; a: number }
function take(x: ONarrow): ONarrow { return x }
const w: OWide = { zz: 1, a: 2, q: 3 }
console.log(JSON.stringify(take(w)))
`);
  expect(widthHelpers(kept.module), "one order restricts to both members' orders").toEqual([]);
  expect(
    shapeWith(kept.module, "zz", "a", "q")?.declaredOrder,
    "and it is the topological merge, not the sorted field list: JSON.stringify prints this",
  ).toEqual(["zz", "a", "q"]);

  const cycle = lower(`export {}
interface CNarrow { b: number; a: number }
interface CWide { a: number; b: number; c?: number }
function take(x: CNarrow): CNarrow { return x }
const w: CWide = { a: 1, b: 2, c: 3 }
console.log(JSON.stringify(take(w)))
`);
  expect(
    widthHelpers(cycle.module).length,
    "`b` before `a` on one member and after it on the other: no single layout prints both " +
      "members' own keys in their own order, so the edge is a conflict like any other",
  ).toBe(1);
});

test("a TUPLE never merges, whatever its arity says", () => {
  const l = lower(`export {}
type T2 = [number, number]
function take(x: T2): T2 { return x }
const t: T2 = [1, 2]
console.log(String(take(t)[0]))
`);
  // Nothing to assert but the absence of a crash: tuples never width-relate
  // across arities, and the same-arity case is already one shape.
  expect(l.module.records.some((r) => r.tuple === true)).toBe(true);
});
