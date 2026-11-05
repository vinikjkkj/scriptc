// A generic class whose base names its own type parameter, referenced with `any`: the instance is built with the argument bound to the
// checked-dynamic type, so it can sit in a Set, be constructed, read and written.
class Emitter<E> {
  handlers: E | undefined = undefined;
  fired = 0;
}
class Cursor<T = any, E = {}> extends Emitter<E> {
  items: T[] = [];
  label: string;
  constructor(label: string) { super(); this.label = label; }
  add(x: T): number { this.items.push(x); this.fired++; return this.items.length; }
}
interface Priv { cursors: Set<Cursor<any, {}>>; name: string }
const p: Priv = { cursors: new Set(), name: "p" };
const a = new Cursor<any, {}>("a");
const b = new Cursor<any, {}>("b");
console.log(a.add(1), a.add("two"), b.add({ k: 3 }), a.fired);
p.cursors.add(a);
p.cursors.add(b);
p.cursors.add(a);
console.log(p.cursors.size, p.cursors.has(a), p.cursors.has(new Cursor<any, {}>("c")));
let total = 0;
for (const c of p.cursors) total += c.items.length;
console.log(total, JSON.stringify(a.items), JSON.stringify(b.items));
p.cursors.delete(a);
console.log(p.cursors.size, [...p.cursors].map((c) => c.label).join(","));
