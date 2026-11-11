// Shape unification grows a view's target shape after the view helper was built: the interface `Plain` is merged into `Plain & { destroy?: ... }`,
// and a class that HAS the gained method gets it bound into the view then, a closure nothing else bound yet. It must be declared with the rest.
// (The same file keeps two interfaces sharing one bound closure, one of them provably unobservable.)
export {};
interface Plain { load(): Promise<number>; clear(): Promise<void>; hits: number }
type PlainD = Plain & { destroy?: () => Promise<void> };
class Solo {
  hits = 3;
  public async load(): Promise<number> { this.hits++; return this.hits; }
  public async clear(): Promise<void> { this.hits = 0; }
  public async destroy(): Promise<void> { console.log("solo destroy", this.hits); }
}
function lockPlain(p: Plain): PlainD {
  const d = p as { destroy?: () => Promise<void> };
  return { load: () => p.load(), clear: () => p.clear(), hits: p.hits, destroy: async () => { console.log("locked destroy", d === undefined); } };
}
function pick<T>(make: () => T): T { return make(); }
const locked = lockPlain(pick<Plain>(() => new Solo()));
console.log(await locked.load(), locked.hits);
await locked.destroy?.();
const asPlain: Plain = locked;
console.log(await asPlain.load(), asPlain.hits);
await locked.clear();
console.log(await locked.load());

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
