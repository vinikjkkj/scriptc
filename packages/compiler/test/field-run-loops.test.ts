/* The field-run loop of the Object.entries / Object.values / width-reshape helpers (ir/field-run-loops.ts).
 *   - a wide uniform record's helper is a loop over recordGetAt / recordKeyPresentAt / runKeyAt (positive control), and SCRIPTC_FIELD_LOOP_MIN=0 leaves the
 *     unrolled per-member statements (negative control);
 *   - the validator accepts the loop and REJECTS a malformed index: out of range, negative, fractional, an empty run, a duplicated run member, a non-f64 index. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { validateModule } from "../src/ir/validate.js";
import type { IrModule } from "../src/ir/nodes.js";

function source(n: number): string {
  const L = ["type W = {"];
  for (let i = 0; i < n; i++) L.push(`  c${i}: number;`);
  L.push("};", "const w: W = {");
  for (let i = 0; i < n; i++) L.push(`  c${i}: ${i},`);
  L.push("};", "console.log(Object.entries(w).length, Object.values(w).length);");
  return L.join("\n") + "\n";
}

function lowerWith(n: number, min: string | undefined): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-runloop-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, source(n));
  if (min === undefined) delete process.env["SCRIPTC_FIELD_LOOP_MIN"];
  else process.env["SCRIPTC_FIELD_LOOP_MIN"] = min;
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) throw new Error(`lowering refused: ${r.diagnostics.map((d) => d.code).join(", ")}`);
    return r.module;
  } finally {
    load.dispose();
  }
}

type Obj = Record<string, unknown>;
function nodes(root: unknown, kind: string): Obj[] {
  const out: Obj[] = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) return void n.forEach(walk);
    const o = n as Obj;
    if (o["kind"] === kind) out.push(o);
    for (const v of Object.values(o)) walk(v);
  };
  walk(root);
  return out;
}
const helpers = (m: IrModule) => m.functions.filter((f) => /^%(obj\.entries|obj\.values)\./.test(f.name));

afterEach(() => delete process.env["SCRIPTC_FIELD_LOOP_MIN"]);

test("a wide uniform record's helpers are loops, and MIN=0 keeps them unrolled", () => {
  const on = lowerWith(20, undefined);
  expect(validateModule(on)).toEqual([]);
  expect(helpers(on).length).toBeGreaterThan(0);
  expect(helpers(on).some((f) => nodes(f.body, "recordGetAt").length > 0)).toBe(true);
  expect(helpers(on).some((f) => nodes(f.body, "runKeyAt").length > 0)).toBe(true);
  const off = lowerWith(20, "0");
  expect(helpers(off).some((f) => nodes(f.body, "recordGetAt").length > 0)).toBe(false);
  expect(helpers(off).some((f) => nodes(f.body, "recordGet").length >= 20)).toBe(true);
  // a narrow record stays unrolled
  expect(helpers(lowerWith(4, undefined)).some((f) => nodes(f.body, "recordGetAt").length > 0)).toBe(false);
});

test("the validator rejects a malformed field-run index", () => {
  const bad = (mutate: (n: Obj) => void): number => {
    const m = lowerWith(20, undefined);
    const n = helpers(m).flatMap((f) => nodes(f.body, "recordGetAt"))[0]!;
    mutate(n);
    return validateModule(m).length;
  };
  expect(bad(() => undefined)).toBe(0);
  expect(bad((n) => (n["index"] = { kind: "numLit", value: 20, type: { kind: "f64" }, loc: n["loc"] }))).toBeGreaterThan(0);
  expect(bad((n) => (n["index"] = { kind: "numLit", value: -1, type: { kind: "f64" }, loc: n["loc"] }))).toBeGreaterThan(0);
  expect(bad((n) => (n["index"] = { kind: "numLit", value: 1.5, type: { kind: "f64" }, loc: n["loc"] }))).toBeGreaterThan(0);
  expect(bad((n) => (n["run"] = []))).toBeGreaterThan(0);
  expect(bad((n) => (n["run"] = [(n["run"] as string[])[0], (n["run"] as string[])[0]]))).toBeGreaterThan(0);
  expect(bad((n) => (n["index"] = { kind: "boolLit", value: true, type: { kind: "bool" }, loc: n["loc"] }))).toBeGreaterThan(0);
});

test("an all-optional record loops too: its two statements per member form one unit and the own-bit read is a recordKeyPresentAt", () => {
  const L = ["interface C { code: number }", "type O = {"];
  for (let i = 0; i < 12; i++) L.push(`  o${i}?: C;`);
  L.push("};", "function through(x: unknown): O { return x as O; }", "const o = through(JSON.parse('{\"o1\":{\"code\":1}}'));", "console.log(Object.entries(o).length, Object.values(o).length);");
  const dir = mkdtempSync(join(tmpdir(), "scriptc-runloop-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, L.join("\n") + "\n");
  delete process.env["SCRIPTC_FIELD_LOOP_MIN"];
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) throw new Error("lowering refused");
    expect(validateModule(r.module)).toEqual([]);
    expect(helpers(r.module).some((f) => nodes(f.body, "recordKeyPresentAt").length > 0)).toBe(true);
    expect(helpers(r.module).some((f) => nodes(f.body, "recordKeyPresent").length > 0)).toBe(false);
  } finally {
    load.dispose();
  }
});

/** A record whose members have three kinds interleaved in key order (the shape of zapo's WA_ABPROPS): no run of one kind is long, so only a MIXED run loops. */
function mixedSource(n: number): string {
  const kinds = ["BoolP", "NumP", "StrP"];
  const pattern = [0, 1, 2, 0, 0, 1, 2, 1, 0, 2];
  const pick = (i: number): string => kinds[pattern[i % pattern.length]!]!;
  const L = ["interface BoolP { code: number; type: 'boolean'; def: boolean }", "interface NumP { code: number; type: 'int'; def: number }", "interface StrP { code: number; type: 'string'; def: string }", "type M = {"];
  for (let i = 0; i < n; i++) L.push(`  m${i}: ${pick(i)};`);
  L.push("};", "const m: M = {");
  for (let i = 0; i < n; i++) {
    const k = pick(i);
    L.push(`  m${i}: ${k === "BoolP" ? `{ code: ${i}, type: 'boolean', def: true }` : k === "NumP" ? `{ code: ${i}, type: 'int', def: ${i} }` : `{ code: ${i}, type: 'string', def: 's${i}' }`},`);
  }
  L.push("};", "console.log(Object.entries(m).length, Object.values(m).length);");
  return L.join("\n") + "\n";
}

