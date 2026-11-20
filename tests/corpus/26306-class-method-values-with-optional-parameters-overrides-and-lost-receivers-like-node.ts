// Class methods as values: defaults and optional parameters called short, overrides, super, async and generator methods, statics, a lost receiver.
class Base {
  n = 1;
  pure(x: number) { return x * 2; }
  usesThis() { return this.n; }
  withDefault(a: number, b = 5) { return a + b; }
  withOpt(a: number, b?: number) { return b === undefined ? a : a + b; }
  who() { return "base"; }
  async am() { return 7; }
  *gen() { yield 1; yield 2; }
  get prop() { return 3; }
  static sm(x: number) { return x + 1; }
  tick() { return this.n; }
}
class Derived extends Base {
  who() { return "derived"; }
  extra() { return super.who() + "!"; }
}
const b = new Base();
const d = new Derived();
console.log([1, 2, 3].map(b.pure));
try { console.log([1].map(b.usesThis)); } catch (e: any) { console.log(e.name + ": " + e.message); }
const wd = b.withDefault, wo = b.withOpt;
console.log(wd.call(b, 1), wd.call(b, 1, 2), wo.call(b, 1), wo.call(b, 1, 2), wd.apply(b, [3]));
const w = d.who;
console.log(w.call(d), w.call(b), b.who === d.who, Base.prototype.who === Derived.prototype.who);
const ex = d.extra;
console.log(ex.call(d));
b.am.call(b).then((v) => console.log("async", v));
const g = b.gen;
console.log([...g.call(b)]);
const sm = Base.sm;
console.log(sm(4), [1, 2].map(Derived.sm));
const t = b.tick;
setTimeout(() => { try { t(); } catch (e: any) { console.log("t", e.name); } }, 0);
console.log(typeof b.pure, b.pure.name, b.pure.length, d.pure === b.pure);
const o = { f: b.pure, g: d.who };
console.log(o.f(21), o.g.call(d));
