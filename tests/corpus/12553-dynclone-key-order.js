// Clone of a dyn-held instance: declared fields, runtime-defined properties, and
// the key order of Object.keys. The runtime properties are defined after construction.
class Route {
  constructor(name, hops) {
    this.name = name;
    this.hops = hops;
    this.meta = { via: "a" };
  }
  setVia(v) {
    this.meta.via = v;
    return this.meta.via;
  }
  put(k, v) {
    Object.defineProperty(this, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
}
function pass(x) {
  return x;
}
const r = pass(new Route("north", 3));
r.put("extra", "late");
r.put("count", 2);
const src = r;
const c = Object.create(Object.getPrototypeOf(src), Object.getOwnPropertyDescriptors(src));
console.log(c.name, c.hops, c.extra, c.count, c.meta.via);
console.log(JSON.stringify(c.meta) === JSON.stringify(r.meta));
c.hops = 9;
c.count = 5;
console.log(c.setVia("b"), r.meta.via, c.meta.via);
console.log(r.hops, c.hops, r.count, c.count);
console.log(c instanceof Route);
