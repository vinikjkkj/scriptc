// An evaluated class value held in dyn: typeof/new (spread and rest)/statics/static writes/instanceof
// across two evaluations/identity/inspect/Map keys/Object.keys, and the call-without-new TypeError.
class Base { constructor(a) { this.a = a; } who() { return "base" + this.a; } }
function mk(tag, n) {
  return class Made extends Base {
    static count = 0;
    static label = "L" + tag;
    constructor(a, b) { super(a + n); this.b = b; Made.count++; }
    who() { return tag + ":" + super.who() + ":" + this.b; }
    static make(x) { return new Made(x, "m"); }
    static twice() { return this.count * 2; }
  };
}
function anyv(x) { return x; }
const holder = {};
holder.A = mk("A", 1);
holder.B = mk("B", 10);
const A = holder.A, B = holder.B;
console.log(typeof A, typeof B, A === holder.A, A === B, A.name);
const a1 = new A(1, "x"), a2 = new A(2, "y"), b1 = new B(1, "z");
console.log(a1.who(), a2.who(), b1.who());
console.log(a1 instanceof A, a1 instanceof B, b1 instanceof B, b1 instanceof A, a1 instanceof Base, anyv({}) instanceof A, anyv(5) instanceof A);
console.log(A.count, B.count, A.label, B.label);
console.log(A.make(7).who(), A.count, A.twice());
A.count = 100;
console.log(A.count, B.count);
console.log(A, B);
console.log([A], { k: B });
try { anyv(A)(1); } catch (e) { console.log(e instanceof TypeError, e.message); }
const arr = [A, B];
const m = new Map(); m.set(A, "a"); m.set(B, "b");
console.log(arr[0] === A, m.get(A), m.get(B), m.get(holder.A), m.size);
function build(C, ...args) { return new C(...args); }
console.log(build(B, 5, "q").who(), build(A, 1, "w") instanceof A);
const keys = Object.keys(A); console.log(keys);
console.log(String(typeof A.make), typeof anyv(A).nonexistent);
