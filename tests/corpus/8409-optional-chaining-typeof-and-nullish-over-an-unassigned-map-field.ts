class C {
  cache!: Map<string, number>;
  init() { this.cache = new Map([["a", 1]]); }
  a() { return this.cache?.size; }
  b() { return this.cache?.get("a"); }
  c() { return typeof this.cache; }
  d() { const m = this.cache ?? new Map<string, number>(); return m.size; }
  f() { console.log(this.cache); }
}
const c = new C();
const show = (f: () => unknown) => { try { console.log(f()); } catch (e) { console.log("threw", (e as Error).message); } };
show(() => c.b()); show(() => c.c()); show(() => c.d());
c.init();
show(() => c.a()); show(() => c.b()); show(() => c.c()); show(() => c.d()); show(() => c.f());
