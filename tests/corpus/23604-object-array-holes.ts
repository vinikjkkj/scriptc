// Object / array element holes: the slot is NULL; every consumer that tells a hole from an
// element (in, keys, forEach, map, filter, length, inspect) is exact.
class Foo {
  n: number;
  constructor(n: number) { this.n = n; }
}
const a: Foo[] = new Array(4);
a[1] = new Foo(1);
a[3] = new Foo(3);
console.log(a.length, 0 in a, 1 in a, 2 in a, 3 in a);
a.forEach((f, i) => console.log(i, f.n));
console.log(a.map((f) => f.n), a.filter((f) => f.n > 0).length, Object.keys(a));
console.log(a);
for (const k in a) console.log("key", k);
console.log(a.some((f) => f.n === 3), a.every((f) => f.n > 0));
const b: number[][] = new Array(3);
b[1] = [1, 2];
console.log(b, 0 in b, b.length);
const rec: { x: number }[] = [];
rec[2] = { x: 1 };
console.log(rec, rec.length, 1 in rec, JSON.stringify(rec));
b.length = 5;
console.log(b, Object.keys(b));
