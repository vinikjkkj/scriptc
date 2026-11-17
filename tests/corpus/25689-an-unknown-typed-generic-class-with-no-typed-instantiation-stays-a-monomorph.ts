// No instantiation of `Cell` other than the `<string, unknown>` one flows anywhere: it stays the plain monomorph, with its value-typed members, exactly as before.
class Cell<K, V> {
  readonly entries = new Map<K, V>();
  put(key: K, value: V): number { this.entries.set(key, value); return this.entries.size; }
  get(key: K): V | undefined { return this.entries.get(key); }
  touch(key: K): void { const v = this.entries.get(key); if (v !== undefined) { this.entries.delete(key); this.entries.set(key, v); } }
}
const loose: Cell<string, unknown> = new Cell<string, unknown>();
console.log(loose.put("a", 1), loose.put("b", "two"), loose.put("c", { n: 3 }));
loose.touch("a");
console.log([...loose.entries.keys()].join(","), loose.get("b"), typeof loose.get("c"), loose.get("zz"));
const numbers = new Cell<string, number>();
numbers.put("n", 5);
console.log(numbers.get("n")! + 1, numbers.entries.size);
