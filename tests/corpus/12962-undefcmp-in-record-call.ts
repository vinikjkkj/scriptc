// The `in` fold over a receiver that is itself a call: the call runs.
let n = 0;
type R = { rec: { a: number } };
const r: R = { rec: { a: 1 } };
function g(): R { n++; console.log("g " + n); return r; }
console.log("a" in g().rec);
console.log("z" in g().rec);
console.log("n=" + n);
