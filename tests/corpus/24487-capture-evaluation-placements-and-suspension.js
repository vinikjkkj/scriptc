function make(n) {
  class C { constructor() { this.v = n; } m() { return n; } }
  function build() { return new C(); }
  const viaArrow = () => new C();
  const obj = { mk() { return new C(); }, get g() { return new C(); } };
  const viaFnExpr = function () { return new C(); };
  const lazy = [1, 2].map(() => new C());
  return [build(), viaArrow(), obj.mk(), obj.g, viaFnExpr(), lazy[0], lazy[1], new C()];
}
const r1 = make(1), r2 = make(2);
console.log(r1.map((c) => c.m === r1[0].m).join(), r1[0].m === r2[0].m, r1[3].m.call(r2[4]), r2[5].m.call(r1[6]));
async function am(k) { class A { m() { return k; } } await null; const a = new A(); await null; const b = new A(); return [a, b]; }
function* gm(k) { class G { m() { return k; } } yield new G(); yield new G(); }
(async () => {
  const [a, b] = await am(7); const [c] = await am(8);
  console.log(a.m === b.m, a.m === c.m, a.m.call(c));
  const i1 = gm(5), i2 = gm(6); const g1 = i1.next().value, g2 = i1.next().value, h1 = i2.next().value;
  if (g1 && g2 && h1) console.log(g1.m === g2.m, g1.m === h1.m, g1.m.call(h1));
})();
