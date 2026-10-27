// BigInt64Array / BigUint64Array from a bigint array literal, and set() from
// one: each element keeps its low 64 bits (ToBigInt64 / ToBigUint64).
const a = new BigInt64Array([1n, -2n, 9223372036854775807n, 9223372036854775808n]);
console.log(a.length, a[0], a[1], a[2], a[3]);
const b = new BigUint64Array([-1n, 18446744073709551617n, 42n]);
console.log(b.length, b[0], b[1], b[2]);
const c = new BigInt64Array(4);
c.set([7n, -8n], 2);
console.log(c[0], c[1], c[2], c[3]);
const d = new BigUint64Array(2);
d.set([5n, 6n]);
console.log(d[0], d[1], d.byteLength);
const e = new BigInt64Array([]);
console.log(e.length, e.byteLength);
