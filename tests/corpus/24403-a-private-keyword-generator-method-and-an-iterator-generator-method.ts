class Bag { private xs = [1,2,3]; *[Symbol.iterator](): Generator<number> { for (const x of this.xs) yield x; } }
const b = new Bag();
for (const x of b) console.log(x);
console.log([...b]);
class P { private *pv(): Generator<number> { yield 1; yield 2; } sum(): number { let s = 0; for (const v of this.pv()) s += v; return s; } }
console.log(new P().sum());
