/* The alias TARGET, and it lives at the attested repo's ROOT, not inside
 * the package that imports it. `packages/tsconfig.paths.json` spells
 * `"baseUrl": ".."` to mean exactly this directory; a reader that resolves
 * that ".." against the PACKAGE directory instead lands one level short,
 * on `packages/src/core`, which does not exist. */
export const CORE = "core-1.0.0";

export function shoutCore(s: string): string {
  return CORE + ":" + s.toUpperCase();
}
