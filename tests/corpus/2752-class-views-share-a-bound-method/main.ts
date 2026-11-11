// Two interfaces over one class share the bound closure of a method. The view through the first is provably unobservable (its only use is a call
// that neither keeps nor writes the record), so that view helper is dropped; the closure it created first must stay for the second view.
export {};
interface Reader { n: number; get(): number }
interface Writer { n: number; get(): number; twice(): number }
class K {
  n = 1;
  get(): number { return this.n; }
  twice(): number { return this.n * 2; }
}
function peek(r: Reader): number { return r.get() + r.n; }
function poke(w: Writer): number { w.n += 5; return w.get() + w.twice(); }
const k = new K();
console.log(peek(k));
console.log(poke(k), k.n);
console.log(peek(k), k.get());
const j = new K();
const w: Writer = j;
w.n = 10;
console.log(j.n, w.twice(), peek(j));
