// super.m(...) across mismatched signatures: a fixed override that calls a variadic base,
// a variadic override that calls a fixed base, and a value override that calls a void base.
class Base {
  m() { return "B" + arguments.length + ":" + (arguments.length ? arguments[0] : "-"); }
  f(a, b) { return "f:" + a + ":" + b; }
  v(x) { this.saw = x; }
}
class Mid extends Base {
  m(x) { return "M(" + super.m(x, x) + ")"; }
  f() { return "g:" + arguments.length + ":" + super.f(arguments[0], 7); }
  v(x) { super.v(x); return "vmid:" + x; }
}
class Leaf extends Mid {
  m(a, b, c) { return "L(" + super.m(a) + "|" + c + ")"; }
}
const l = new Leaf();
const asBase = l;
console.log(asBase.m(1), asBase.m(), asBase.m(1, 2, 3));
console.log(asBase.f(4), asBase.f(4, 5, 6), l.f());
console.log(asBase.v(8), l.saw);
