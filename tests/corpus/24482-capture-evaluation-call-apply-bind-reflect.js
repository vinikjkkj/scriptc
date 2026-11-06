function make(prefix, n) {
  class C {
    constructor() { this.v = n; }
    m() { return prefix + n; }
    w(x) { return prefix + x + this.v; }
  }
  return new C();
}
const a = make("p", 1), b = make("q", 2);
console.log(a.m.call(b), a.m.apply(b, []), a.m.bind(b)(), Reflect.apply(a.m, b, []));
console.log(a.w.call(b, "-"), a.w.apply(b, ["-"]), a.w.bind(b, "-")(), Reflect.apply(a.w, b, ["-"]));
console.log(a.m.call(undefined), a.m.call(null), a.m.call(1));
const arr = [a, b];
console.log(arr.map((o) => o.m === a.m).join());
console.log([1].map(a.m).join(), [b].map(a.w.bind(b, "z")).join());
setTimeout(a.m, 0);
const o = { f: a.m };
console.log(o.f(), o.f === a.m);
console.log(new Set([a.m, b.m, a.m]).size);
