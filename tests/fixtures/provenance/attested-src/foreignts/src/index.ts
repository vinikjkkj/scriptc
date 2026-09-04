/* An attested source tree checked under ITS OWN tsconfig, which is not
 * the one scriptc forces.
 *
 * The divergence used here is `lib`, which scriptc FORCES to
 * `lib.es2025.d.ts` (FORCED_OPTIONS in program.ts) — not adopted, not
 * negotiable, the same for every program. A package whose own tsconfig
 * lists `"lib": ["es2022", "dom"]` and names a DOM type in a type
 * position therefore fails to check here, in files the consuming
 * program's author cannot edit, over a name that is erased before
 * anything runs.
 *
 * A TYPE-ONLY divergence is deliberate: `Attachment` below is erased, so
 * the emitted program is identical with and without the declaration and
 * the differential can hold the compiled SOURCE against the island-run
 * published DIST byte for byte. What is being pinned is that the
 * diagnostic does not gate the build.
 *
 * With the flag OFF this package is consumed through its shipped .d.ts
 * under skipLibCheck and scriptc never looks at these declarations at
 * all — so source mapping must not be the thing that newly fails a build
 * that works without it. */

/** The package author's own lib had `dom`; the consumer's does not. */
export type Attachment = HTMLElement;

class Rule {
  label(): string {
    return "rule";
  }
  weight(): number {
    return 1;
  }
}

class StrictRule extends Rule {
  override label(): string {
    return "strict";
  }
  override weight(): number {
    return 2;
  }
}

export function ruleReport(): string {
  const base = new Rule();
  const strict = new StrictRule();
  return `${base.label()}:${base.weight()} ${strict.label()}:${strict.weight()}`;
}

export function amplify(n: number): number {
  return n * new StrictRule().weight();
}
