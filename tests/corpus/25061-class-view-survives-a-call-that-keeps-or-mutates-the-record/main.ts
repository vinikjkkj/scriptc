// Where a class instance is passed to a function that takes the record, a copy is exact only if the callee cannot tell it from the
// instance; each case below is one the view must survive, plus the safe one that may stay a copy.
interface R { n: number; name: string; exec(): number; }
class K {
  n = 1;
  name = "k";
  exec(): number { return this.n + 1; }
  bump(): void { this.n += 10; }
  rename(s: string): void { this.name = s; }
}
const kept: R[] = [];
const hooks: (() => void)[] = [];

// safe: reads and method calls only
function readOnly(r: R, k: number): string { return r.name + r.exec() + k; }
// stores the record: it outlives the call
function keep(r: R): void { kept.push(r); }
// writes through the record
function setN(r: R, v: number): void { r.n = v; }
// runs an unnamed function value that mutates the instance while the record is live
function callHooks(r: R): number { const before = r.n; for (const h of hooks) h(); return r.n - before; }
// compares identity
function same(a: R, b: R): boolean { return a === b; }
// a method of the record mutates the instance, and the callee reads the member afterwards
function viaMethod(r: R, k: K): number { k.bump(); return r.n; }

const a = new K();
console.log(readOnly(a, 1));
a.rename("a2");
console.log(readOnly(a, 2));

const b = new K();
keep(b);
b.n = 40;
b.rename("b2");
console.log(kept[0]!.n, kept[0]!.name, kept[0]!.exec());

const c = new K();
setN(c, 7);
console.log(c.n, c.exec());

const d = new K();
hooks.push(() => { d.n += 5; });
console.log(callHooks(d));

const e = new K();
console.log(same(e, e), same(e, new K()));

const f = new K();
console.log(viaMethod(f, f));

// a constructor that leaks `this` into a global: the callback it registered mutates the instance after the projection is taken
class Leaky {
  n = 0;
  constructor() { hooks.push(() => { this.n++; }); }
  exec(): number { return this.n + 100; }
}
interface L { n: number; exec(): number; }
const leaky = new Leaky();
const rl: L = leaky;
hooks.forEach((h) => h());
console.log(rl.n, rl.exec(), leaky.n);
function readLeaky(x: L): number { hooks.forEach((h) => h()); return x.n; }
console.log(readLeaky(new Leaky()));

