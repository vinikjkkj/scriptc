/* THE CROSSING IS AN ENUMERATION - the key-order debt on the far side of
 * the widening boundary, and the line between what it refuses and what it
 * must keep letting through.
 *
 * A record has no per-instance key list, so its own keys are its SHAPE's:
 * `fields` for the set, `declaredOrder` for the order. Enumerating a value
 * the walk PROVED is not built that way has been refused for a while
 * (key-enumeration-risk.test.ts is that fence). The refusal stopped at the
 * boundary: `const o: object = w` is not a pointer copy - the static->dyn
 * walker inserts each key into a fresh dyn object, in declaredOrder, right
 * there, so the crossing materialises the wrong key list and every read of
 * the dyn value from that point reports it.
 *
 * Measured before it was written, on a generated population of 480 cells
 * (6 constructions x 10 boundaries x 8 surfaces) run against Node v25.9.0
 * on both backends: base answered 238 divergences, 232 of them SILENT.
 *
 * HALF OF THIS FILE IS ARMED. A crossing fence that fired on every record
 * would refuse most of the programs this compiler exists to compile, so the
 * cases that must keep compiling are tested first and by name: the risk
 * rides the VALUE, and a value built the way its shape enumerates has
 * nothing wrong with it however far it travels.
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
  const dir = mkdtempSync(join(tmpdir(), "scriptc-keycross-"));
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

const crossing = (r: Lowered): ScrDiagnostic[] =>
  r.diags.filter((d) => d.message.includes("widening a record into an 'unknown'/'object' slot"));

const ROW = `interface Row { inner: number; middle: string; tag: boolean }`;
/* OUT OF ORDER *AND* AMBIGUOUS, and the second half is load-bearing.
 *
 * A shape's enumeration order is a CHOICE, and reconcileKeyOrders re-picks
 * it where the program proves one. So a Row built by ONE out-of-order
 * literal is not a divergence any more: it is a shape that enumerates
 * `tag,inner,middle` and answers Node exactly (measured -- that program,
 * crossed into an `object` slot and read through Object.keys,
 * JSON.stringify and console.log, is MATCH byte-exact on both backends
 * against node v25.9.0). What the crossing fence still refuses is an order
 * that is not KNOWABLE, and two literals spelling one shape differently is
 * exactly that: neither order can be the shape's, so the crossing
 * materialises a key list that is wrong for at least one of them. `w2` is
 * READ so its construction is lowered. */
const OUT_OF_ORDER =
  `${ROW}\nconst w: Row = { tag: true, inner: 1, middle: "m" };\n` +
  `const w2: Row = { inner: 9, middle: "z", tag: false };\nconsole.log(String(w2.inner));`;
const IN_ORDER = `${ROW}\nconst w: Row = { inner: 1, middle: "m", tag: true };`;

/* -- the ARMED half: what must keep compiling ------------------------- */

