/* DERIVING A FRAGMENT FROM THE PRODUCT.
 *
 * The witness is read back out of the finished IR rather than captured at a
 * dozen Lowerer call sites, because an enumeration of call sites is an
 * enumeration of the input and those go stale. These tests pin the
 * derivations, and each carries a control — a derivation that returned
 * everything, or nothing, would satisfy the positive half alone.
 */
import { describe, expect, it } from "vitest";
import {
  calledFunctionNames,
  deriveHelpersReused,
  deriveReadEntities,
  partitionMints,
  referencedIds,
  type MintRecord,
} from "../src/frontend/lowering/fragment-build.js";
import type { ShapeLookup, UnionLookup } from "../src/frontend/lowering/structural-form.js";
import { F64, STRING, type IrRecordShape, type IrUnionDef } from "../src/ir/nodes.js";

function lookups(shapes: IrRecordShape[], unions: IrUnionDef[] = []): [ShapeLookup, UnionLookup] {
  const s = new Map(shapes.map((x) => [x.id, x]));
  const u = new Map(unions.map((x) => [x.id, x]));
  return [{ get: (id) => s.get(id) }, { get: (id) => u.get(id) }];
}

const SHAPES: IrRecordShape[] = [
  { id: "r0", fields: [{ name: "a", type: F64 }] },
  { id: "r1", fields: [{ name: "b", type: STRING }] },
  { id: "r2", fields: [{ name: "c", type: F64 }] },
  { id: "r9", fields: [{ name: "z", type: STRING }] },
];
const UNIONS: IrUnionDef[] = [{ id: "u0", arms: [F64, STRING] }];

