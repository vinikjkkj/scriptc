// zapo-js 1.12.0 in miniature: two instantiations of one generic class returned through its `<string, unknown>` view by a ternary.
interface Rec { id: number }
interface Dist { tag: string }
class Idx<K, V> {
  data: Map<K, V>;
  order: K[] = [];
  constructor(data: Map<K, V>) { this.data = data; }
  touch(key: K): void {
    const v = this.data.get(key);
    if (v === undefined) return;
    this.data.delete(key);
    this.data.set(key, v);
    this.order.push(key);
  }
  delete(key: K): void { this.data.delete(key); this.order.push(key); }
  clear(): void { this.data.clear(); this.order.length = 0; }
}
class Store {
  protected readonly recs = new Map<string, Rec>();
  protected readonly dists = new Map<string, Dist>();
  getRec(key: string): Rec | undefined { const r = this.recs.get(key); if (r !== undefined) this.onAccess(this.recs, key); return r; }
  getDist(key: string): Dist | undefined { const d = this.dists.get(key); if (d !== undefined) this.onAccess(this.dists, key); return d; }
  putRec(key: string, r: Rec): void { this.recs.set(key, r); }
  putDist(key: string, d: Dist): void { this.dists.set(key, d); }
  dropRec(key: string): void { this.recs.delete(key); this.onRemove(this.recs, key); }
  protected onAccess(entries: Map<string, unknown>, key: string): void { }
  protected onRemove(entries: Map<string, unknown>, key: string): void { }
}
class IdleStore extends Store {
  readonly idleRecs: Idx<string, Rec>;
  readonly idleDists: Idx<string, Dist>;
  constructor() {
    super();
    this.idleRecs = new Idx<string, Rec>(this.recs);
    this.idleDists = new Idx<string, Dist>(this.dists);
  }
  protected override onAccess(entries: Map<string, unknown>, key: string): void { this.indexFor(entries).touch(key); }
  protected override onRemove(entries: Map<string, unknown>, key: string): void { this.indexFor(entries).delete(key); }
  private indexFor(entries: Map<string, unknown>): Idx<string, unknown> {
    return entries === this.recs ? this.idleRecs : this.idleDists;
  }
}
const s = new IdleStore();
for (const k of ["a", "b", "c"]) { s.putRec(k, { id: k.charCodeAt(0) }); s.putDist(k + "!", { tag: k }); }
s.getRec("a"); s.getDist("b!"); s.getRec("b"); s.getDist("a!"); s.getRec("a");
console.log([...s.idleRecs.data.keys()].join(","), [...s.idleDists.data.keys()].join(","));
console.log(s.idleRecs.order.join(","), "|", s.idleDists.order.join(","));
s.dropRec("c");
console.log([...s.idleRecs.data.keys()].join(","), s.idleRecs.order.join(","), s.idleDists.order.length);
console.log(s.getRec("zzz"), s.getDist("nope"));
