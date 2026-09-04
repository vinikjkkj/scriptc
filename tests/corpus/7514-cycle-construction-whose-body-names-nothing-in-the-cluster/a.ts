import { B_DEFAULTS, bLookup } from "./b.ts";

console.log("a: body");

interface Descriptor {
  kind: string;
  fallback?: number;
}

const A_TABLE: Record<string, Descriptor> = {
  width: { kind: "int", fallback: 3 },
  label: { kind: "string" },
  depth: { kind: "int", fallback: 11 },
};

// Declared INSIDE the cluster, so no module-level escape applies: its
// constructor body is read, and it names nothing but its own parameter.
// Three bounded routes at once -- a lib method (`map`) on a lib-typed
// receiver (a parameter), a callback literal that lib method invokes,
// and destructuring that runs a tuple iterator.
export class Folded {
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

// The fourth route: `super(...)` landing on a LIB base from inside a
// cluster module.
export class Tagged extends Error {
  readonly code: number;
  constructor(prefix: string, name: string, code: number) {
    super(prefix + "/" + name);
    this.code = code;
  }
  describe(): string {
    return this.message + "#" + String(this.code);
  }
}

export const A_DEFAULTS = new Folded(
  Object.entries(A_TABLE)
    .filter(([, d]) => d.fallback !== undefined)
    .map(([k, d]) => [k.toUpperCase(), d.fallback ?? 0] as [string, number]),
);

export const A_TAG = new Tagged("a", "boot", 2);

export function aLookup(k: string): number {
  return A_DEFAULTS.get(k);
}

export function run(): void {
  console.log("A_DEFAULTS.size:", A_DEFAULTS.size());
  console.log("aLookup width:", aLookup("width"));
  console.log("aLookup depth:", aLookup("depth"));
  console.log("aLookup label:", aLookup("label"));
  console.log("A_TAG:", A_TAG.describe());
  console.log("B_DEFAULTS.size:", B_DEFAULTS.size());
  console.log("bLookup:", bLookup("scale"));
}
