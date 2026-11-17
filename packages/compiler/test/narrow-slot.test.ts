/* The narrow-slot pass (ir/narrow-slot.ts): which standalone classes give their numeric dyn fields 32-bit lanes.
 *   - positive control: a class with five constructor-written numeric fields is narrowed: the fields stay in `fields` (name-based consumers) beside
 *     the hidden lane words, the 16-bit mask word and the overflow pointer, and `narrow` lists them in order; the module still validates;
 *   - negative controls: a class with fewer than four eligible fields, a class with a subclass and a field written outside the constructor are not
 *     (or are refused field by field);
 *   - the layout control: storageFields() leaves exactly the narrow fields out;
 *   - SCRIPTC_NARROW=off picks nothing, and a second run over a narrowed module is a no-op. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { validateModule } from "../src/ir/validate.js";
import { narrowSlotPass } from "../src/ir/narrow-slot.js";
import { numSlotPass } from "../src/ir/num-slot.js";
import { storageFields, type IrModule } from "../src/ir/nodes.js";

const SRC = `
class Five {
  a: any; b: any; c: any; d: any; e: any; tag: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e; this.tag = "t"; }
  total(): any { return this.a + this.b + this.c + this.d + this.e; }
}
class Three {
  a: any; b: any; c: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; }
  total(): any { return this.a + this.b + this.c; }
}
class Base {
  a: any; b: any; c: any; d: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; }
  total(): any { return this.a + this.b + this.c + this.d; }
}
class Derived extends Base {}
class Moved {
  a: any; b: any; c: any; d: any; e: any;
  constructor(s: any) { this.a = s.a; this.b = s.b; this.c = s.c; this.d = s.d; this.e = s.e; }
  relocate(v: any): void { this.e = v; }
  total(): any { return this.a + this.b + this.c + this.d + this.e; }
}
const o: any = { a: 1, b: 2, c: 3, d: 4, e: 5 };
const mv = new Moved(o);
mv.relocate(7);
console.log(new Five(o).total(), new Three(o).total(), new Derived(o).total(), mv.total());
`;

function lower(): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-narrow-"));
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

afterEach(() => delete process.env["SCRIPTC_NARROW"]);

test("a class with five numeric fields is narrowed; three fields and a subclassed class are not; an outside-written field is left out of its class's lanes", () => {
  const m = lower();
  expect(narrowSlotPass(m).sort()).toEqual(["Five.a", "Five.b", "Five.c", "Five.d", "Five.e", "Moved.a", "Moved.b", "Moved.c", "Moved.d"]);
  const five = m.classes!.find((c) => c.name === "Five")!;
  expect(five.narrow).toEqual({ fields: ["a", "b", "c", "d", "e"], lanes: ["%nwl:Five:0", "%nwl:Five:1", "%nwl:Five:2"], mask: "%nwm:Five", ext: "%nwx:Five" });
  expect(five.fields.map((f) => f.name)).toEqual(["a", "b", "c", "d", "e", "tag", "%nwl:Five:0", "%nwl:Five:1", "%nwl:Five:2", "%nwm:Five", "%nwx:Five"]);
  expect(storageFields(five).map((f) => f.name)).toEqual(["tag", "%nwl:Five:0", "%nwl:Five:1", "%nwl:Five:2", "%nwm:Five", "%nwx:Five"]);
  for (const name of ["Three", "Base", "Derived"]) expect(m.classes!.find((c) => c.name === name)!.narrow).toBeUndefined();
  // `Moved.e` is rewritten by relocate(): it keeps its slot and stays out of the lanes
  expect(m.classes!.find((c) => c.name === "Moved")!.narrow!.fields).toEqual(["a", "b", "c", "d"]);
  expect(validateModule(m)).toEqual([]);
});

test("the number-slot pass leaves a narrow field alone", () => {
  const m = lower();
  narrowSlotPass(m);
  numSlotPass(m);
  expect(m.classes!.find((c) => c.name === "Five")!.numSlots).toBeUndefined();
});

test("a second run over a narrowed module is a no-op, and SCRIPTC_NARROW=off picks nothing", () => {
  const m = lower();
  expect(narrowSlotPass(m).length).toBe(9);
  expect(narrowSlotPass(m)).toEqual([]);
  expect(m.classes!.find((c) => c.name === "Five")!.fields.filter((f) => f.name === "%nwm:Five").length).toBe(1);
  process.env["SCRIPTC_NARROW"] = "off";
  expect(narrowSlotPass(lower())).toEqual([]);
});