function lowerMixed(n: number, min: string | undefined): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-runloop-mixed-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, mixedSource(n));
  if (min === undefined) delete process.env["SCRIPTC_FIELD_LOOP_MIN"];
  else process.env["SCRIPTC_FIELD_LOOP_MIN"] = min;
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) throw new Error(`lowering refused: ${r.diagnostics.map((d) => d.code).join(", ")}`);
    return r.module;
  } finally {
    load.dispose();
  }
}

test("interleaved member kinds loop as ONE mixed run with a kind table, and MIN=0 keeps them unrolled", () => {
  const on = lowerMixed(30, undefined);
  expect(validateModule(on)).toEqual([]);
  const kt = helpers(on).flatMap((f) => nodes(f.body, "runKindAt"));
  expect(kt.length, "one kind table per looped helper").toBeGreaterThan(0);
  expect(new Set((kt[0]!["kinds"] as number[])).size, "three kinds").toBe(3);
  expect((kt[0]!["kinds"] as number[]).length, "the table covers the whole member list").toBe(30);
  const off = lowerMixed(30, "0");
  expect(helpers(off).flatMap((f) => nodes(f.body, "runKindAt")).length).toBe(0);
  expect(helpers(off).some((f) => nodes(f.body, "recordGet").length >= 30)).toBe(true);
});

test("the validator rejects a malformed kind table", () => {
  const bad = (mutate: (n: Obj) => void): number => {
    const m = lowerMixed(30, undefined);
    const n = helpers(m).flatMap((f) => nodes(f.body, "runKindAt"))[0]!;
    mutate(n);
    return validateModule(m).length;
  };
  expect(bad(() => undefined)).toBe(0);
  expect(bad((n) => (n["kinds"] = []))).toBeGreaterThan(0);
  expect(bad((n) => (n["kinds"] = [0, 1.5, 2]))).toBeGreaterThan(0);
  expect(bad((n) => (n["kinds"] = [0, 256, 2]))).toBeGreaterThan(0);
  expect(bad((n) => (n["index"] = { kind: "numLit", value: 99, type: { kind: "f64" }, loc: n["loc"] }))).toBeGreaterThan(0);
  expect(bad((n) => (n["index"] = { kind: "boolLit", value: true, type: { kind: "bool" }, loc: n["loc"] }))).toBeGreaterThan(0);
});
