class C {
  cache!: Map<string, number>;
  seen!: Set<string>;
  n = 1;
  init() { this.cache = new Map(); this.cache.set("a", 1); this.seen = new Set(["x"]); }
  get(k: string) { return this.cache.get(k); }
  lazy(k: string) {
    if (!this.cache) this.cache = new Map();
    this.cache.set(k, this.cache.size);
    return this.cache.size;
  }
  has() { return this.cache === undefined ? "none" : "some"; }
  loose() { return this.cache == null ? "L-none" : "L-some"; }
  looseNe() { return this.cache != null ? "ne-some" : "ne-none"; }
  strictNull() { return this.cache === null ? "null" : "notnull"; }
  tern() { return this.cache ? "t" : "f"; }
  neq() { return this.seen !== undefined; }
}
const c = new C();
console.log(c.has(), c.loose(), c.looseNe(), c.strictNull(), c.tern(), c.neq());
try { console.log(c.get("a")); } catch (e) { console.log((e as Error).message); }
try { console.log(c.seen.size); } catch (e) { console.log((e as Error).message); }
try { c.cache.set("q", 1); } catch (e) { console.log((e as Error).message); }
c.init();
console.log(c.has(), c.loose(), c.looseNe(), c.strictNull(), c.tern(), c.neq());
console.log(c.get("a"), c.get("zz"), c.cache.size, c.seen.has("x"));
const d = new C();
console.log(d.lazy("a"), d.lazy("b"), d.lazy("a"));
class E extends C { extra!: Map<string, string>; setup() { this.extra = new Map([["k", "v"]]); } peek() { return this.extra.get("k"); } }
const e = new E();
console.log(e.has());
try { console.log(e.peek()); } catch (er) { console.log((er as Error).message); }
e.setup(); e.init();
console.log(e.peek(), e.has(), e.get("a"));
