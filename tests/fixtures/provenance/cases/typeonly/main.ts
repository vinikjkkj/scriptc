/* A package reached ONLY through `import type`. Nothing here imports a
 * value from 'dualdist', so the bare-import prescan is the only thing
 * that decides whether provenance engages at all. */
import type { Stamp } from "dualdist";

export function stampOf(at: string): Stamp {
  return { at };
}

console.log(stampOf("noon").at);
