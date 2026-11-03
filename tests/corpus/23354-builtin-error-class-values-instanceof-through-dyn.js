class D extends Error { constructor(m) { super(m); } }
class Sub extends D {}
function t(x, C) { return x instanceof C; }
const e = new D("x");
console.log(t(e, D), t(e, Error), t(e, TypeError), t(e, Sub));
console.log(t(new Error("x"), Error), t(new TypeError("x"), Error), t(new Error("x"), TypeError), t(new RangeError("x"), RangeError));
console.log(t(new Sub("y"), D), t(new Sub("y"), Error), t(new D("y"), Sub));
console.log(t(5, Error), t({}, Error), t(null, Error));
