// String(x) over unit-typed values
console.log(String(null));
console.log(String(undefined));
const n: null = null;
const u: undefined = undefined;
console.log(String(n));
console.log(String(u));
console.log(String(void 0));
