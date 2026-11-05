abstract class Shape {
  abstract points(): Generator<number>;
  *twice(): Generator<number> { for (const p of this.points()) { yield p; yield p; } }
  total(): number { let s = 0; for (const p of this.twice()) s += p; return s; }
}
class Line extends Shape {
  private n: number; constructor(n: number) { super(); this.n = n; }
  *points(): Generator<number> { for (let i = 1; i <= this.n; i++) yield i; }
}
class Sq extends Line {
  *points(): Generator<number> { yield 100; for (const p of super.points()) yield p * p; }
}
const shapes: Shape[] = [new Line(3), new Sq(2)];
for (const s of shapes) { const a: number[] = []; for (const p of s.twice()) a.push(p); console.log(a.join(","), s.total()); }
class Gen<T> {
  *items(x: T): Generator<T> { yield x; yield x; }
  async *aitems(x: T): AsyncGenerator<T> { await null; yield x; }
}
class Box<T> {
  private xs: T[]; constructor(xs: T[]) { this.xs = xs; }
  *items(): Generator<T> { for (const x of this.xs) yield x; }
  async *aitems(): AsyncGenerator<T> { for (const x of this.xs) { await null; yield x; } }
}
const bn = new Box<number>([1, 2]); const bs = new Box<string>(["a", "b", "c"]); const ba = new Gen<boolean>();
for (const x of bn.items()) console.log(x);
for (const x of bs.items()) console.log(x);
for (const x of ba.items(true)) console.log(x);
(async () => { for await (const x of ba.aitems(false)) console.log("a", x); for await (const x of bs.aitems()) console.log("a", x); })();
class Counter {
  n = 0;
  *count(limit: number, step = 1): Generator<number, void, undefined> { while (this.n < limit) { this.n += step; yield this.n; } }
}
const c = new Counter(); for (const v of c.count(5, 2)) console.log("c", v); console.log(c.n);
const g = c.count(100); g.next(); const r = g.return(); console.log(r.done, c.n);
