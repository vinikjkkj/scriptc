class NoCtor extends Error {}
class WithCtor extends Error { constructor(m, extra) { super(m); this.extra = extra; } }
const C = NoCtor, W = WithCtor;
const e = new C("m1");
console.log(e.message, e instanceof C);
function mk(K, m, o) { return new K(m, o); }
const e2 = mk(NoCtor, "m2", { cause: "why" });
console.log(e2.message, e2.cause);
const e3 = mk(WithCtor, "m3", 7);
console.log(e3.message, e3.extra);
const e4 = mk(NoCtor);
console.log(JSON.stringify(e4.message), e4.cause);
