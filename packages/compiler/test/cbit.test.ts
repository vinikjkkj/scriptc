/* The container-bit gate pass (ir/cbit.ts): which classes may skip the cycle collector while none of their fields holds a container.
 *   - positive control: a standalone class whose only reference-holding fields are dyn is gated;
 *   - negative controls: a class with a typed edge, a hierarchy (base and derived), and a class with a typed-array field are refused;
 *   - SCRIPTC_CBIT=off gates nothing, and a second run over a gated module is a no-op. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { validateModule } from "../src/ir/validate.js";
import { cbitPass } from "../src/ir/cbit.js";
import type { IrModule } from "../src/ir/nodes.js";

const SRC = `
class Leafy { a: any; n: number; s: string; constructor(x: any) { this.a = x; this.n = 1; this.s = "s"; } }
class Edge { next: Edge | null; v: any; constructor() { this.next = null; this.v = 1; } }
class Arr { items: number[]; v: any; constructor() { this.items = [1]; this.v = 1; } }
class Base { v: any; constructor() { this.v = 1; } }
class Derived extends Base { w: any; constructor() { super(); this.w = 2; } }
const a = new Leafy(1), b = new Edge(), c = new Arr(), d = new Derived();
console.log(a.n, b.v, c.items.length, d.w);
`;

function lower(): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-cbit-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, SRC);
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) throw new Error(`lowering refused: ${r.diagnostics.map((d) => d.code).join(", ")}`);
    return r.module;
  } finally {
    load.dispose();
  }
}

afterEach(() => delete process.env["SCRIPTC_CBIT"]);

test("a standalone class with only dyn reference fields is gated; typed edges, arrays and hierarchies are not", () => {
  const m = lower();
  const gated = cbitPass(m).map((n) => n.replace(/^%[^.]*\./, ""));
  expect(gated).toEqual(["Leafy"]);
  expect(m.classes!.filter((c) => c.cbit === true).map((c) => c.name.replace(/^%[^.]*\./, ""))).toEqual(["Leafy"]);
  expect(validateModule(m)).toEqual([]);
});

test("a second run over a gated module is a no-op", () => {
  const m = lower();
  expect(cbitPass(m).length).toBe(1);
  expect(cbitPass(m)).toEqual([]);
});

test("SCRIPTC_CBIT=off gates nothing", () => {
  process.env["SCRIPTC_CBIT"] = "off";
  const m = lower();
  expect(cbitPass(m)).toEqual([]);
  expect(m.classes!.some((c) => c.cbit === true)).toBe(false);
});
