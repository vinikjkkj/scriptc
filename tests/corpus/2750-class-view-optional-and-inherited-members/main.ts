// The store pattern: classes behind an interface, cast to a record with an OPTIONAL method (`store as { destroy?: () => Promise<void> }`), the
// record unified with the interface, an inherited method, a member the class lacks, and writes through the record. Every member must map.
export {};
interface Store { load(): Promise<number>; save(n: number): Promise<void>; clear(): Promise<void>; hits: number; destroy?(): Promise<void> }
type WithDestroy<T> = T & { destroy?: () => Promise<void> };
class Base {
  protected log: string[] = [];
  public async destroy(): Promise<void> { this.log.push("destroy"); console.log("base destroy", this.log.join(",")); }
}
class RedisStore extends Base implements Store {
  hits = 0;
  private v = 1;
  public async load(): Promise<number> { this.hits++; return this.v; }
  public async save(n: number): Promise<void> { this.v = n; }
  public async clear(): Promise<void> { this.v = 0; }
}
class MemStore implements Store {
  hits = 100;
  private v = 7;
  public async load(): Promise<number> { this.hits++; return this.v; }
  public async save(n: number): Promise<void> { this.v = n; }
  public async clear(): Promise<void> { this.v = 0; }
}
function wrap(store: Store): WithDestroy<Store> {
  const d = store as { destroy?: () => Promise<void> };
  return {
    load: () => store.load(),
    save: (n) => store.save(n),
    clear: () => store.clear(),
    hits: store.hits,
    destroy: async () => { console.log("wrapped destroy", d === undefined); await store.destroy?.(); },
  };
}
function resolve<T>(fallback: () => T, make: () => T, useMake: boolean): T { return useMake ? make() : fallback(); }
async function run(label: string, s: Store): Promise<void> {
  const w = wrap(s);
  console.log(label, await w.load(), s.hits);
  s.hits = 40;
  await w.save(9);
  console.log(label, await w.load(), s.hits);
  await w.destroy?.();
  await w.clear();
  console.log(label, await w.load());
}
await run("redis", resolve<Store>(() => new MemStore(), () => new RedisStore(), true));
await run("mem", resolve<Store>(() => new MemStore(), () => new RedisStore(), false));
// The lock-wrapper shape: a class converted to a plain interface, the wrapper literal typed as that interface plus an optional method.
interface Plain { load(): Promise<number>; clear(): Promise<void>; hits: number }
type PlainD = Plain & { destroy?: () => Promise<void> };
function lockPlain(p: Plain): PlainD {
  const d = p as { destroy?: () => Promise<void> };
  return { load: () => p.load(), clear: () => p.clear(), hits: p.hits, destroy: async () => { console.log("locked destroy", d === undefined); } };
}
const pr = lockPlain(resolve<Plain>(() => new MemStore(), () => new RedisStore(), true));
const pm = lockPlain(resolve<Plain>(() => new MemStore(), () => new RedisStore(), false));
console.log(await pr.load(), await pm.load(), pr.hits, pm.hits);
await pr.destroy?.();
await pm.destroy?.();
await pr.clear();
console.log(await pr.load(), await pm.load());
