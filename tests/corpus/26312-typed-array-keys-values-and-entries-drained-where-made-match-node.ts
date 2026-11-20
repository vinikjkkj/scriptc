const a = new Int32Array([3, 1, 2]);
console.log([...a.keys()]);
console.log([...a.values()]);
console.log([...a.entries()]);
console.log(Array.from(a.entries()).map(([i, v]) => i * v));
const f = new Float64Array([1.5, NaN, -0]);
console.log([...f.values()], [...f.entries()]);
const u = new Uint8Array([9, 8]);
console.log([...u.keys()].length);
const b = new BigInt64Array([5n, -6n]);
console.log([...b.values()], [...b.keys()], [...b.entries()]);
const bu = Buffer.from("hi");
console.log([...bu.values()], [...bu.entries()]);
function sum(it: Iterable<number>) { let s = 0; for (const x of it) s += x; return s; }
console.log(sum(a.values()), sum(a.keys()));
