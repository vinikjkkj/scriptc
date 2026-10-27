// The same fold over string and object results.
let n = 0;
function s(): string { n++; console.log("s " + n); return "s"; }
function o(): { a: number } { n++; console.log("o " + n); return { a: 1 }; }
console.log(s() !== undefined);
console.log(s() === null);
console.log(o() !== undefined);
console.log(o() == null);
console.log("n=" + n);
