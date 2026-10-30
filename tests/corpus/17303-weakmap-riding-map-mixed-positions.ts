class A {
  x = 1;
}
type R = { a: number };

const a1 = new A();
const a2 = new A();
const r1: R = { a: 1 };
const w1 = new WeakMap<A, number>();
w1.set(a1, 1);
const w4 = new WeakMap<A, A>();
w4.set(a1, a2);
const w5 = new WeakMap<R, number>();
w5.set(r1, 9);
console.log(w1);
console.log(w4);
console.log(w5.get(r1), w5.has(r1), w5.delete(r1), w5.has(r1));
let maybe: WeakMap<A, number> | undefined = w1;
console.log(maybe);
console.log([w1, w5], { k: w4 });
class H {
  m = new WeakMap<A, number>();
}
const h = new H();
h.m.set(a1, 4);
console.log(h.m, h.m.get(a1));
const plain = new Map<A, number>();
plain.set(a1, 2);
console.log(plain, String(plain), plain.size);
