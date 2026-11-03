// number[] holes: the same operations over the NaN-marked hole slot. Arithmetic on a hole is
// NaN, and no computed NaN is ever taken for a hole.
const a: number[] = new Array(4);
a[1] = 10;
a[3] = 30;
console.log(a.length, 0 in a, 1 in a, 2 in a, 3 in a, 4 in a);
console.log(a);
console.log(a.join("-"), String(a), `${a}`);
console.log(JSON.stringify(a));
a.forEach((v, i) => console.log("each", i, v));
console.log(a.map((v) => v * 2));
console.log(a.filter(() => true), a.some((v) => v === 10), a.every((v) => v > 0));
console.log(a.reduce((p, v) => p + v, 0), a.reduceRight((p, v) => p + v, 1));
for (const k in a) console.log("key", k);
console.log(Object.keys(a));
console.log(a.indexOf(30), a.includes(10), a.includes(NaN), a.indexOf(NaN));
console.log([...a], Array.from(a), a.slice(1), a.concat([40]));
console.log(a[0] === undefined, typeof a[0], `${a[0]}`, a[0] ?? -1, a[0] + 1, Number.isNaN(a[0]), isNaN(a[0]));
const nan: number[] = [NaN, 1];
console.log(nan, nan.includes(NaN), nan.indexOf(NaN), nan[0] === undefined, typeof nan[0]);

const b: number[] = [];
b[3] = 7;
console.log(b, b.length, 0 in b, 3 in b);
b.length = 6;
b[5] = 1;
console.log(b, b.length);
delete b[3];
console.log(b, 3 in b, Object.keys(b));

const c: number[] = [1, 2, 3];
delete c[0];
console.log(c, c.length, 0 in c);
console.log(c.slice().sort((x, y) => x - y));
const sorted: number[] = [5, , 1, , 3] as number[];
sorted.sort((x, y) => x - y);
console.log(sorted, sorted.length);
