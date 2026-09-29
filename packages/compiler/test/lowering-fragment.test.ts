/* THE PER-MODULE LOWERING FRAGMENT's rules, each pinned by a test that can
 * fail.
 *
 * The rules are in fragment.ts and they are not stylistic. Each one, broken,
 * produces a build that SUCCEEDS and emits a valid program that is not the
 * program the source describes — which is why they are assertions in the
 * compiler rather than notes in a design document, and why every test here
 * carries a control: a check that has only ever agreed cannot report a
 * disagreement.
 *
 * Several of these are CONTROLS FOR CODE THAT DOES NOT EXIST YET — the
 * producer and the assembly. That is deliberate and it is the better order:
 * a control written after an implementation gets fitted to what the
 * implementation does. Writing these first has already paid twice. The mint
 * table had no `localId`, so nothing could map an `r3541` in a stored body
 * to what it means and the fragment was unreplayable; and the witness
 * recorded shapes but not unions, so every union a body named was
 * unresolvable. Both were found by writing the check, not the code.
 */
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_VERSION,
  assertFragmentOwnsNoCollectionIds,
  canonicalJson,
  fragmentKey,
  fragmentUnresolvableIds,
  fragmentUnusableReasons,
  type LoweringFragment,
} from "../src/frontend/lowering/fragment.js";

function fragment(): LoweringFragment {
  return {
    version: FRAGMENT_VERSION,
    module: "/p/lib.ts",
    functions: [],
    globals: [],
    mints: [
      { localId: "r0", kind: "record", structure: 'record{"a":{"kind":"f64"}}', ordinal: 0, loop: "body" },
      { localId: "u0", kind: "union", structure: 'union[{"kind":"f64"},{"kind":"nullT"}]', ordinal: 1, loop: "body" },
    ],
    edges: [{ from: "%lib.f", to: "%lib.g" }],
    witness: {
      readEntities: [{ localId: "r9", kind: "record", structure: 'record{"b":{"kind":"string"}}' }],
      helpersReused: [{ internKey: "obj.keys:r9", sites: 2 }],
      reachableSubset: ["%lib.f"],
      moduleGraph: [{ specifier: "./dep", resolved: "/p/dep.ts" }],
      overflowGranted: ["k-granted"],
      overflowDenied: ["k-denied"],
      overflowUnanswered: ["k-neither"],
    },
    probes: [{ op: "file", path: "/p/lib.ts", digest: "d" }],
  };
}

const KEY_INPUT = { environmentFingerprint: "env-1", implementationFingerprint: "impl-1" };
const key = (f: LoweringFragment): string => fragmentKey({ ...KEY_INPUT, fragment: f });

