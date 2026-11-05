/* STRUCTURAL TIE - which levels of a self-nesting generic are one shape, and which are not.
 *
 * A generic that names itself with a deeper argument (`Tree<T>` -> `kids: Tree<Same<T>>[]`) is a new checker type at every level,
 * so the identity-keyed recursion guard never closes. types.ts (structuralAncestorOf) ties the levels together when every level is
 * EXACTLY equal in each member but its own self-instantiations, in a run of three nested levels, and the next STRUCT_PROBE_LEVELS
 * levels along the self-instantiation agree too. This file pins that rule at the IR:
 *   - a family is ONE record shape (every level is the same id, so a value of one level fits the next);
 *   - a conditional type that changes the members INSIDE the horizon keeps the levels apart;
 *   - the residual: a change BEYOND the horizon cannot be seen by looking, and is tied. That test states the unsoundness and is the
 *     thing to flip if the horizon is ever replaced by a proof.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { IrModule } from "../src/ir/nodes.js";

function lower(source: string): { module: IrModule | null; codes: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-structtie-"));
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

const withField = (m: IrModule, name: string, kind: string): number =>
  m.records.filter((r) => r.fields.some((f) => f.name === name && f.type.kind === kind)).length;

test("every level of a self-nesting generic is one record shape", () => {
  const r = lower(`type Same<T> = { [K in keyof T]: T[K] };
interface Tree<T> { label: string; n: number; kids: Tree<Same<T>>[] }
function sum(t: Tree<{ a: number }>): number { let s = t.n; for (const k of t.kids) s += sum(k); return s }
const leaf: Tree<{ a: number }> = { label: "l", n: 1, kids: [] };
console.log(sum({ label: "r", n: 2, kids: [leaf, leaf] }));
`);
  expect(r.module, `lowering refused: ${r.codes.join(",")}`).not.toBeNull();
  expect(withField(r.module!, "kids", "array"), "one shape carries `kids`: the levels are tied, not merely mapped").toBe(1);
});

test("a conditional that changes the members inside the horizon keeps the levels apart", () => {
  const r = lower(`type Wrap<T> = { a: T };
type Deep5<T> = T extends { a: { a: { a: { a: { a: unknown } } } } } ? string : number;
interface C<T> { v: Deep5<T>; next: C<Wrap<T>> | null }
function first(c: C<{}>): number { return c.v }
console.log(first({ v: 1, next: null }));
`);
  expect(r.module, `lowering refused: ${r.codes.join(",")}`).not.toBeNull();
  // Levels 0..4 carry `number`, level 5 on carry `string`: never one shape. (The levels from 5 on ARE one shape, since they repeat.)
  expect(withField(r.module!, "v", "f64"), "the number-valued levels stay separate from each other and from the string ones").toBeGreaterThanOrEqual(2);
  expect(withField(r.module!, "v", "string"), "the string-valued levels are a shape of their own").toBeGreaterThanOrEqual(1);
});

test("OPEN: a change beyond the horizon cannot be seen and is tied", () => {
  // The conditional flips only at level 20; the probe looks STRUCT_PROBE_LEVELS (16) levels past the third. Everything the checker
  // shows the mapper agrees, so the levels are one shape with `v: number` - wrong for a value at level 20 or deeper. Looking can
  // never prove it away (the checker's own deep-nesting rule has the same blind spot). This test pins the behaviour so that
  // replacing the horizon with a proof flips it on purpose.
  const deep = "{ a: ".repeat(21) + "unknown" + " }".repeat(21);
  const r = lower(`type Wrap<T> = { a: T };
type Deep20<T> = T extends ${deep} ? string : number;
interface C<T> { v: Deep20<T>; next: C<Wrap<T>> | null }
function first(c: C<{}>): number { return c.v }
console.log(first({ v: 1, next: null }));
`);
  expect(r.module, `lowering refused: ${r.codes.join(",")}`).not.toBeNull();
  expect(withField(r.module!, "v", "string"), "no string-valued level was ever seen").toBe(0);
});
