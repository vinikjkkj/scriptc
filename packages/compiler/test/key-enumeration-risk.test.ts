/* The record model's two SILENT wrong answers about a value's own keys, and
 * the line between the half that refuses and the half that only advises.
 *
 * A record is a monomorphic struct with no per-instance key list, so its own
 * keys are its SHAPE's: `fields` for the set, `declaredOrder` for the order.
 * That is Node-exact only while the value was BUILT that way, and three
 * constructions are not:
 *
 *   const narrow: Narrow = wide;   node {"a":"A","b":"B"}   scriptc {"a":"A"}
 *   const t: T = { c: 3, b: 1 };   node {"c":3,"b":1}       scriptc {"b":1,"c":3}
 *   const r = mk() as Rec;         node the source's order  scriptc declaredOrder
 *
 * All three printed the wrong thing at exit 0 and said nothing. The first two
 * are PROVABLE at the construction site, so they refuse. The third is only
 * POSSIBLE — `JSON.parse(s) as T` is right whenever the JSON text happens to
 * be in declaration order, which is what seven of the first fifteen corpus
 * programs rely on — so it advises (SC6002) and keeps compiling.
 *
 * The risk rides the VALUE, never the shape. A shape is shared by every
 * construction of its member set, so a shape-level test also refuses the
 * programs that build it correctly: tests/corpus/1555 (an out-of-order
 * subset literal beside an Object.entries over a PARAMETER) and
 * tests/corpus/2023 (a genuine width copy beside a JSON.stringify of an
 * exact one) are both such, and the armed half below is why they compile.
 */
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
  const dir = mkdtempSync(join(tmpdir(), "scriptc-keyrisk-"));
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

const keyRisk = (r: Lowered): ScrDiagnostic[] =>
  r.diags.filter((d) => d.message.includes("over a record this program does not build"));

/* ── the SET half: a width copy ends keys JS keeps ─────────────────────── */

test("enumerating a width-narrowed record is refused, naming the ended keys", () => {
  const r = lower(`
interface Wide { readonly a: string; readonly b: string; readonly extra: string }
interface Narrow { readonly a: string; readonly b: string }
const wide: Wide = { a: "A", b: "B", extra: "X" };
const narrow: Narrow = wide;
console.log(Object.keys(narrow).join("|"));
`);
  const rows = keyRisk(r);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]!.code).toBe("SC1090");
  expect(rows[0]!.message).toContain("width copy");
  expect(rows[0]!.hint ?? "").toContain("extra");
  expect(r.compiled).toBe(false);
});

test("the same refusal through a SPREAD, which is width subtyping in spread clothing", () => {
  const r = lower(`
interface Wide { readonly a: string; readonly b: string }
interface Narrow { readonly a: string }
const wide: Wide = { a: "A", b: "B" };
const narrow: Narrow = { ...wide };
console.log(JSON.stringify(narrow));
`);
  const rows = keyRisk(r);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]!.hint ?? "").toContain("b");
});

/* ── the ORDER half: one shape, several literal orders ────────────────── */

test("enumerating a literal spelled in an order its shape does not carry is refused", () => {
  const r = lower(`
interface T { readonly b: number; readonly a: number; readonly c: number }
const t: T = { c: 3, b: 1, a: 2 };
console.log(JSON.stringify(t));
`);
  const rows = keyRisk(r);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]!.message).toContain("declared order");
  expect(rows[0]!.hint ?? "").toContain("c,b,a");
});

test("the INTERNING half: a literal in order for its own spelling that lands on another type's shape", () => {
  // `three` is written y,z; the shape was interned first by `two` at z,y and
  // metadata is not identity, so `three` loses its own order.
  const r = lower(`
const two = { z: 1, y: 2 };
const three = { y: 2, z: 1 };
console.log(Object.keys(two).join(",") + Object.keys(three).join(","));
`);
  expect(keyRisk(r).length).toBeGreaterThan(0);
});

/* ── the DYN half: advice, not a refusal ──────────────────────────────── */

test("a record materialised out of a dynamic value and then enumerated ADVISES and compiles", () => {
  const r = lower(`
interface Rec { readonly z: string; readonly a: string }
function mk(): unknown { const o: Record<string, string> = {}; o["a"] = "A"; o["z"] = "Z"; return o }
const rec = mk() as Rec;
console.log(JSON.stringify(rec));
`);
  expect(keyRisk(r)).toEqual([]);
  expect(r.compiled, "the advice must not stop the build").toBe(true);
  const a = r.advisories.filter((d) => d.code === "SC6002");
  expect(a.length).toBe(1);
  expect(a[0]!.severity).toBe("advice");
  expect(a[0]!.message).toContain("dynamic");
});

/* ── the armed half: five shapes that must produce NO row ─────────────── */

test("a literal spelled the way its shape enumerates is silent", () => {
  const r = lower(`
interface T { readonly b: number; readonly a: number; readonly c: number }
const t: T = { b: 1, a: 2, c: 3 };
console.log(JSON.stringify(t) + Object.keys(t).join(","));
`);
  expect(keyRisk(r)).toEqual([]);
  expect(r.advisories.filter((d) => d.code === "SC6002")).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("INTEGER-LIKE names spelled last are silent: JS enumerates them first however they are written", () => {
  const r = lower(`
interface N { readonly z: number; readonly "2": number; readonly "1": number }
const n: N = { z: 26, "2": 22, "1": 11 };
console.log(JSON.stringify(n) + Object.keys(n).join(","));
`);
  expect(keyRisk(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("a width copy that is only READ is silent — the documented width stance keeps working", () => {
  const r = lower(`
interface Wide { readonly a: string; readonly b: string; readonly extra: string }
interface Narrow { readonly a: string; readonly b: string }
const wide: Wide = { a: "A", b: "B", extra: "X" };
const narrow: Narrow = wide;
console.log(narrow.a + narrow.b);
`);
  expect(keyRisk(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("a value the walk cannot point at is silent — no refusal without a named construction", () => {
  // tests/corpus/1555's shape: the out-of-order literal is somewhere else and
  // what is enumerated is a PARAMETER. Refusing here would refuse a program
  // whose output is already Node-exact.
  const r = lower(`
interface T { readonly b: number; readonly a: number; readonly c: number }
const bad: T = { c: 3, b: 1, a: 2 };
console.log(String(bad.a));
function show(x: T): string { return Object.keys(x).join(","); }
console.log(show({ b: 1, a: 2, c: 3 }));
`);
  expect(keyRisk(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("a shape built correctly beside a width copy of the same member set is silent", () => {
  // tests/corpus/2023's shape: `rw` is a genuine width copy and `p` is exact,
  // and they share one shape. Only `rw` may be refused, and only if it is
  // enumerated — it is not.
  const r = lower(`
interface P { readonly x: number; readonly y: number }
interface Wide { readonly x: number; readonly y: number; readonly z: number }
const p: P = { x: 1, y: 2 };
const w: Wide = { x: 3, y: 4, z: 5 };
const rw: P = w;
console.log(String(rw.x));
console.log(JSON.stringify(p));
`);
  expect(keyRisk(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});
