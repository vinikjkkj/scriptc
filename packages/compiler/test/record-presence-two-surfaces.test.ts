/* ONE SLOT, ONE INSTANCE MASK - why `{ a: undefined }` and `{}` now differ.
 *
 * `per-instance-keys.test.ts` pins the premise: `{ a?: T }` and
 * `{ a: T | undefined }` intern to ONE record shape, so "written undefined"
 * and "never written" have ONE representation in the slot. That used to
 * force every consumer to pick a side, and they picked differently:
 * Object.keys / `in` / Object.hasOwn guarded on the undefined arm's tag
 * (right for the OMITTED optional, wrong for the explicit undefined), while
 * util.inspect printed every declared field (the reverse). The test that
 * stood here pinned that disagreement as a TRIPWIRE, because teaching
 * inspect the tag test turned corpus 1632's explicit `undefined` red.
 *
 * The slot is no longer the only presence signal. A shape with an
 * undefined-armed member arms the per-instance own-key mask, every object
 * literal ESTABLISHES it (recordLit.presence: the members the source wrote
 * are `own`, a completion is not), a write sets the member's bit, `delete`
 * clears it (recordSet.unset), a width copy and a spread carry the bit
 * (`ownIf`), and every surface asks the one node (recordKeyPresent): the
 * instance's bit when its builder wrote one, the tag test when it did not.
 * So `util.inspect` and Object.keys agree, and both are right for both
 * spellings. This file now pins THAT: inspect asks the same question
 * Object.keys asks.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { IrFunction, IrModule, IrStmt } from "../src/ir/nodes.js";

function lower(source: string): IrModule | null {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-presence-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  try {
    return lowerToIr(load.program, load.entry, load.moduleOrder).module;
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

/** The interned helper `prefix` names whose FIRST parameter is the record
 * itself. Several inspect helpers are interned per program (one per type
 * reached, unions included) and only one of them walks the record. */
function recordHelper(mod: IrModule, prefix: string): IrFunction | undefined {
  return mod.functions.find(
    (f) => f.name.startsWith(prefix) && f.params[0]?.type.kind === "record",
  );
}

/** The statements of `body` that are `if`s whose condition tests a union's
 * undefined arm — the presence guard, wherever it is spelled. */
function presenceGuards(body: IrStmt[]): number {
  return nodesOfKind(body, "if").filter((s) => {
    const cond = s["cond"] as Record<string, unknown> | undefined;
    return cond !== undefined && cond["kind"] === "unionIsTag";
  }).length;
}

const PROGRAM = `
interface M { readonly a: number; readonly b?: number; readonly c?: string }
const m: M = { a: 1 };
console.log(Object.keys(m).join("|"));
console.log(m);
`;

test("the two spellings are still ONE shape, so one rule has to serve both", () => {
  const mod = lower(`
interface A { a: number; b?: number }
interface B { a: number; b: number | undefined }
const x: A = { a: 1 };
const y: B = { a: 1, b: undefined };
console.log(x.a, y.a);
`);
  expect(mod).not.toBeNull();
  // ONE record, not two: the premise this whole file rests on.
  expect((mod!.records ?? []).length).toBe(1);
});

test("Object.keys asks the own-key question for each optional member", () => {
  const mod = lower(PROGRAM);
  expect(mod).not.toBeNull();
  const keys = recordHelper(mod!, "%obj.keys.");
  expect(keys, "the interned Object.keys helper should exist").toBeDefined();
  // Two optional fields, two guards; the required one pushes unconditionally.
  expect(nodesOfKind(keys!.body, "recordKeyPresent").length).toBe(2);
});

test("util.inspect renders an optional member only when the SAME question says own", () => {
  const mod = lower(PROGRAM);
  expect(mod).not.toBeNull();
  const insp = recordHelper(mod!, "%util.insp.");
  expect(insp, "the interned util.inspect helper should exist").toBeDefined();
  // Three declared fields, three `insp.entry` calls. The two optional ones
  // sit under recordKeyPresent (the node Object.keys asks); the required
  // one is unconditional, since no value of the shape lacks it.
  const entries = nodesOfKind(insp!.body, "libCall").filter((e) => e["fn"] === "insp.entry");
  expect(entries.length).toBe(3);
  const guards = nodesOfKind(insp!.body, "if").filter((s) => {
    const cond = s["cond"] as Record<string, unknown> | undefined;
    return cond !== undefined && cond["kind"] === "recordKeyPresent";
  });
  expect(guards.length).toBe(2);
  expect(presenceGuards(insp!.body)).toBe(0);
});

test("a literal names the members it owns, and a completion does not", () => {
  const mod = lower(`
interface P { a?: number; c?: number }
const flag = process.argv.length > 99;
const x: P = flag ? { a: 1 } : { c: 3 };
const y: P = { a: undefined, c: 3 };
console.log(x, y);
`);
  expect(mod).not.toBeNull();
  const lits = nodesOfKind(mod!, "recordLit").filter((l) => l["presence"] === true);
  expect(lits.length).toBeGreaterThanOrEqual(3);
  for (const l of lits) {
    const fields = l["fields"] as { name: string; own?: true; value: Record<string, unknown> }[];
    // Every field the SOURCE wrote is own; the shape's other members (the
    // undefined arm a literal that omitted them is given) are not.
    for (const f of fields) {
      const isUndefinedLit = JSON.stringify(f.value).includes('"unit":"undefined"');
      if (f.own !== true) expect(isUndefinedLit).toBe(true);
    }
  }
  // `{ a: undefined, c: 3 }` owns BOTH keys, though one value is undefined.
  const both = lits.find((l) => (l["fields"] as { own?: true }[]).every((f) => f.own === true));
  expect(both, "the explicit-undefined literal owns every field it spells").toBeDefined();
});

test("`delete` clears the own-key bit and `in` also reads the slot", () => {
  const mod = lower(`
interface P { a?: number; c?: number }
const p: P = { a: 1, c: 2 };
delete p.a;
console.log("a" in p);
`);
  expect(mod).not.toBeNull();
  const sets = nodesOfKind(mod!, "recordSet");
  expect(sets.some((s) => s["unset"] === true && s["field"] === "a")).toBe(true);
  const inq = nodesOfKind(mod!, "recordKeyPresent").filter((n) => n["orSlot"] === true);
  expect(inq.length).toBe(1);
});
