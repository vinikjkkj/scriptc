// `instanceof` against the family and against subclasses, on values typed at the erased view.
class Pool<K, V> {
  readonly items = new Map<K, V>();
  hit(key: K): string { return "pool:" + String(key); }
}
class Leased extends Pool<string, number> { hit(key: string): string { return "leased:" + key; } }
class Other {}
const a = new Pool<string, number>();
const b = new Pool<string, string[]>();
const c = new Leased();
const d = new Pool<number, number>();
function view(i: number): Pool<string, unknown> { return i === 0 ? a : i === 1 ? b : c; }
for (let i = 0; i < 3; i++) {
  const v = view(i);
  console.log(i, v.hit("k"), v instanceof Pool, v instanceof Leased, v instanceof Other);
}
console.log(a instanceof Pool, c instanceof Pool, d instanceof Pool, d instanceof Leased, view(1) === (b as Pool<string, unknown>));
