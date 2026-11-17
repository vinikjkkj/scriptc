// Private and #private methods, a method returning `this` and one returning `Idx<K, V>` stay out of the erased view's slots (the instantiations still run
// them), and the view works in nullable and optional slots, with an optional chain.
class Idx<K, V> {
  readonly m = new Map<K, V>();
  n = 0;
  touch(key: K): void { this.n++; void key; }
  private helper(key: K): number { return this.n + String(key).length; }
  #secret(key: K): number { return this.helper(key) + 1; }
  self(): this { return this; }
  twin(): Idx<K, V> { return this; }
  probe(key: K): number { return this.#secret(key); }
}
const a = new Idx<string, number>();
const b = new Idx<string, string>();
class Holder {
  slot: Idx<string, unknown> | null = null;
  opt?: Idx<string, unknown>;
  set(first: boolean): void { this.slot = first ? a : b; this.opt = first ? b : undefined; }
}
const h = new Holder();
h.set(true);
h.slot!.touch("x");
h.slot?.touch("y");
h.opt?.touch("z");
h.slot!.probe("w");
console.log(a.n, b.n, a.probe("p"), a.self() === a, a.twin() === a);
