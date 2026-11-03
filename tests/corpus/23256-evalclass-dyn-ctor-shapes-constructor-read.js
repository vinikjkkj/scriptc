// `new V(...)` through a dyn class value over every constructor shape (defaults, rest, none, inherited),
// and `x.constructor` read through a dyn instance answering the very class value the instance came from.
function anyv(x) { return x; }
class Base { constructor(a) { this.a = a; } }
function mk(tag) {
  return class R extends Base {
    static made = 0;
    constructor(a, b = "dflt", ...rest) { super(a); R.made++; this.v = [tag, a, b, rest.length]; }
  };
}
function mkBare(tag) {
  return class Bare extends Base { tag() { return tag; } };
}
const h = {};
h.R = mk("t");
h.Bare = mkBare("u");
const R = anyv(h.R), Bare = anyv(h.Bare);
console.log(new R(1).v, new R(1, "x", 3, 4).v, R.made);
console.log(new Bare(5).a, new Bare(5).tag());
const i = anyv(new R(9));
const C = i.constructor;
console.log(C === R, typeof C, C.name, C.made, new C(2).v, i instanceof C);
console.log(anyv(new Bare(1)).constructor === Bare, anyv(new Bare(1)).constructor.name);
class D { m() { return 1; } }
console.log(anyv(new D()).constructor === D, anyv(new D()).constructor.name);