test("a record built the way its shape enumerates crosses freely", () => {
  const r = lower(`${IN_ORDER}
const o: object = w;
console.log(Object.keys(o).join(","));`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("every boundary of an in-order record stays open", () => {
  const r = lower(`${IN_ORDER}
function f(o: object): string { return JSON.stringify(o); }
const arr: object[] = [w];
const rec: { v: object } = { v: w };
const u: unknown = w;
console.log(f(w), JSON.stringify(arr), Object.keys(rec.v).join(","), typeof u);`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("an out-of-order record that never crosses is wrong about nothing", () => {
  const r = lower(`${OUT_OF_ORDER}
console.log(String(w.inner), w.middle, String(w.tag));`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("a ONE-FIELD literal has no order to get wrong", () => {
  const r = lower(`interface One { only: number }
const w: One = { only: 1 };
const o: object = w;
console.log(Object.keys(o).join(","));`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("integer-like keys are hoisted by the SHAPE, so their declaration slots are already enumeration order", () => {
  // esOwnKeyOrder runs at intern time, so declaredOrder already reads
  // "2,10,alpha,beta" for a shape declared "2,alpha,10,beta" - the literal
  // below is therefore in enumeration order and carries no risk at all.
  const r = lower(`interface M { "2": string; alpha: number; "10": string; beta: number }
const w: M = { "2": "two", alpha: 3, "10": "ten", beta: 4 };
const o: object = w;
console.log(Object.keys(o).join(","));`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("an UNAMBIGUOUS out-of-order record crosses, because the SHAPE takes its order", () => {
  // The one construction the program makes IS the evidence, and there is
  // nothing of this shape to contradict it -- so declaredOrder is re-picked
  // to `tag,inner,middle` and the crossing materialises Node's own key list.
  // Nothing is excused here: the answer is given.
  const r = lower(`${ROW}
const w: Row = { tag: true, inner: 1, middle: "m" };
const o: object = w;
console.log(Object.keys(o).join(","));`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
});

test("a crossing whose source order the compiler cannot SEE advises, it does not refuse", () => {
  // `JSON.parse(s) as T` is right whenever the JSON text happens to be in
  // declaration order, and enough programs rely on that for a refusal to be
  // the wrong answer. It crosses with an SC6002 in hand instead.
  const r = lower(`${ROW}
const w = JSON.parse('{"tag":true,"inner":1,"middle":"m"}') as Row;
const o: object = w;
console.log(Object.keys(o).join(","));`);
  expect(crossing(r)).toEqual([]);
  expect(r.compiled).toBe(true);
  expect(r.advisories.filter((d) => d.code === "SC6002").length).toBeGreaterThan(0);
});

/* -- the REFUSING half: the widened surfaces, at their one cause ------- */

test("a local typed 'object' is a crossing, and it refuses", () => {
  const r = lower(`${OUT_OF_ORDER}
const o: object = w;
console.log(Object.keys(o).join(","));`);
  const rows = crossing(r);
  expect(rows.length).toBe(1);
  expect(rows[0]!.code).toBe("SC1090");
  expect(rows[0]!.hint).toContain("tag,inner,middle");
});

test("an ARGUMENT is a crossing, at the call", () => {
  const r = lower(`${OUT_OF_ORDER}
function f(o: object): string { return JSON.stringify(o); }
console.log(f(w));`);
  expect(crossing(r).length).toBe(1);
});

test("an 'unknown' slot is the same crossing wearing the other spelling", () => {
  const r = lower(`${OUT_OF_ORDER}
const u: unknown = w;
console.log(typeof u);`);
  expect(crossing(r).length).toBe(1);
});

test("an ARRAY of them crosses as one value, and the walker recurses", () => {
  // The case a top-level `value.type.kind === "record"` test misses, and 28
  // of the population's silent cells on its own.
  const r = lower(`${OUT_OF_ORDER}
const arr: object[] = [w];
console.log(Object.keys(arr[0]!).join(","));`);
  expect(crossing(r).length).toBeGreaterThan(0);
});

test("a record FIELD typed 'object' carries it one level in", () => {
  const r = lower(`${OUT_OF_ORDER}
const rec: { v: object } = { v: w };
console.log(Object.keys(rec.v).join(","));`);
  expect(crossing(r).length).toBeGreaterThan(0);
});

test("an element read out of an array whose construction the walk can NAME carries the risk", () => {
  const r = lower(`${OUT_OF_ORDER}
const arr: Row[] = [w];
const o: object = arr[0]!;
console.log(Object.keys(o).join(","));`);
  expect(crossing(r).length).toBeGreaterThan(0);
});

test("the SET half crosses too: a width copy ends keys JS keeps", () => {
  const r = lower(`interface Wide { inner: number; middle: string; tag: boolean; extra: string }
${ROW}
const wide: Wide = { inner: 1, middle: "m", tag: true, extra: "x" };
const narrow: Row = wide;
const o: object = narrow;
console.log(JSON.stringify(o));`);
  const rows = crossing(r);
  expect(rows.length).toBe(1);
  expect(rows[0]!.message).toContain("a width copy already ended");
});

test("a SPREAD of a bare identifier inherits its source's risk", () => {
  // `srcLowered` is deliberately null for an identifier source (the desugar
  // re-reads it per field), which is why this spelling - the commonest one
  // there is - inherited nothing before.
  const r = lower(`${OUT_OF_ORDER}
console.log(JSON.stringify({ ...w }));`);
  expect(
    r.diags.filter((d) => d.message.includes("does not build the way its shape enumerates")).length,
  ).toBe(1);
});

test("a spread of an IN-ORDER identifier inherits nothing", () => {
  const r = lower(`${IN_ORDER}
console.log(JSON.stringify({ ...w }));`);
  expect(r.diags).toEqual([]);
  expect(r.compiled).toBe(true);
});
