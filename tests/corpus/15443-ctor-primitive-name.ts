// `prim.constructor.name` on a primitive, and on a union of primitive arms, is the
// builtin wrapper's name in Node.
function nmS(sql: string): string { return sql.constructor.name; }
function nmN(n: number): string { return n.constructor.name; }
function nmB(b: boolean): string { return b.constructor.name; }
function nmBig(b: bigint): string { return b.constructor.name; }
function nmU(v: string | number | boolean): string { return v.constructor.name; }
console.log(nmS("a"), nmN(2), nmB(false), nmBig(3n));
console.log(nmU("x"), nmU(4), nmU(true));
