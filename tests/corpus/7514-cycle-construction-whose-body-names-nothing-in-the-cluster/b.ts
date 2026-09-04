// The cycle-closing edge: aLookup is called only from inside a function
// body, so the call happens after both modules finished initializing.
// (Importing a.ts's `Folded` and reading it HERE, at b's top level,
// would be a genuine TDZ read and the fence still refuses it -- rule 2
// is untouched by any of this. So b declares its own.)
import { aLookup } from "./a.ts";

console.log("b: body");

const B_TABLE: Record<string, { fallback?: number }> = {
  scale: { fallback: 5 },
  tint: {},
};

class Folded2 {
  readonly items: Array<[string, number]>;
  constructor(entries: Array<[string, number]> = []) {
    this.items = entries.map(([k, v]) => [k.toLowerCase(), v] as [string, number]);
  }
  size(): number {
    return this.items.length;
  }
  get(k: string): number {
    for (const pair of this.items) {
      if (pair[0] === k) return pair[1];
    }
    return -1;
  }
}

export const B_DEFAULTS = new Folded2(
  Object.entries(B_TABLE)
    .filter(([, d]) => d.fallback !== undefined)
    .map(([k, d]) => [k, d.fallback ?? 0] as [string, number]),
);

export function bLookup(k: string): string {
  return "b:" + String(B_DEFAULTS.get(k)) + "/a:" + String(aLookup("width"));
}
