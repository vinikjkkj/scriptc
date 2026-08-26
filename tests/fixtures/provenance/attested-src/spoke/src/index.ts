/* The attested SOURCE of spoke's root entry. The driver imports this by
 * name, so it is in spoke's entry table from the first walk. What it
 * imports — 'hub/util' — is a subpath of a package that was ALREADY
 * mapped, which is the exact shape the one-shot table dropped. */
import { shoutHub } from "hub/util";

export function spin(s: string): string {
  return "[" + shoutHub(s) + "]";
}
