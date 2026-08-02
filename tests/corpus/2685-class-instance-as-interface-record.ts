// A freshly CONSTRUCTED class instance flowing into the interface record it
// satisfies. The shape is a ternary picking between an implementation and a
// constant: two representations -- a nominal object and a record -- for one
// common type, so the instance becomes a witness record of closures bound to
// its methods.
//
// FRESHNESS is the soundness gate. Records carry reference identity here
// exactly as in Node, so witnessing an instance that ALSO travels in its own
// nominal form would hand `===` two different values for one object. Built at
// the coercion, the witness is the value's only shape from birth. An instance
// that already exists under its own name keeps the fence, which is why the
// cases below all construct in place.
interface Store {
  clear(): Promise<void>;
  get(k: string): Promise<number | null>;
  hits(): number;
}

class MemStore implements Store {
  private n = 0;
  public async clear(): Promise<void> {
    this.n = 0;
  }
  public async get(k: string): Promise<number | null> {
    this.n += 1;
    return k.length + this.n;
  }
  public hits(): number {
    return this.n;
  }
}

const NOOP: Store = {
  clear: async () => {},
  get: async () => null,
  hits: () => -1,
};

function pick(kind: string): Store {
  if (kind === "mem") return new MemStore();
  return NOOP;
}

async function main(): Promise<void> {
  const a = pick("mem");
  const b = pick("none");
  console.log(await a.get("ab"), await b.get("ab"));

  // State is SHARED: the closures call the method on the captured instance,
  // so mutation through the witness is visible to the next call.
  console.log(await a.get("ab"), a.hits());
  await a.clear();
  console.log(a.hits(), await a.get("ab"));

  // A second witness of a DIFFERENT instance keeps its own state.
  const d = pick("mem");
  console.log(await d.get("xyz"), d.hits(), a.hits());

  // The witness is the value's only form, so identity behaves.
  const same = a;
  console.log(same === a, a === b);
}

void main();
