const xs: string[] = ["a", "bb"];
const ns: number[] = [1, 2];
let calls = 0;
function idx(): number { calls++; return 5; }
class C {
  opt?: string;
  items: { n: number }[] = [{ n: 7 }];
  m(i: number) {
    const o = this.opt!;
    const it = this.items[i];
    try { console.log(o.length); } catch (e) { console.log((e as Error).message); }
    try { console.log(it.n); } catch (e) { console.log((e as Error).message); }
  }
}
new C().m(0);
new C().m(3);
function side() {
  const v = xs[idx()];
  console.log("calls", calls);
  try { console.log(v.length); } catch (e) { console.log((e as Error).message); }
  console.log("calls", calls);
}
side();
function* gen(i: number) {
  const g = xs[i];
  yield 1;
  try { yield g.length; } catch (e) { yield -1; }
}
for (const q of gen(0)) console.log("g0", q);
for (const q of gen(9)) console.log("g9", q);
async function af(i: number) {
  const a = xs[i];
  await null;
  try { return a.length; } catch (e) { return (e as Error).message; }
}
af(1).then((v) => console.log("async", v));
af(8).then((v) => console.log("async", v));
function cap(i: number) {
  const c = xs[i];
  const f = () => c.length;
  const h = () => { const g2 = () => c.toUpperCase(); return g2(); };
  try { console.log(f(), h()); } catch (e) { console.log((e as Error).message); }
}
cap(0);
cap(4);
function nested(i: number) {
  for (let k = 0; k < 2; k++) {
    const e = ns[i + k];
    try { console.log(k, e * 2, e.toFixed(1)); } catch (er) { console.log((er as Error).message); }
  }
}
nested(0);
nested(1);
const bn = xs[0]!;
console.log(bn.length);
const idx2 = ns[3]!;
console.log(idx2 + 1);
