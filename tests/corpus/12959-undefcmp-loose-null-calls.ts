// Loose null tests (== null / != null) over calls with non-nullable results.
let n = 0;
function f(): number { n++; console.log("f " + n); return 1; }
function g(): { k: string } { n++; console.log("g " + n); return { k: "x" }; }
console.log(null == f());
console.log(null !== f());
console.log(f() == null);
console.log(g() != null);
const o = { v: 1, bump(): number { n++; console.log("bump " + n); return this.v; } };
console.log(o.bump() !== undefined);
console.log(o.bump() === undefined);
console.log(o.bump() != null);
console.log("n=" + n);
