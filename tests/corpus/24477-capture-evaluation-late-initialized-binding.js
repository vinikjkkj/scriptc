function make(tag) {
  class C { m() { return later + tag; } }
  const later = "L";
  return { a: new C(), b: new C(), mk: () => new C() };
}
const r1 = make("1"), r2 = make("2");
const x = r1.a, y = r1.b, mk = r1.mk, x2 = r2.a;
console.log(x.m === y.m, x.m === mk().m, x.m === x2.m, x.m.call(x2), x2.m.call(x));
function mk3(k) {
  class D { n() { return z + k; } }
  var z = k * 2;
  const out = [];
  for (let i = 0; i < 2; i++) out.push(new D());
  return out;
}
const d = mk3(1), e = mk3(2);
console.log(d[0].n === d[1].n, d[0].n === e[0].n, d[0].n.call(e[0]));
