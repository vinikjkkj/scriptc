// Reflect.ownKeys / Object.keys / getOwnPropertyNames over CLASS INSTANCES:
// the keys are the fields of the class the instance really is (a base-typed
// value may hold a subclass), in layout order; private #fields, accessors,
// methods and statics are not own keys, and a field the constructor assigns
// only conditionally is absent until it is. Node is the oracle.
class P {
  a = 1;
  #hid = 2;
  static s = 3;
  b = "x";
  get g() { return 1; }
  set g(v) {}
  constructor(flag) { this.c = flag; if (flag) this.late = 5; }
  m() { return this.#hid; }
}
class Q extends P { d = [1]; constructor() { super(true); this.e = 1; } }
const names = (o) => Reflect.ownKeys(o);
console.log(names(new P(false)), names(new P(true)), names(new Q()));
console.log(Object.keys(new Q()).length, Object.getOwnPropertyNames(new Q()));

class A { constructor() { this.z = 1; this.y = "s"; } m() {} }
class B extends A { constructor() { super(); this.w = true; } }
class E {}
console.log(Reflect.ownKeys(new A()), Object.keys(new B()));
function ks(x) { return Object.keys(x); }
console.log(ks(new A()), ks(new B()), Reflect.ownKeys(new E()));
