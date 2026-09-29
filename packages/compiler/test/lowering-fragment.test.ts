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
  FRAGMENT_REFUSAL_CODES,
  censusRecord,
  censusReport,
  fragmentFormCollisions,
  newFragmentCensus,
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
const msgs = (rs: { message: string }[]): string => rs.map((r) => r.message).join(" ");
const codes = (rs: { code: string }[]): string[] => rs.map((r) => r.code);

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

  /* THE MIRROR GUARD. assertNoIdLeak proves no id got INTO a form; this
   * proves no two distinct entities came OUT of one. A collision maps two
   * entities onto ONE id at assembly, putting a value of one shape into
   * another shape's slot with no diagnostic and no build failure.
   *
   * The forced pair below is the REAL case, not an invented one: the
   * registry keeps per-declaration identity, so "two INDEPENDENT
   * structurally identical recursive declarations intern as distinct
   * shapes". structuralForm cannot tell them apart, because what separates
   * them is the declaration site rather than the structure. */
  it("refuses a fragment where two distinct entities share one structural form", () => {
    // NEGATIVE CONTROL FIRST: a sound fragment has no collisions, or every
    // assertion below passes for the wrong reason.
    expect(fragmentFormCollisions(fragment())).toEqual([]);
    expect(fragmentUnusableReasons(fragment())).toEqual([]);

    const collided = fragment();
    collided.mints.push({
      localId: "r1",
      kind: "record",
      structure: collided.mints[0]!.structure, // the two-recursive-declarations case
      ordinal: 2,
      loop: "body",
    });
    const found = fragmentFormCollisions(collided);
    expect(found).toHaveLength(1);
    expect(found[0]!.localIds.sort()).toEqual(["r0", "r1"]);
    expect(found[0]!.opaque).toBe(false);
    expect(msgs(fragmentUnusableReasons(collided)))
      .toMatch(/a structural form is shared by 2 distinct entities/);

    // A collision ACROSS the two dictionaries -- one minted here, one read
    // from elsewhere -- is the same fatal shape and must be caught too.
    const across = fragment();
    across.witness.readEntities.push({
      localId: "r8",
      kind: "record",
      structure: across.mints[0]!.structure,
    });
    expect(fragmentFormCollisions(across)).toHaveLength(1);

    // An OPAQUE form colliding is the likeliest way this fires, and it is
    // reported as opaque so the reason is legible rather than inferred.
    const opaque = fragment();
    opaque.mints[0]!.structure = 'record{"x":"%unresolved"}';
    opaque.mints[1]!.structure = 'record{"x":"%unresolved"}';
    const op = fragmentFormCollisions(opaque);
    expect(op).toHaveLength(1);
    expect(op[0]!.opaque).toBe(true);
    expect(msgs(fragmentUnusableReasons(opaque)))
      .toMatch(/an OPAQUE structural form is shared by 2 distinct entities/);
  });

  /* THE CENSUS. C = 250.3 s assumes the library modules are cacheable; every
   * module that hits a refusal is not. A refusal nobody counts is
   * indistinguishable from a refusal that never happens, which is how a cache
   * reports working while delivering a fraction of what it was costed at. */
  it("counts every refusal by code, with every code present even at zero", () => {
    const c = newFragmentCensus();

    // A zero must be a MEASURED zero, not an absent key. That distinction is
    // what this block already retracted a finding over.
    for (const code of FRAGMENT_REFUSAL_CODES) {
      expect(c.refusedByCode[code], `code ${code} missing from a fresh census`).toBe(0);
    }
    expect(Object.keys(c.refusedByCode).sort()).toEqual([...FRAGMENT_REFUSAL_CODES].sort());

    censusRecord(c, "/p/ok.ts", []);
    censusRecord(c, "/p/collide.ts", [{ code: "form-collision", message: "x" }], [{ opaque: true }]);
    censusRecord(c, "/p/stale.ts", [{ code: "version", message: "y" }]);
    // One module, TWO reasons: it must count under each, so the per-code
    // numbers sum to at least the refused total rather than partitioning it.
    censusRecord(c, "/p/both.ts", [
      { code: "positional-id", message: "a" },
      { code: "ordinal-collision", message: "b" },
    ]);

    expect(c.attempted).toBe(4);
    expect(c.cacheable).toBe(1);
    expect(c.refusedByCode["form-collision"]).toBe(1);
    expect(c.refusedByCode.version).toBe(1);
    expect(c.refusedByCode["positional-id"]).toBe(1);
    expect(c.refusedByCode["ordinal-collision"]).toBe(1);
    expect(c.opaqueCollisions).toBe(1);
    expect(c.refusedModules).toEqual(["/p/collide.ts", "/p/stale.ts", "/p/both.ts"]);

    const report = censusReport(c);
    expect(report).toContain("modules attempted   4");
    expect(report).toContain("cacheable           1  25.0%");
    // Every code appears in the report even at zero, or a reader cannot tell
    // "never happened" from "not in this build's vocabulary".
    for (const code of FRAGMENT_REFUSAL_CODES) expect(report).toContain(code);

    // CONTROL: an all-cacheable census must not report refusals, or the
    // assertions above pass for a counter that always increments.
    const clean = newFragmentCensus();
    censusRecord(clean, "/p/a.ts", []);
    censusRecord(clean, "/p/b.ts", []);
    expect(clean.cacheable).toBe(2);
    expect(clean.refusedModules).toEqual([]);
    expect(censusReport(clean)).toContain("refused             0  0.0%");
    // ...and an EMPTY census must say n/a rather than dividing by zero.
    expect(censusReport(newFragmentCensus())).toContain("n/a");
  });

  it("gives every refusal a code drawn from the closed set", () => {
    const stale = fragment();
    stale.version = FRAGMENT_VERSION + 1;
    const collided = fragment();
    collided.mints.push({ ...collided.mints[0]!, localId: "r1", ordinal: 2 });
    for (const f of [stale, collided]) {
      for (const code of codes(fragmentUnusableReasons(f))) {
        expect([...FRAGMENT_REFUSAL_CODES], `unclassified refusal code ${code}`).toContain(code);
      }
    }
    expect(codes(fragmentUnusableReasons(stale))).toContain("version");
    expect(codes(fragmentUnusableReasons(collided))).toContain("form-collision");
  });

  /* RULE 2, checked on read rather than trusted. */
  it("reports a stored positional id and an ambiguous replay order, and nothing on a sound fragment", () => {
    expect(fragmentUnusableReasons(fragment())).toEqual([]);

    const literal = fragment();
    literal.mints[0]!.structure = "r3541";
    expect(msgs(fragmentUnusableReasons(literal))).toMatch(/stores the positional id r3541/);

    const collide = fragment();
    collide.mints[1] = { ...collide.mints[1]!, ordinal: 0, loop: "body" };
    expect(msgs(fragmentUnusableReasons(collide))).toMatch(/share ordinal body:0/);

    // The same ordinal in the OTHER loop is not a collision: the two file
    // loops do not overlap (last body mint 2226, first init 2227), so body:0
    // and init:0 are different slots.
    const otherLoop = fragment();
    otherLoop.mints[1] = { ...otherLoop.mints[1]!, ordinal: 0, loop: "init" };
    expect(fragmentUnusableReasons(otherLoop)).toEqual([]);

    const stale = fragment();
    stale.version = FRAGMENT_VERSION + 1;
    expect(msgs(fragmentUnusableReasons(stale))).toMatch(/is not /);
  });
});
