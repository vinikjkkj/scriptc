/* The number-slot pass (ir/num-slot.ts): which constructor-written dyn fields become a raw double with a marker slot.
 *   - positive control: a field written from a property read of a parameter and read in arithmetic is picked, its class gains the hidden f64 half after
 *     its own fields, and the module still validates;
 *   - negative controls: a pointer-only field (no numeric use), a call result, a copy of another field, an in-range literal and a field written outside
 *     the constructor are all refused;
 *   - SCRIPTC_NUMSLOT=off picks nothing, and a second run over an already split module is a no-op. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { loadProgram } from "../src/frontend/program.js";
import { lowerToIr } from "../src/frontend/lowering/lowerer.js";
import { validateModule } from "../src/ir/validate.js";
import { numSlotPass } from "../src/ir/num-slot.js";
import type { IrModule } from "../src/ir/nodes.js";

const SRC = `
class Packet {
  buffer: any;
  offset: number;
  constructor(b: any) { this.buffer = b; this.offset = 4096; }
  readInt8(): any { return (this.buffer as any)[this.offset++]; }
}
class Col {
  _buf: any;
  start: any;
  len: any;
  tp: any;
  small: any;
  moved: any;
  constructor(packet: any) {
    this._buf = packet.buffer;
    this.start = packet.offset;
    this.len = packet.readInt8();
    this.tp = this.len;
    this.small = 5;
    this.moved = packet.offset;
  }
  relocate(v: any): void { this.moved = v; }
  get piece(): any { return this._buf.slice(this.start, this.start + this.len + this.small + this.moved); }
}
const c: any = new Col(new Packet([1, 2, 3]));
console.log(c.piece);
`;

function lower(src: string = SRC): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-numslot-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, src);
  const load = loadProgram(entry);
  try {
    const r = lowerToIr(load.program, load.entry, load.moduleOrder);
    if (r.module === null) throw new Error(`lowering refused: ${r.diagnostics.map((d) => d.code).join(", ")}`);
    return r.module;
  } finally {
    load.dispose();
  }
}

afterEach(() => delete process.env["SCRIPTC_NUMSLOT"]);

test("a property-read field with a numeric use is split; pointer-only, call, copy, literal and outside-written fields are not", () => {
  const m = lower();
  const picks = numSlotPass(m).map((p) => `${p.className}.${p.field}`);
  expect(picks).toEqual(["Col.start"]);
  const col = m.classes!.find((c) => c.name === "Col")!;
  expect(col.numSlots).toEqual([{ field: "start", half: "%nsw:Col:0", lane: 0 }]);
  expect(col.fields.map((f) => f.name)).toEqual(["_buf", "start", "len", "tp", "small", "moved", "%nsw:Col:0"]);
  expect(col.fields[col.fields.length - 1]!.type.kind).toBe("f64");
  expect(validateModule(m)).toEqual([]);
});

test("a second run over a split module is a no-op", () => {
  const m = lower();
  expect(numSlotPass(m).length).toBe(1);
  expect(numSlotPass(m)).toEqual([]);
  expect(m.classes!.find((c) => c.name === "Col")!.fields.filter((f) => f.name === "%nsw:Col:0").length).toBe(1);
});

test("SCRIPTC_NUMSLOT=off picks nothing", () => {
  process.env["SCRIPTC_NUMSLOT"] = "off";
  const m = lower();
  expect(numSlotPass(m)).toEqual([]);
  expect(m.classes!.some((c) => c.numSlots !== undefined)).toBe(false);
});

test("five picked fields share two hidden words, four 16-bit lanes each, in pick order", () => {
  const src = `
class Cell {
  a: any; b: any; c: any; d: any; e: any;
  constructor(s: any) { this.a = s.p; this.b = s.q; this.c = s.r; this.d = s.t; this.e = s.u; }
  sum(): any { return this.a + this.b + this.c + this.d + this.e; }
}
const x: any = new Cell({ p: 1, q: 2, r: 3, t: 4, u: 5 });
console.log(x.sum());
`;
  const m = lower(src);
  expect(numSlotPass(m).map((p) => p.field)).toEqual(["a", "b", "c", "d", "e"]);
  const cell = m.classes!.find((c) => c.name === "Cell")!;
  expect(cell.numSlots).toEqual([
    { field: "a", half: "%nsw:Cell:0", lane: 0 },
    { field: "b", half: "%nsw:Cell:0", lane: 1 },
    { field: "c", half: "%nsw:Cell:0", lane: 2 },
    { field: "d", half: "%nsw:Cell:0", lane: 3 },
    { field: "e", half: "%nsw:Cell:1", lane: 0 },
  ]);
  // the control the lanes exist for: five halves of 8 B became two words of 8 B
  expect(cell.fields.filter((f) => f.name.startsWith("%ns")).map((f) => f.name)).toEqual(["%nsw:Cell:0", "%nsw:Cell:1"]);
  expect(validateModule(m)).toEqual([]);
});