describe("fragment build", () => {
  /* The three populations a fragment treats differently. Collection's ids
   * belong to no module and are REPRODUCED on every build; the tail's are
   * minted after every module's bodies are down; only the file loops become
   * fragment content. */
  it("partitions the mint log by phase, and keeps per-(module, loop) ordinals contiguous", () => {
    const [s, u] = lookups(SHAPES, UNIONS);
    const log: MintRecord[] = [
      { id: "r9", phase: "collect", key: "" },
      { id: "r0", phase: "body:/p/a.ts", key: "" },
      { id: "u0", phase: "body:/p/a.ts", key: "" },
      { id: "r1", phase: "body:/p/b.ts", key: "" },
      { id: "r2", phase: "init:/p/a.ts", key: "" },
    ];
    const p = partitionMints(log, s, u);

    expect([...p.byModule.keys()].sort()).toEqual(["/p/a.ts", "/p/b.ts"]);
    expect(p.collection.size).toBe(1);
    expect(p.tail.size).toBe(0);
    expect(p.unrecognised).toEqual([]);

    const a = p.byModule.get("/p/a.ts")!;
    expect(a.map((m) => m.localId)).toEqual(["r0", "u0", "r2"]);
    // Ordinals restart per (module, loop): the two loops do not overlap, so
    // body:0,1 and init:0 are distinct slots rather than a collision.
    expect(a.map((m) => `${m.loop}:${m.ordinal}`)).toEqual(["body:0", "body:1", "init:0"]);
    expect(p.byModule.get("/p/b.ts")!.map((m) => `${m.loop}:${m.ordinal}`)).toEqual(["body:0"]);
    expect(a[1]!.kind).toBe("union");
    // Structures, never ids.
    for (const m of a) expect(m.structure).not.toMatch(/^[ru][0-9]+$/);
  });

  /* An unrecognised phase means the emit pass grew a stage and the replay
   * assumption no longer holds. Counted, never dropped: a mint that vanishes
   * silently is a module missing ids it actually minted. */
  it("counts an unrecognised phase instead of dropping it", () => {
    const [s, u] = lookups(SHAPES, UNIONS);
    const p = partitionMints(
      [
        { id: "r0", phase: "body:/p/a.ts", key: "" },
        { id: "r1", phase: "someNewStage", key: "" },
        { id: "r2", phase: "someNewStage", key: "" },
      ],
      s,
      u,
    );
    expect(p.unrecognised).toEqual([{ phase: "someNewStage", count: 2 }]);
    // CONTROL: the recognised one still landed, so this is not a partition
    // that rejects everything.
    expect(p.byModule.get("/p/a.ts")).toHaveLength(1);
  });

  it("separates the tail, which belongs to no module", () => {
    const [s, u] = lookups(SHAPES, UNIONS);
    const p = partitionMints(
      [
        { id: "r0", phase: "body:/p/a.ts", key: "" },
        { id: "r1", phase: "tail:queues", key: "" },
      ],
      s,
      u,
    );
    expect(p.tail.size).toBe(1);
    expect(p.byModule.get("/p/a.ts")).toHaveLength(1);
    expect(p.byModule.has("queues")).toBe(false);
  });

  /* Scanning, not walking. A walk enumerates node kinds, and enumerating
   * node kinds is how structural-form.ts shipped with four unhandled ones. */
  it("finds referenced ids in any node shape, and ignores a lookalike string", () => {
    const ids = referencedIds([
      { kind: "recordGet", shapeId: "r0" },
      { kind: "someKindInventedLater", nested: [{ unionId: "u0" }] },
      { kind: "strLit", value: "r404" },
    ]);
    expect([...ids].sort()).toEqual(["r0", "u0"]);

    // CONTROL: a value with no ids yields none, so the scan is not matching
    // anything that merely looks structured.
    expect(referencedIds([{ kind: "numLit", value: 1 }]).size).toBe(0);
  });

  it("derives read entities as referenced-minus-minted, with structures", () => {
    const [s, u] = lookups(SHAPES, UNIONS);
    const read = deriveReadEntities(new Set(["r0", "r9", "u0"]), new Set(["r0"]), s, u);
    expect(read.map((r) => r.localId)).toEqual(["r9", "u0"]);
    expect(read.map((r) => r.kind)).toEqual(["record", "union"]);
    for (const r of read) expect(r.structure).not.toMatch(/^[ru][0-9]+$/);

    // CONTROL: minting everything referenced leaves nothing read, so the
    // derivation is a real subtraction and not a pass-through.
    expect(deriveReadEntities(new Set(["r0"]), new Set(["r0"]), s, u)).toEqual([]);
  });

  it("counts reused helpers by intern key, skipping ones defined here and plain calls", () => {
    const called = ["%obj.keys.3", "%obj.keys.3", "%mine", "%ordinary.fn", "%obj.values.1"];
    const internKeyOf = (n: string): string | undefined =>
      n === "%obj.keys.3" ? "obj.keys:rX" : n === "%obj.values.1" ? "obj.values:rY" : n === "%mine" ? "obj.keys:rZ" : undefined;

    const reused = deriveHelpersReused(called, new Set(["%mine"]), internKeyOf);
    expect(reused).toEqual([
      { internKey: "obj.keys:rX", sites: 2 },
      { internKey: "obj.values:rY", sites: 1 },
    ]);

    // CONTROLS, both directions: a helper DEFINED here is not reused, and an
    // ordinary call is not a helper at all. Without these, a derivation that
    // returned every called name would pass the assertion above.
    expect(deriveHelpersReused(["%mine"], new Set(["%mine"]), internKeyOf)).toEqual([]);
    expect(deriveHelpersReused(["%ordinary.fn"], new Set(), internKeyOf)).toEqual([]);
  });

  it("finds called names under both callee and fnName", () => {
    expect(calledFunctionNames([{ kind: "call", callee: "%a" }, { kind: "closure", fnName: "%b" }]))
      .toEqual(["%a", "%b"]);
    expect(calledFunctionNames([{ kind: "numLit", value: 1 }])).toEqual([]);
  });
});
