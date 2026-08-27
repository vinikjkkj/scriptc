/* THE DECOY, and the reason this whole fixture exists in this shape.
 *
 * aliasmono keeps its own in-tree copy of a package that is ALSO published
 * and separately attested from another repo — which is exactly what zapo
 * does: `"@zapo-js/*": ["packages/*/src"]` in its tsconfig names its
 * monorepo copies of @zapo-js/store-sqlite and friends, while those
 * packages are attested from their own checkouts at other commits.
 *
 * So the specifier `aliaspkg2` has two answers: this file, via aliasmono's
 * alias table, and aliasmono2's source, via aliaspkg2's own provenance
 * ENTRY. The entry is the right one. Picking this one is not a refusal —
 * `twirl` has the same name and signature — it is a different string out
 * of a binary that exits 0.
 *
 * A previous block found the baseUrl defect, fixed it, and REVERTED the
 * fix because it feared exactly this. The fear was right and the fix is
 * still correct: `provenancePaths()` writes the package ENTRY table after
 * the alias table, and `resolveSpecifier` consults `provenanceEntryFor`
 * before `provenanceAliasTargets`. Both orderings are deliberate and
 * neither was added here. This test is what makes them load-bearing
 * instead of incidental. */
export function twirl(s: string): string {
  return "<DECOY:" + s + ">";
}
