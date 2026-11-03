// string[] holes: new Array(n), a write past the end, delete and length growth leave HOLES
// (not undefined values): `in`, keys, forEach/map/filter/some/every/reduce, join, JSON and
// inspect all tell a hole from an element, exactly like Node.
const a: string[] = new Array(4);
a[1] = "x";
a[3] = "y";
console.log(a.length, 0 in a, 1 in a, 2 in a, 3 in a, 4 in a);
console.log(a);
console.log(a.join("-"), String(a), `${a}`);
console.log(JSON.stringify(a));
a.forEach((v, i) => console.log("each", i, v));
console.log(a.map((v) => v + "!"));
console.log(a.filter(() => true), a.some((v) => v === "x"), a.every((v) => v.length === 1));
console.log(a.reduce((p, v) => p + v, ">"), a.reduceRight((p, v) => p + v, "<"));
for (const k in a) console.log("key", k);
console.log(Object.keys(a));
console.log(a.indexOf("y"), a.includes("x"), a.indexOf("zz"));
console.log([...a], Array.from(a), a.slice(1), a.concat(["z"]));

const b: string[] = [];
b[5] = "far";
console.log(b, b.length, 0 in b, 5 in b);
b.length = 8;
console.log(b, b.length);
b[0] = "first";
delete b[0];
console.log(b, 0 in b);
delete b[5];
console.log(b, b.length, Object.keys(b).length);

const dense: string[] = ["a", "b", "c"];
delete dense[1];
console.log(dense, 1 in dense, dense.length);
dense[1] = "B";
console.log(dense, 1 in dense);

const big: string[] = new Array(130);
big[0] = "a";
big[129] = "z";
console.log(big);
console.log(a.slice().sort(), b.length);
const e: string[] = new Array(0);
console.log(e, e.length);
const one: string[] = new Array(1);
console.log(one, 0 in one);
