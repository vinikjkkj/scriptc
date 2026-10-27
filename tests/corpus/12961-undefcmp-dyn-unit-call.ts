// Dynamic (any) operands: the call runs, and the dynamic test answers.
let n = 0;
function f(): any { n++; console.log("f " + n); return 1; }
console.log(f() !== undefined);
const z: any = JSON.parse("null");
console.log(z === undefined, z !== undefined, z == null);
console.log("n=" + n);
