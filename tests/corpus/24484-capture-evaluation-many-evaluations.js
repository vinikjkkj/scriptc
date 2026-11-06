function make(prefix, n) { class C { constructor(){ this.v = n } m(){ return prefix + n } w(x){ return x + this.v } } return new C() }
let s = 0;
for (let i = 0; i < 20000; i++) {
  const c = make("p", i);
  const f = c.m;
  const g = c.w;
  s += f.length + g.call(c, 1) + (f() === "p" + i ? 1 : 0);
}
console.log(s);