describe("lowering fragment", () => {
  /* RULE 1. Collection mints 57.3% of the positional ids on the measured
   * program and they belong to NO module: collection runs on every build
   * whether or not anything was cached, so those ids are reproduced rather
   * than replayed. A fragment owning one would mint the entity twice and
   * renumber everything after it — in a program that still validates. */
  it("refuses a fragment that claims a collection-minted id, and accepts one that does not", () => {
    const collection = new Set(['record{"z":{"kind":"bool"}}', 'record{"a":{"kind":"f64"}}']);
    expect(() => assertFragmentOwnsNoCollectionIds(fragment(), collection))
      .toThrowError(/claims to have minted 1 positional id\(s\) that the COLLECTION phase mints/);

    // NEGATIVE CONTROLS. Without them an assertion that threw unconditionally
    // would satisfy the line above and pin nothing.
    expect(() => assertFragmentOwnsNoCollectionIds(fragment(), new Set(['record{"z":{"kind":"bool"}}']))).not.toThrow();
    expect(() => assertFragmentOwnsNoCollectionIds(fragment(), new Set())).not.toThrow();
  });

  /* RULE 2's real guard, and a CONTROL FOR ASSEMBLY, which does not exist.
   *
   * Stored bodies are the module's real IR, so they are full of ids. What
   * makes that safe is that every id is resolvable from the fragment's own
   * dictionary. An id in neither list gets rewritten to nothing, or left
   * pointing at whatever the new build calls r3541 — both silent, both
   * shipped. */
  it("reports body ids that no dictionary entry resolves, and none when every id is covered", () => {
    const sound = fragment();
    sound.functions = [
      { body: [{ kind: "recordGet", shapeId: "r0" }, { kind: "unionWrap", unionId: "u0" }] },
      { body: [{ kind: "recordGet", shapeId: "r9" }] }, // read from another module
    ] as unknown as LoweringFragment["functions"];
    expect(fragmentUnresolvableIds(sound)).toEqual([]);

    const dangling = fragment();
    dangling.functions = [
      { body: [{ kind: "recordGet", shapeId: "r0" }, { kind: "recordGet", shapeId: "r404" }] },
      { body: [{ kind: "unionWrap", unionId: "u77" }] },
    ] as unknown as LoweringFragment["functions"];
    expect(fragmentUnresolvableIds(dangling)).toEqual(["r404", "u77"]);

    // A user STRING that merely looks like an id must not be reported: the
    // scan matches the property name too, not a bare rN anywhere in the JSON.
    const literal = fragment();
    literal.functions = [
      { body: [{ kind: "strLit", value: "r404" }] },
    ] as unknown as LoweringFragment["functions"];
    expect(fragmentUnresolvableIds(literal)).toEqual([]);
  });

  /* THE KEY MUST SEE A FIELD ADDED ONE LEVEL BELOW A WITNESS FIELD.
   *
   * It used to hand-spell the composite entries (`h.internKey + ":" +
   * h.sites`), so a third field on HelperReuse would have been invisible to
   * the key while the verifier, which stringifies the whole array, still
   * caught it — the looser check gating reuse and the stricter one running
   * afterwards only for builds that opted in. */
  it("keys on a field added one level below a witness field", () => {
    const base = fragment();
    for (const mutate of [
      (f: LoweringFragment) => { (f.witness.helpersReused[0] as unknown as Record<string, unknown>)["addedLater"] = 7 },
      (f: LoweringFragment) => { (f.witness.moduleGraph[0] as unknown as Record<string, unknown>)["addedLater"] = "x" },
      (f: LoweringFragment) => { (f.witness.readEntities[0] as unknown as Record<string, unknown>)["addedLater"] = true },
    ]) {
      const m = fragment();
      mutate(m);
      expect(key(m), "a field one level below the witness escaped the key").not.toBe(key(base));
    }
  });

  it("keys on every witness field, enumerated from the object rather than listed", () => {
    const base = fragment();
    expect(key(fragment())).toBe(key(fragment())); // control: stable
    const unkeyed: string[] = [];
    for (const field of Object.keys(base.witness)) {
      const m = fragment();
      const w = m.witness as unknown as Record<string, unknown[]>;
      w[field] = [...(w[field] ?? []), "__extra__"];
      if (key(m) === key(base)) unkeyed.push(field);
    }
    expect(unkeyed, `witness fields outside the fragment key: ${unkeyed.join(", ")}`).toEqual([]);
  });

  /* The negative overflow answers specifically, because a cache recording
   * only what it FOUND is the documented way to get this wrong. Dropping a
   * denial changes the program — the shape would carry an overflow it must
   * not have — so it has to change the key. */
  it("keys on the NEGATIVE overflow-grant answers, not only the grants", () => {
    const base = fragment();
    for (const field of ["overflowDenied", "overflowUnanswered"] as const) {
      const m = fragment();
      m.witness[field] = [];
      expect(key(m), `${field} dropped without changing the key`).not.toBe(key(base));
    }
  });

  it("keys on the environment, the implementation, and the probes", () => {
    const f = fragment();
    const base = fragmentKey({ ...KEY_INPUT, fragment: f });
    expect(fragmentKey({ ...KEY_INPUT, environmentFingerprint: "env-2", fragment: f })).not.toBe(base);
    expect(fragmentKey({ ...KEY_INPUT, implementationFingerprint: "impl-2", fragment: f })).not.toBe(base);
    const probed = fragment();
    probed.probes = [{ op: "file", path: "/p/lib.ts", digest: "CHANGED" }];
    expect(key(probed)).not.toBe(base);
  });

  /* Insertion order must not be identity. Two builds that populated a
   * witness entry in a different order would otherwise hash differently and
   * miss forever — a cache that never hits is a slow bug, and it would look
   * like the fragment never matching rather than like a serializer defect. */
  it("canonicalises key order but preserves array order, which is content", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 } }));
    // An absent field and an explicitly-undefined one must hash alike, or a
    // producer that writes `{x: undefined}` misses against one that omits x.
    expect(canonicalJson({ a: 1, x: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  /* A CONTROL FOR THE PRODUCER, which does not exist: whatever it builds has
   * to survive the trip to disk. Maps, Sets and undefined do not, and each
   * would fail as a silently emptier fragment rather than as an error. */
  it("round-trips through JSON unchanged", () => {
    const f = fragment();
    const back = JSON.parse(JSON.stringify(f)) as LoweringFragment;
    expect(back).toEqual(f);
    expect(key(back)).toBe(key(f));
    expect(fragmentUnusableReasons(back)).toEqual([]);
  });

  /* RULE 2, checked on read rather than trusted. */
  it("reports a stored positional id and an ambiguous replay order, and nothing on a sound fragment", () => {
    expect(fragmentUnusableReasons(fragment())).toEqual([]);

    const literal = fragment();
    literal.mints[0]!.structure = "r3541";
    expect(fragmentUnusableReasons(literal).join(" ")).toMatch(/stores the positional id r3541/);

    const collide = fragment();
    collide.mints[1] = { ...collide.mints[1]!, ordinal: 0, loop: "body" };
    expect(fragmentUnusableReasons(collide).join(" ")).toMatch(/share ordinal body:0/);

    // The same ordinal in the OTHER loop is not a collision: the two file
    // loops do not overlap (last body mint 2226, first init 2227), so body:0
    // and init:0 are different slots.
    const otherLoop = fragment();
    otherLoop.mints[1] = { ...otherLoop.mints[1]!, ordinal: 0, loop: "init" };
    expect(fragmentUnusableReasons(otherLoop)).toEqual([]);

    const stale = fragment();
    stale.version = FRAGMENT_VERSION + 1;
    expect(fragmentUnusableReasons(stale).join(" ")).toMatch(/is not /);
  });
});
