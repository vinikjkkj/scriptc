// Template and concatenation operands of a unit comparison.
let n = 0;
function s(): string { n++; console.log("s " + n); return "q"; }
console.log(`${s()}!` !== undefined);
console.log(s() + "x" === undefined);
console.log("n=" + n);
