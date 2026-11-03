// A parameter property makes Node refuse the whole TypeScript module, so no exact class source text exists: an evaluated class
// value (whose String() must print Node's text) keeps the compile-time refusal into dyn.
class P { constructor(public n: number) {} }
const mk = (k: number = 0) => class Q extends P { static k = k; };
const h: any = {};
h.Q = mk(1);
console.log(typeof h.Q);
