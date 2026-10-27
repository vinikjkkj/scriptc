// null-typed values that are NOT constant-folded: a null-typed parameter and run-time lets
// (undefined passed as an argument to an undefined-typed parameter is a separate, call-argument refusal and is not in this file)
function asNull(n: null): string { return `v=${n}`; }
function asUndef(): string { let u: undefined = undefined; return "w=" + u; }
function asStr(n: null): string { return String(n) + "/" + String(void 0); }
console.log(asNull(null));
console.log(asUndef());
console.log(asStr(null));
let k = 0;
for (let i = 0; i < 4; i++) k += i;
let r: null = null;
if (k > 100) r = null;
console.log(`r=${r}`, "r:" + r, String(r));
let q: undefined = undefined;
if (k > 100) q = undefined;
console.log(`q=${q}`, "q:" + q, String(q));
