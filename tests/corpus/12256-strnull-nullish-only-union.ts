// unions whose arms are only nullish (null | undefined), decided at run time
function nn(v: null | undefined): string { return `[${v}]`; }
function nc(v: null | undefined): string { return "(" + v + ")"; }
function ns(v: null | undefined): string { return String(v); }
const vals: (null | undefined)[] = [null, undefined];
for (const v of vals) console.log(nn(v), nc(v), ns(v));
let t = 0;
for (let i = 0; i < 2; i++) t += i;
const z: null | undefined = t === 1 ? null : undefined;
console.log(`${z}`, "" + z, String(z));
