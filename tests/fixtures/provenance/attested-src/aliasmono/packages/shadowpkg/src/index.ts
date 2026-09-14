/* Spells a subpath of an INSTALLED package that its own repo's tsconfig
 * also claims. Node resolves it to the installed package; the alias table
 * claims it for the in-repo copy. The compiler has to agree with Node. */
import { extra } from "aliaspkg2/extra";

export function host(s: string): string {
  return "[" + extra(s) + "]";
}
