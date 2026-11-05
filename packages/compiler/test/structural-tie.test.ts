/* STRUCTURAL TIE - which levels of a self-nesting generic are one shape, and which are not.
 *
 * A generic that names itself with a deeper argument (`Tree<T>` -> `kids: Tree<Same<T>>[]`) is a new checker type at every level,
 * so the identity-keyed recursion guard never closes. types.ts (structuralAncestorOf) ties the levels together when every level is
 * EXACTLY equal in each member but its own self-instantiations, in a run of three nested levels, and the next STRUCT_PROBE_LEVELS
 * levels along the self-instantiation agree too. This file pins that rule at the IR:
 *   - a family is ONE record shape (every level is the same id, so a value of one level fits the next);
 *   - the signature includes the ARGUMENTS of every occurrence of the family, compared by the members they resolve to, so two levels
 *     are tied only when their arguments are structurally the same: a conditional type that changes the members at any depth
 *     cannot be tied, because its argument differs at that depth too;
 *   - the weak form (arguments ignored, a test-only switch) is shown merging shapes that differ.
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

test("a conditional that changes the members keeps the levels apart: the walk refuses, it does not tie them", () => {
  // The self-instantiation's ARGUMENT grows (`Wrap<T>` nests one deeper per level), so no two levels have equal arguments and the
  // signature, which includes the arguments, never matches: nothing is tied and the unbounded family is refused at the depth cap.
  // (With the argument ignored the levels from 5 on would have tied, and `v` would be read at the wrong layout.)
  const r = lower(`type Wrap<T> = { a: T };
type Deep5<T> = T extends { a: { a: { a: { a: { a: unknown } } } } } ? string : number;
interface C<T> { v: Deep5<T>; next: C<Wrap<T>> | null }
function first(c: C<{}>): number { return c.v }
console.log(first({ v: 1, next: null }));
`);
  expect(r.module, "tied levels would compile; a refusal is the safe answer").toBeNull();
  expect(r.codes).toContain("SC2009");
});

test("a change far beyond any horizon is refused the same way: the arguments differ at every level", () => {
  // The conditional flips only at level 20. A tie decided from members alone could not see that and would have tied (and read `v`
  // as number where it is a string); the arguments differ at every level, so there is no tie to be wrong about.
  const deep = "{ a: ".repeat(21) + "unknown" + " }".repeat(21);
  const r = lower(`type Wrap<T> = { a: T };
type Deep20<T> = T extends ${deep} ? string : number;
interface C<T> { v: Deep20<T>; next: C<Wrap<T>> | null }
function first(c: C<{}>): number { return c.v }
console.log(first({ v: 1, next: null }));
`);
  expect(r.module, "no silent tie").toBeNull();
  expect(r.codes).toContain("SC2009");
});

const PAIR = `type More<T> = T extends number[][][][][][][][] ? undefined : A<T>;
interface Base<T> { v: T }
interface B<T> extends Base<T> { tag: string; up?: More<T> | undefined }
interface A<T> { name: string; next: B<T[]>[] }
function top(a: A<number>): number { return a.next.length }
console.log(top({ name: "a", next: [] }));
`;

test("a mutually recursive pair whose levels differ in the ARGUMENT of the member they name stays one shape per level", () => {
  // Level k of B has `v: number[]` nested k deep: eight different layouts. Comparing an occurrence of the pair as its bare marker
  // (the weak form below) cannot tell them apart; the exact form compares the arguments, so no two of them are merged.
  const saved = { probe: process.env["SCRIPTC_STRUCT_PROBE"], args: process.env["SCRIPTC_STRUCT_ARGS"] };
  try {
    process.env["SCRIPTC_STRUCT_PROBE"] = "1";
    delete process.env["SCRIPTC_STRUCT_ARGS"];
    const exact = lower(PAIR);
    expect(exact.module, `lowering refused: ${exact.codes.join(",")}`).not.toBeNull();
    const exactShapes = exact.module!.records.filter((r) => r.fields.some((f) => f.name === "v")).length;
    expect(exactShapes, "one `v` shape per level: nothing merged").toBeGreaterThanOrEqual(8);
    // The NEGATIVE control: the weak form (arguments ignored, test-only switch) merges levels whose `v` differ - which is exactly the
    // silent wrong shape the exact form exists to prevent. It must be seen doing it, or the exact form proves nothing.
    process.env["SCRIPTC_STRUCT_ARGS"] = "ignore";
    const weak = lower(PAIR);
    const weakShapes = weak.module === null ? 0 : weak.module.records.filter((r) => r.fields.some((f) => f.name === "v")).length;
    expect(weakShapes, "the weak form merged shapes that differ").toBeLessThan(exactShapes);
  } finally {
    if (saved.probe === undefined) delete process.env["SCRIPTC_STRUCT_PROBE"]; else process.env["SCRIPTC_STRUCT_PROBE"] = saved.probe;
    if (saved.args === undefined) delete process.env["SCRIPTC_STRUCT_ARGS"]; else process.env["SCRIPTC_STRUCT_ARGS"] = saved.args;
  }
});
