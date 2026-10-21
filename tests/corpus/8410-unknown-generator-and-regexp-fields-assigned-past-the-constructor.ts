function* gen() { yield 1; yield 2; }
class A {
  data!: unknown;
  g!: Generator<number>;
  d!: Date;
  r!: RegExp;
  f!: () => number;
  arr!: number[];
  set() { this.data = 5; this.g = gen(); this.d = new Date(0); this.r = /a/; this.f = () => 1; this.arr = [1]; }
}
const a = new A();
console.log(a.data === undefined, typeof a.data, a.data);
for (const probe of [() => a.g.next(), () => a.d.getTime(), () => a.r.test("a"), () => a.f(), () => a.arr.length]) {
  try { console.log(probe()); } catch (e) { console.log((e as Error).message); }
}
console.log(a.g === undefined, a.d === undefined);
a.set();
console.log(a.data, a.g.next().value, a.g.next().value, a.g.next().done, a.d.getTime(), a.r.test("a"), a.f(), a.arr.length);
console.log(a.g !== undefined, typeof a.data);
