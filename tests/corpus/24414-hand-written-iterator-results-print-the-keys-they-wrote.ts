// Hand-written IteratorResult literals print the keys they wrote; a generator's own results always have both.
function mk(kind: number): IteratorResult<number, undefined> {
  if (kind === 0) return { value: undefined, done: true };
  if (kind === 1) return { value: 7, done: false };
  return { done: true } as IteratorResult<number, undefined>;
}
for (const k of [0, 1, 2]) console.log(mk(k));
class Counter {
  n = 0;
  next(): IteratorResult<number, undefined> {
    this.n++;
    return this.n < 3 ? { value: this.n, done: false } : { value: undefined, done: true };
  }
}
const c = new Counter();
console.log(c.next(), c.next(), c.next());
function* g(): Generator<number, void, undefined> { yield 1; }
const it = g();
console.log(it.next(), it.next());
console.log(Object.keys(it.next()), Object.keys(mk(2)));
