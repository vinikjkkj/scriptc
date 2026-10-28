function __scrNumUndef(): number { return undefined as unknown as number; }
const u = __scrNumUndef();
console.log(Math.floor(u), Math.abs(u), Math.round(u), Math.trunc(u));
console.log(Math.max(u, 1), Math.min(u, 1), Math.pow(u, 2));
console.log(Math.ceil(u), Math.log(u), u ** 2);
