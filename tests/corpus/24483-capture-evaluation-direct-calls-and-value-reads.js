// value read inside the declaring function; hot call
function make(p) {
  class C { m() { return p; } }
  const c = new C();
  const f = c.m;
  const g = c.m;
  return [f === g, f.call(new C()), c];
}
const [same, v, c] = make("p");
console.log(same, v, c.m());
let acc = 0;
function hot(n) { class H { constructor() { this.k = n; } step(i) { return i + n; } } const h = new H(); let s = 0; for (let i = 0; i < 1000; i++) s += h.step(i); return s; }
for (let j = 0; j < 100; j++) acc += hot(j);
console.log(acc);
const c2 = make("q")[2]; console.log(c.m.call(c2), c2.m.call(c), c.m === c2.m);
