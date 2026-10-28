function __scrNumUndef(): number { return undefined as unknown as number; }
const u = __scrNumUndef();
const n = 5;
console.log(typeof u, typeof n);
console.log(u === undefined, u !== undefined, n === undefined, n !== undefined);
console.log(u == undefined, u == null, n == null);
console.log(String(u), `${u}`, "x" + u, u + 1, u * 2, -u);
console.log(u ?? 7, n ?? 7);
console.log(Number.isNaN(u), Number.isNaN(n), isNaN(u), isNaN(n));
console.log(!u, u || 3, n || 3);
console.log(u);
console.log(u + 1 === undefined);
