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

function lower(): IrModule {
  const dir = mkdtempSync(join(tmpdir(), "scriptc-numslot-"));
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

afterEach(() => delete process.env["SCRIPTC_NUMSLOT"]);

test("a property-read field with a numeric use is split; pointer-only, call, copy, literal and outside-written fields are not", () => {
  const m = lower();
  const picks = numSlotPass(m).map((p) => `${p.className}.${p.field}`);
  expect(picks).toEqual(["Col.start"]);
  const col = m.classes!.find((c) => c.name === "Col")!;
  expect(col.numSlots).toEqual([{ field: "start", half: "%ns:start" }]);
  expect(col.fields.map((f) => f.name)).toEqual(["_buf", "start", "len", "tp", "small", "moved", "%ns:start"]);
  expect(col.fields[col.fields.length - 1]!.type.kind).toBe("f64");
  expect(validateModule(m)).toEqual([]);
});

test("a second run over a split module is a no-op", () => {
  const m = lower();
  expect(numSlotPass(m).length).toBe(1);
  expect(numSlotPass(m)).toEqual([]);
  expect(m.classes!.find((c) => c.name === "Col")!.fields.filter((f) => f.name === "%ns:start").length).toBe(1);
});

test("SCRIPTC_NUMSLOT=off picks nothing", () => {
  process.env["SCRIPTC_NUMSLOT"] = "off";
  const m = lower();
  expect(numSlotPass(m)).toEqual([]);
  expect(m.classes!.some((c) => c.numSlots !== undefined)).toBe(false);
});
