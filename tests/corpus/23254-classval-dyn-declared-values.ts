// Declared class values crossing into dyn and back: typeof, new (with super), statics, static methods,
// instanceof through a dyn class value, name, identity, inspect, Object.keys/values/entries, `in`,
// arrays, object literals, Map values, a checked downcast to `typeof A`, and the call-without-new TypeError.
class A {
  x: number;
  constructor(x: number) { this.x = x; }
  static s = 5;
  static t = "tee";
  static m() { return 7; }
  hi() { return "A" + this.x; }
}
class B extends A {
  constructor(x: number) { super(x + 1); }
  hi() { return "B" + super.hi(); }
}
const o: any = {};
o.K = A;
o.L = B;
const K = o.K, L = o.L;
console.log(typeof K, typeof L);
const a = new K(3);
const b = new L(3);
console.log(a.hi(), b.hi());
console.log(a instanceof K, b instanceof K, a instanceof L, b instanceof L);
console.log(K.s, K.m(), K.name, L.name);
console.log(K === A, K === L, K === o.K);
console.log(K, L);
console.log(Object.keys(K), Object.values(K), Object.entries(K));
console.log("s" in K, "m" in K, "zz" in K, Object.hasOwn(K, "s"));
try { K(1); } catch (e: any) { console.log(e.message, e instanceof TypeError); }

const lit: any = { K: A };
const arr: any[] = [A];
const m = new Map<string, unknown>([["k", A]]);
function make(C: any) { return new C(1); }
console.log(make(A).x, typeof arr[0], typeof (m.get("k") as any), lit);
console.log(arr, m);
const C2: typeof A = lit.K;
console.log(new C2(5).hi(), C2 === A);
const C3 = (o.L as typeof A);
console.log(new C3(5).hi(), C3 === B);

// An evaluated anonymous class returned as `unknown` (tests/diagnostics/class-values.ts used to refuse this).
function makeAnon(): unknown { return class {}; }
const v: any = makeAnon();
console.log(typeof v, v.name === "", new v() instanceof v, v);
const w: any = makeAnon();
console.log(v === w, new w() instanceof v);
