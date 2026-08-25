/* The attested SOURCE of dualdist's root entry. Its published twin is
 * dist/index.js (require) / dist/esm/index.js (import) — the two-flavor
 * layout zapo-js publishes, which is the whole point of this fixture. */
export interface Stamp {
  readonly at: string;
}

export const VERSION = "dualdist-2.0.0";
