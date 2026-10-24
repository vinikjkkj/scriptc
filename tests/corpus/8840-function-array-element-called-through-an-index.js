// An element of an array of functions called through an index (`fs[0](x)`, `[g, r][1](x)`)
// is a function call with the array as this. It threw "fs[0] is not a function".
function g(x) { return x * 2; }
const r = (x) => x + 100;
console.log([g, r][0](9), [g, r][1](9));
const fs = [g, r];
console.log(fs[0](4), fs.map((f) => f(1)));
