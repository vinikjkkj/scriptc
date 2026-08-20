/* SC6003 — the half-alias projection, made loud.
 *
 * A class instance flowing into an interface that mixes a METHOD and a
 * DATA field becomes a record whose method field is a closure bound to the
 * LIVE instance and whose data field is a COPY taken at the projection. One
 * reference, two identities:
 *
 *     interface View { n: number; bump(): void }
 *     class C { n = 0; bump(): void { this.n++; } }
 *     function through(v: View): string { v.bump(); return String(v.n); }
 *     through(new C())        node 1        scriptc 0
 *
 * Measured on both backends, at exit 0, on base and on this branch: the
 * call reaches the object and the read does not.
 *
 * WHY ADVICE AND NOT A REFUSAL, which is the half worth pinning.
 *
 * Correcting it is out of reach of the record model, not out of effort. A
 * record is a monomorphic struct; a data field is storage at a fixed
 * offset. Making the read alias needs the TARGET SHAPE to carry an accessor
 * slot, and accessor-carrying shapes are deliberately neither JSON-safe nor
 * dyn-convertible (accessorSlotProp) — so arming an interface's shape
 * because one class happens to project into it would fence JSON.stringify
 * and Object.keys for every value of that interface, including the record
 * literals that never came near a class.
 *
 * Refusing it refuses mainstream TypeScript. "Pass an object with state and
 * methods behind an interface" is the pattern, not an edge; over the 1,529
 * corpus programs the frontend interns 30 projections, 17 of them mixed,
 * and 4 of those (in 3771 and 3813) would go from green to refused. Under
 * `--best-effort` a refusal is a runtime throw AT the statement, so the
 * cure would stop programs that today print the right answer everywhere
 * they look.
 *
 * So the compiler says what it is about to do, names the fields, and does
 * it — the SC6002 stance for a construction that is possibly, not provably,
 * observed.
 *
 * Both halves are asserted here, and so is the armed half: the shapes that
 * must produce NO row. An advisory that fired for every projection would
 * pass a one-directional test and be noise. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import type { ScrDiagnostic } from "../src/diagnostics/diagnostic.js";

interface Lowered {
  readonly advisories: readonly ScrDiagnostic[];
  readonly diags: readonly ScrDiagnostic[];
  readonly compiled: boolean;
}

function lower(source: string): Lowered {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-projadvice-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source);
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    return { advisories: r.advisories, diags: r.diagnostics, compiled: r.module !== null };
  } finally {
    load.dispose();
  }
}

const only6003 = (r: Lowered): readonly ScrDiagnostic[] =>
  r.advisories.filter((a) => a.code === "SC6003");

test("a mixed projection whose method writes the copied field is named, by field", () => {
  const r = lower(`
interface View { n: number; bump(): void }
class C { n = 0; bump(): void { this.n++; } }
function through(v: View): string { v.bump(); return String(v.n); }
console.log(through(new C()));
`);
  expect(r.diags).toEqual([]);
  expect(r.compiled, "the advice must not stop the build").toBe(true);
  const a6 = only6003(r);
  expect(a6.length).toBe(1);
  const a = a6[0]!;
  expect(a.severity).toBe("advice");
  expect(a.message).toContain("'C'");
  expect(a.message).toContain("'n'");
  expect(a.message).toContain("COPIES");
});

test("a compound assignment and an increment both count as a write", () => {
  for (const body of ["this.n += 1;", "this.n++;", "++this.n;", "this.n -= 2;"]) {
    const r = lower(`
interface View { n: number; bump(): void }
class C { n = 0; bump(): void { ${body} } }
function through(v: View): number { v.bump(); return v.n; }
console.log(through(new C()));
`);
    expect(only6003(r).length, `for ${body}`).toBe(1);
  }
});

test("an arrow-function FIELD that writes counts: it is reachable exactly like a method", () => {
  const r = lower(`
interface View { n: number; go(): void }
class C { n = 0; go = (): void => { this.n += 1; }; }
function through(v: View): number { v.go(); return v.n; }
console.log(through(new C()));
`);
  expect(only6003(r).length).toBe(1);
  expect(only6003(r)[0]!.message).toContain("'n'");
});

test("a base class's method counts: the projected closures call into the whole instance", () => {
  const r = lower(`
interface View { n: number; go(): void }
class Base { n = 0; protected raise(): void { this.n = 9; } }
class Derived extends Base { go(): void { this.raise(); } }
function through(v: View): number { v.go(); return v.n; }
console.log(through(new Derived()));
`);
  expect(only6003(r).length).toBe(1);
  expect(only6003(r)[0]!.message).toContain("'n'");
});

// ---- the armed half: shapes that must produce NO row --------------------

test("a CONSTRUCTOR write does not count — it runs before the value exists to project", () => {
  const r = lower(`
interface View { n: number; read(): number }
class C { n: number; constructor() { this.n = 7; } read(): number { return this.n; } }
function through(v: View): number { return v.n + v.read(); }
console.log(through(new C()));
`);
  expect(only6003(r)).toEqual([]);
});

test("a METHODS-ONLY target has nothing copied to go stale", () => {
  const r = lower(`
interface Store { load(): number; bump(): void }
class S { private n = 0; load(): number { return this.n; } bump(): void { this.n++; } }
function through(s: Store): number { s.bump(); return s.load(); }
console.log(through(new S()));
`);
  expect(only6003(r)).toEqual([]);
});

test("a DATA-ONLY target has no live half to disagree with", () => {
  const r = lower(`
interface Pt { x: number; y: number }
class P { x = 1; y = 2; move(): void { this.x = 10; } }
function through(p: Pt): number { return p.x + p.y; }
console.log(through(new P()));
`);
  expect(only6003(r)).toEqual([]);
});

test("a mixed target whose copied field NO method writes is silent", () => {
  const r = lower(`
interface View { label: string; count(): number }
class C { readonly label = "c"; private n = 0; count(): number { this.n++; return this.n; } }
function through(v: View): string { return v.label + String(v.count()); }
console.log(through(new C()));
`);
  expect(only6003(r)).toEqual([]);
});

test("the write must be to a COPIED field, not merely to some field", () => {
  const r = lower(`
interface View { label: string; bump(): void }
class C { readonly label = "c"; hidden = 0; bump(): void { this.hidden++; } }
function through(v: View): string { v.bump(); return v.label; }
console.log(through(new C()));
`);
  expect(only6003(r)).toEqual([]);
});

test("the advice rides its own list and never enters diagnostics", () => {
  const r = lower(`
interface View { n: number; bump(): void }
class C { n = 0; bump(): void { this.n++; } }
function through(v: View): number { v.bump(); return v.n; }
console.log(through(new C()));
`);
  expect(r.diags.map((d) => d.code)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("the span names a real file, never the width planner's synthetic loc", () => {
  const r = lower(`
interface View { n: number; bump(): void }
interface Holder { v: View }
class C { n = 0; bump(): void { this.n++; } }
const h: Holder = { v: new C() };
h.v.bump();
console.log(h.v.n);
`);
  for (const a of only6003(r)) {
    expect(a.loc.file).not.toBe("<width>");
    expect(a.loc.end).toBeGreaterThan(a.loc.start);
  }
});
