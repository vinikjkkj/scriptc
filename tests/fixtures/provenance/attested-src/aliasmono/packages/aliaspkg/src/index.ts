/* The attested SOURCE of aliaspkg's only entry. It reaches the repo's
 * shared code through a tsconfig path alias, which is what a monorepo
 * package's source normally does — nothing in the specifier says
 * "internal", so the alias table is the only thing that can answer it. */
import { shoutCore } from "@core";

export function spin(s: string): string {
  return "[" + shoutCore(s) + "]";
}
