/* THE ID-FREE STRUCTURAL FORM — the property a per-module fragment rests on.
 *
 * `r3541` names a record only inside the build that minted it. If two builds
 * of the same source cannot agree on what an entity IS without agreeing on
 * its number, no fragment can be reused across them. Every test here is a
 * property of that agreement, and each carries a control: a comparison that
 * always agreed would satisfy all of them.
 */
import { describe, expect, it } from "vitest";
import {
  assertNoIdLeak,
  structuralForm,
  newStructuralFormCache,
  structuralFormIsOpaque,
  structuralIdentityFields,
  type ShapeLookup,
  type UnionLookup,
} from "../src/frontend/lowering/structural-form.js";
import { BOOL, F64, STRING, type IrRecordShape, type IrType, type IrUnionDef } from "../src/ir/nodes.js";

function lookups(shapes: IrRecordShape[], unions: IrUnionDef[] = []): [ShapeLookup, UnionLookup] {
  const s = new Map(shapes.map((x) => [x.id, x]));
  const u = new Map(unions.map((x) => [x.id, x]));
  return [{ get: (id) => s.get(id) }, { get: (id) => u.get(id) }];
}
const rec = (shapeId: string): IrType => ({ kind: "record", shapeId });
const uni = (unionId: string): IrType => ({ kind: "union", unionId });

