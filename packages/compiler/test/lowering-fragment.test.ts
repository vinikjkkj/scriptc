/* THE PER-MODULE LOWERING FRAGMENT's three rules, each pinned by a test that
 * can fail.
 *
 * The rules are in fragment.ts and they are not stylistic. Each one, broken,
 * produces a build that SUCCEEDS and emits a valid program that is not the
 * program the source describes -- which is why they are assertions in the
 * compiler rather than notes in a design document, and why the tests below
 * carry negative controls: a check that has only ever agreed cannot report a
 * disagreement.
 */
import { describe, expect, it } from "vitest";
import {
  FRAGMENT_VERSION,
  assertFragmentOwnsNoCollectionIds,
  fragmentKey,
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
      { kind: "record", structure: '[["a","f64"]]', ordinal: 0, loop: "body" },
      { kind: "union", structure: '["f64","null"]', ordinal: 1, loop: "body" },
    ],
    edges: [{ from: "%lib.f", to: "%lib.g" }],
    witness: {
      shapesRead: ['[["b","string"]]'],
      helpersReused: [{ internKey: 'obj.keys:[["b","string"]]', sites: 2 }],
      reachableSubset: ["%lib.f"],
      moduleGraph: [{ specifier: "./dep", resolved: "/p/dep.ts" }],
      overflowGranted: ["k-granted"],
      overflowDenied: ["k-denied"],
      overflowUnanswered: ["k-neither"],
    },
    probes: [{ op: "file", path: "/p/lib.ts", digest: "d" }],
  };
}

const KEY_INPUT = {
  environmentFingerprint: "env-1",
  implementationFingerprint: "impl-1",
};

describe("lowering fragment", () => {
  /* RULE 1. Collection mints 57.3% of the positional ids on the measured
   * program and they belong to NO module: collection runs on every build
   * whether or not anything was cached, so those ids are reproduced rather
   * than replayed. A fragment owning one would mint the entity twice and
   * renumber everything after it -- in a program that still validates. */
  it("refuses a fragment that claims a collection-minted id, and accepts one that does not", () => {
    const collection = new Set(['[["z","bool"]]', '[["a","f64"]]']);

    expect(() => assertFragmentOwnsNoCollectionIds(fragment(), collection)).toThrowError(
      /claims to have minted 1 positional id\(s\) that the COLLECTION phase mints/,
    );

    // NEGATIVE CONTROL. Without it, an assertion that threw unconditionally
    // would satisfy the line above and pin nothing.
    const disjoint = new Set(['[["z","bool"]]']);
    expect(() => assertFragmentOwnsNoCollectionIds(fragment(), disjoint)).not.toThrow();

    // ...and the empty case, which is what every build looks like before
    // anyone adds a module: it must not throw either.
    expect(() => assertFragmentOwnsNoCollectionIds(fragment(), new Set())).not.toThrow();
  });

  /* RULE 2, and the key's own version of the metadata mutant test.
   *
   * A witness field that is not in the key is the same defect as a metadata
   * field nothing compares: the fragment is reused in a build whose answer
   * to that question has changed. Enumerated from the object so a witness
   * field added tomorrow gets a mutant for free. */
  it("keys on every witness field, enumerated from the object rather than listed", () => {
    const base = fragment();
    const key = (f: LoweringFragment): string => fragmentKey({ ...KEY_INPUT, fragment: f });

    // Control: the same fragment must key the same, or every mutant below
    // "passes" for the wrong reason.
    expect(key(fragment())).toBe(key(fragment()));

    const fields = Object.keys(base.witness);
    expect(fields.length).toBeGreaterThan(0);
    const unkeyed: string[] = [];
    for (const field of fields) {
      const mutant = fragment();
      // Appending is a subtler mutant than replacing: it keeps the field's
      // type and its existing entries, which is what a real drift looks
      // like. A type change would be caught by a coarser key.
      (mutant.witness as unknown as Record<string, unknown[]>)[field] = [
        ...((base.witness as unknown as Record<string, unknown[]>)[field] ?? []),
        "__extra__",
      ];
      if (key(mutant) === key(base)) unkeyed.push(field);
    }
    expect(unkeyed, `witness fields outside the fragment key: ${unkeyed.join(", ")}`).toEqual([]);
  });

  /* The negative overflow answers, specifically, because a cache that
   * records only what it FOUND is the documented way to get this wrong.
   * Dropping the denial changes the program -- the shape would carry an
   * overflow it must not have -- so it has to change the key. */
  it("keys on the NEGATIVE overflow-grant answers, not only the grants", () => {
    const base = fragment();
    const key = (f: LoweringFragment): string => fragmentKey({ ...KEY_INPUT, fragment: f });
    for (const field of ["overflowDenied", "overflowUnanswered"] as const) {
      const mutant = fragment();
      mutant.witness[field] = [];
      expect(key(mutant), `${field} dropped without changing the key`).not.toBe(key(base));
    }
  });

  it("keys on the environment and on the compiler implementation", () => {
    const f = fragment();
    const base = fragmentKey({ ...KEY_INPUT, fragment: f });
    expect(fragmentKey({ ...KEY_INPUT, environmentFingerprint: "env-2", fragment: f })).not.toBe(base);
    expect(fragmentKey({ ...KEY_INPUT, implementationFingerprint: "impl-2", fragment: f })).not.toBe(base);
  });

  it("keys on the probes, so a file the frontend read cannot change unnoticed", () => {
    const base = fragment();
    const mutant = fragment();
    mutant.probes = [{ op: "file", path: "/p/lib.ts", digest: "CHANGED" }];
    expect(fragmentKey({ ...KEY_INPUT, fragment: mutant })).not.toBe(
      fragmentKey({ ...KEY_INPUT, fragment: base }),
    );
  });

  /* RULE 2, checked on read rather than trusted. r3541 names a shape only
   * inside the build that minted it. */
  it("reports a stored positional id and an ambiguous replay order, and nothing on a sound fragment", () => {
    expect(fragmentUnusableReasons(fragment())).toEqual([]);

    const literal = fragment();
    literal.mints[0]!.structure = "r3541";
    expect(fragmentUnusableReasons(literal).join(" ")).toMatch(/stores the positional id r3541/);

    const collide = fragment();
    collide.mints[1] = { ...collide.mints[1]!, ordinal: 0, loop: "body" };
    expect(fragmentUnusableReasons(collide).join(" ")).toMatch(/share ordinal body:0/);

    // The same ordinal in the OTHER loop is not a collision: the two file
    // loops do not overlap, so body:0 and init:0 are different slots.
    const otherLoop = fragment();
    otherLoop.mints[1] = { ...otherLoop.mints[1]!, ordinal: 0, loop: "init" };
    expect(fragmentUnusableReasons(otherLoop)).toEqual([]);

    const stale = fragment();
    stale.version = FRAGMENT_VERSION + 1;
    expect(fragmentUnusableReasons(stale).join(" ")).toMatch(/is not /);
  });
});
