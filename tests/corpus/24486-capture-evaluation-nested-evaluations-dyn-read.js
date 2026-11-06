function dd(o, k) { return o[k]; }
// nested evaluations and loops
function outer(k) {
  const out = [];
  for (const tag of ["x", "y"]) {
    class C { constructor() { this.t = tag; } get1() { return tag + k; } }
    out.push(new C(), new C());
  }
  return out;
}
const [x1, x2, y1, y2] = outer(5);
console.log(x1.get1 === x2.get1, x1.get1 === y1.get1, y1.get1 === y2.get1);
const get1 = dd(x1, "get1");
console.log(get1(), get1.call(y1), y1.get1.call(x1));
function mk2(p) {
  function inner(q) {
    class D { m() { return p + q; } }
    return new D();
  }
  return [inner("1"), inner("2")];
}
const [d1, d2] = mk2("z");
console.log(d1.m.call(d2), d2.m.call(d1), d1.m === d2.m);