describe("structural form", () => {
  /* THE CORE PROPERTY, and the regression test for the defect that made this
   * module necessary. ShapeRegistry.keyOf spells a nested type as
   * "record:r3541", so it is structural exactly ONE level deep. A build that
   * minted one extra shape early shifts every nested reference below it, and
   * identical entities then compare as different — 28 of them, symmetrically,
   * in this block's first cross-build comparison. Here the same two entities
   * are numbered r0/r1 in one build and r7/r8 in the other. */
  it("gives the same form to the same entity under different numbering", () => {
    const [sA, uA] = lookups([
      { id: "r0", fields: [{ name: "v", type: F64 }] },
      { id: "r1", fields: [{ name: "inner", type: rec("r0") }, { name: "n", type: STRING }] },
    ]);
    const [sB, uB] = lookups([
      { id: "r7", fields: [{ name: "v", type: F64 }] },
      { id: "r8", fields: [{ name: "inner", type: rec("r7") }, { name: "n", type: STRING }] },
    ]);
    expect(structuralForm(rec("r1"), sA, uA)).toBe(structuralForm(rec("r8"), sB, uB));

    // CONTROL: a genuinely different entity must NOT collide. Without this, a
    // form that returned a constant would pass the line above.
    const [sC, uC] = lookups([
      { id: "r7", fields: [{ name: "v", type: STRING }] },
      { id: "r8", fields: [{ name: "inner", type: rec("r7") }, { name: "n", type: STRING }] },
    ]);
    expect(structuralForm(rec("r8"), sC, uC)).not.toBe(structuralForm(rec("r1"), sA, uA));
  });

  /* RULE 3, mechanically. ownmask / reqabsent / srcproto are written by
   * armOwnMasks, which runs after the last body is down and is replayed on
   * every build. A fragment storing them would be storing a decision another
   * library's code is allowed to change, so they must not move the form. */
  it("ignores the fields a later pass writes, and notices the fields it does not", () => {
    const plain: IrRecordShape = { id: "r0", fields: [{ name: "a", type: F64 }] };
    const [sP, uP] = lookups([plain]);
    const [sA, uA] = lookups([{ ...plain, ownmask: true, reqabsent: true, srcproto: true }]);
    expect(structuralForm(rec("r0"), sA, uA)).toBe(structuralForm(rec("r0"), sP, uP));

    // CONTROL: an IDENTITY field must move it, or the assertion above only
    // proves the form ignores everything.
    const [sT, uT] = lookups([{ ...plain, tuple: true }]);
    expect(structuralForm(rec("r0"), sT, uT)).not.toBe(structuralForm(rec("r0"), sP, uP));
    const [sO, uO] = lookups([{ ...plain, declaredOrder: ["a"] }]);
    expect(structuralForm(rec("r0"), sO, uO)).not.toBe(structuralForm(rec("r0"), sP, uP));
  });

  it("classifies every shape and union field, with the later-pass ones excluded", () => {
    // The Record<keyof IrRecordShape, ...> inside the module makes the
    // classification exhaustive at COMPILE time; this pins which side each
    // field landed on, so moving one is a red test rather than a quiet
    // behaviour change.
    expect([...structuralIdentityFields.shapeExcluded].sort())
      .toEqual(["id", "ownmask", "reqabsent", "srcproto"]);
    expect([...structuralIdentityFields.shape].sort())
      .toEqual(["builtin", "declaredOrder", "fields", "indexValue", "tostr", "tuple"]);
    expect([...structuralIdentityFields.unionExcluded].sort()).toEqual(["id"]);
  });

  /* A recursive shape references itself: without a cut the walk does not
   * terminate, and with a positional cut it would spell differently depending
   * on where the walk entered. The De Bruijn back-reference gives it one. */
  it("cuts cycles with one canonical spelling, and terminates", () => {
    const [s, u] = lookups([
      { id: "r0", fields: [{ name: "next", type: rec("r0") }, { name: "v", type: F64 }] },
    ]);
    const form = structuralForm(rec("r0"), s, u);
    expect(form).toContain("%back(1)");
    const [s2, u2] = lookups([
      { id: "r9", fields: [{ name: "next", type: rec("r9") }, { name: "v", type: F64 }] },
    ]);
    expect(structuralForm(rec("r9"), s2, u2)).toBe(form);
  });

  /* THE MEMO MUST NOT HAND ONE PATH'S ANSWER TO ANOTHER.
   *
   * Walking the DAG as a tree exhausted a 4 GB heap on zapo and aborted the
   * compiler, so forms are memoised by id. But `%back(k)` is PATH-DEPENDENT:
   * it counts depth from where the walk entered, so a shape inside a cycle
   * has different forms down different paths. Caching that by id alone is
   * the exact hazard the dyncheck memo-scope fence names -- an answer
   * derived under one context served under another, silently.
   *
   * So only forms with no %back are cached. These assertions pin both
   * halves: the acyclic one is stable across entry points (so the memo is
   * doing its job), and the cyclic one is correct from each entry (so the
   * memo is not poisoning it). */
  it("memoises path-independent forms and recomputes path-dependent ones", () => {
    // A -> B -> C, and D -> C. C is shared: the DAG case the memo exists for.
    const [s, u] = lookups([
      { id: "rC", fields: [{ name: "c", type: F64 }] },
      { id: "rB", fields: [{ name: "b", type: rec("rC") }] },
      { id: "rA", fields: [{ name: "a", type: rec("rB") }, { name: "a2", type: rec("rC") }] },
      { id: "rD", fields: [{ name: "d", type: rec("rC") }] },
    ]);
    const cache = newStructuralFormCache();
    const viaA = structuralForm(rec("rA"), s, u, [], cache);
    const viaD = structuralForm(rec("rD"), s, u, [], cache);
    const cAlone = structuralForm(rec("rC"), s, u, [], cache);
    // C's form is the same wherever it is reached from, which is what makes
    // caching it sound.
    expect(viaA).toContain(cAlone);
    expect(viaD).toContain(cAlone);

    // CYCLE: X -> Y -> X. Entering at X and at Y must give DIFFERENT forms,
    // and a memo that cached either would corrupt the other.
    const [cs, cu] = lookups([
      { id: "rX", fields: [{ name: "y", type: rec("rY") }] },
      { id: "rY", fields: [{ name: "x", type: rec("rX") }] },
    ]);
    const cyc = newStructuralFormCache();
    const fromX = structuralForm(rec("rX"), cs, cu, [], cyc);
    const fromY = structuralForm(rec("rY"), cs, cu, [], cyc);
    expect(fromX).not.toBe(fromY);
    // ...and asking again, with the memo warm, must give the SAME answers:
    // if a path-dependent form had been cached, one of these would flip.
    expect(structuralForm(rec("rX"), cs, cu, [], cyc)).toBe(fromX);
    expect(structuralForm(rec("rY"), cs, cu, [], cyc)).toBe(fromY);
  });

  /* A form past the budget is replaced by its digest. Identity survives --
   * a digest is as unique as what it digests -- while a pathological type
   * cannot cost more than a hash. */
  it("digests a form past the budget, and keeps distinct types distinct", () => {
    const wide = (n: number, t: IrType): IrRecordShape => ({
      id: "r0",
      fields: Array.from({ length: n }, (_, i) => ({ name: "f" + String(i).padStart(40, "x"), type: t })),
    });
    const [s1, u1] = lookups([wide(200, F64)]);
    const [s2, u2] = lookups([wide(200, STRING)]);
    const a = structuralForm(rec("r0"), s1, u1);
    const b = structuralForm(rec("r0"), s2, u2);
    expect(a.startsWith("%digest:")).toBe(true);
    expect(b.startsWith("%digest:")).toBe(true);
    expect(a).not.toBe(b);

    // CONTROL: an ordinary shape is NOT digested, or the budget would be
    // erasing the structure every comparison depends on.
    const [s3, u3] = lookups([{ id: "r0", fields: [{ name: "a", type: F64 }] }]);
    expect(structuralForm(rec("r0"), s3, u3).startsWith("%digest:")).toBe(false);
  });

  it("marks an unresolvable placeholder opaque instead of comparing it as equal", () => {
    const [s, u] = lookups([{ id: "r0", fields: [{ name: "x", type: rec("r-missing") }] }]);
    expect(structuralFormIsOpaque(structuralForm(rec("r0"), s, u))).toBe(true);
    const [s2, u2] = lookups([{ id: "r0", fields: [{ name: "x", type: F64 }] }]);
    expect(structuralFormIsOpaque(structuralForm(rec("r0"), s2, u2))).toBe(false);
  });

  /* Every IrType kind that carries a nested IrType must be EXPANDED. Four of
   * the eight were missing when this module was first written — weakmap,
   * generator, asyncGenerator and func — and each would have JSON-stringified
   * a literal shapeId into a form whose whole purpose is to contain none. */
  it("expands every type kind that carries a nested type, unions included", () => {
    const [s, u] = lookups(
      [{ id: "r0", fields: [{ name: "v", type: F64 }] }],
      [{ id: "u0", arms: [rec("r0"), STRING] }],
    );
    const [s2, u2] = lookups(
      [{ id: "r5", fields: [{ name: "v", type: F64 }] }],
      [{ id: "u3", arms: [rec("r5"), STRING] }],
    );
    const nest = (r: string, n: string): IrType[] => [
      { kind: "array", elem: rec(r) },
      { kind: "set", elem: rec(r) },
      { kind: "promise", inner: rec(r) },
      { kind: "map", key: STRING, value: rec(r) },
      { kind: "weakmap", key: rec(r), value: F64 },
      { kind: "generator", yieldT: rec(r), retT: BOOL, nextT: F64 },
      { kind: "asyncGenerator", yieldT: rec(r), retT: BOOL, nextT: F64 },
      { kind: "func", params: [rec(r)], ret: uni(n) },
      uni(n),
    ];
    const a = nest("r0", "u0");
    const b = nest("r5", "u3");
    for (let i = 0; i < a.length; i++) {
      const fa = structuralForm(a[i]!, s, u);
      expect(fa, `kind ${a[i]!.kind} did not agree across numbering`).toBe(structuralForm(b[i]!, s2, u2));
      expect(() => assertNoIdLeak(fa, `kind ${a[i]!.kind}`)).not.toThrow();
    }
  });

  /* THE GUARD, POSITIVE-CONTROLLED. It has to have said 1 at least once, or
   * "no leaks detected" is the same statement as "nothing was checked". */
  it("the id-leak guard fires on a leaked id and is silent on a clean form", () => {
    const leakedShape = JSON.stringify({ kind: "someNewKind", shapeId: "r7" });
    const leakedUnion = JSON.stringify({ kind: "otherNewKind", unionId: "u3" });
    expect(() => assertNoIdLeak(leakedShape, "a made-up kind")).toThrowError(/contains a positional id/);
    expect(() => assertNoIdLeak(leakedUnion, "a made-up kind")).toThrowError(/contains a positional id/);
    expect(() => assertNoIdLeak("record{a:f64}", "a clean form")).not.toThrow();
  });
});
