// A call compared with undefined or null, where the callee's result type is
// not nullable: the constant fold must still run the call, once, in order.
let n = 0;
function f(): number { n++; console.log("called " + n); return 1; }
console.log(f() !== undefined);
console.log(f() === undefined);
console.log(f() == null);
console.log(f() != null);
console.log(undefined === f());
console.log("n=" + n);
