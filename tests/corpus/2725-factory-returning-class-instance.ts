// A factory that returns a CLASS INSTANCE where the slot is typed by the
// interface the instance satisfies.
//
// `resolve(() => new MemStore())` against a `() => Store` parameter is how
// a library takes a backend: the caller supplies the implementation, the
// signature spells the contract. The checker admits it because the class
// implements the interface; the compiled world had no conversion, so the
// assignment compiled and INVOKING the slot threw.
//
// The constructor-witness path already projected a class into a record --
// bound methods, lifted fields -- for `new (...) => Interface` slots. This
// is the same conversion one call deeper, so the factory form reuses it
// rather than widening what counts as coercible everywhere (a class is not
// a record at any other site).
interface Store {
  load(): string;
  save(v: string): number;
  readonly label: string;
}

class MemStore implements Store {
  readonly label = "mem";
  private v = "empty";
  load(): string {
    return this.v;
  }
  save(v: string): number {
    this.v = v;
    return v.length;
  }
}

class LoudStore implements Store {
  readonly label = "loud";
  private v = "EMPTY";
  load(): string {
    return this.v.toUpperCase();
  }
  save(v: string): number {
    this.v = v.toUpperCase();
    return this.v.length;
  }
}

function resolve(make: () => Store, seed: string): Store {
  const s = make();
  s.save(seed);
  return s;
}

const a = resolve(() => new MemStore(), "hello");
console.log(a.label, a.load(), a.save("world"), a.load());

// A second implementation through the same slot: the projection is per
// class, and the two must not share one.
const b = resolve(() => new LoudStore(), "hello");
console.log(b.label, b.load(), b.save("world"), b.load());

// Two instances from the same factory stay independent.
const make = (): Store => new MemStore();
const c = resolve(make, "one");
const d = resolve(make, "two");
console.log(c.load(), d.load());

// The projected value held in a record slot and called back out.
const holder: { store: Store } = { store: resolve(make, "held") };
console.log(holder.store.label, holder.store.load());
