// A union with no undefined or null arm: the answer is constant, the call still runs.
let n = 0;
function u(): number | string { n++; console.log("u " + n); return 3; }
console.log(u() === undefined);
console.log(u() !== undefined);
console.log(u() === null);
console.log("n=" + n);
