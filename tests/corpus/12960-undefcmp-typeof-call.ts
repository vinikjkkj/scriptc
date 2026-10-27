// typeof folds over calls: the operand runs even when its answer is known.
let n = 0;
let x = 0;
function f(): number { n++; console.log("f " + n); return 1; }
function g(): string { n++; console.log("g " + n); return "x"; }
console.log(typeof f() === "string");
console.log(typeof f() !== "undefined");
console.log(typeof g() === "string");
console.log(typeof g() === "number");
console.log(typeof (x++) === "string", x);
console.log(typeof (x = 9) == "object", x);
const o = { get gg(): number { console.log("get"); return 1; } };
console.log(typeof o.gg === "number");
console.log(typeof o.gg === "undefined");
console.log("n=" + n);
