// A member read through an interface-typed receiver inside a cast, parentheses or a non-null assertion -- `(a.add as F)(x)`, `(a.add)(x)`, `(a.add!)(x)` -- is a METHOD
// call in JavaScript (the parenthesized reference keeps its receiver). The receiver holds a compiled class instance, or a view of a dynamic object built by a
// checked cast; it was refused with SC1090 ("reading 'add' from a value of type 'Adder'"). An object literal typed as the same interface keeps the typed path.
class Queue {
  items: string[] = [];
  add(a: unknown, b?: unknown): number {
    this.items.push(b === undefined ? String(a) : String(a) + "+" + String(b));
    return this.items.length;
  }
  size(): number {
    return this.items.length;
  }
}
interface Adder {
  add(a: unknown, b?: unknown): number;
  size(): number;
}
const q = new Queue();
const a: Adder = q;
console.log((a.add as (a: unknown, b?: unknown) => unknown)("x", 1));
console.log((a.add)("y"));
console.log((a.add!)("z", 2));
console.log(a.size(), q.items.join("|"));
const lit: Adder = { add: (x: unknown) => String(x).length, size: () => 7 };
console.log((lit.add as (a: unknown) => unknown)("four"), (lit.size)());
const dyn: any = new Queue() as any;
const view = dyn as Adder;
console.log((view.add as (a: unknown, b?: unknown) => unknown)("v", 3), (view.add)("w"), view.size());
console.log(dyn.items.join("|"));
