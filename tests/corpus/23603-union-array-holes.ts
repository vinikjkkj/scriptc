// (T | undefined)[] holes: a hole is NOT an explicit undefined element (`in`, keys and inspect
// tell them apart); reads of either are undefined.
const a: (string | undefined)[] = new Array(4);
a[1] = "x";
a[2] = undefined;
console.log(a, a.length, 0 in a, 1 in a, 2 in a, 3 in a);
console.log(a[0] === undefined, a[0] ?? "d", `${a[0]}`, typeof a[0], a[2] === undefined, a[2] ?? "e");
a.forEach((v, i) => console.log(i, v));
console.log(a.map((v) => v), a.filter(() => true), Object.keys(a), a.join("-"));
console.log(a.some((v) => v === undefined), a.every((v) => v !== undefined));
for (const v of a) console.log("of", v);
const b: (number | undefined)[] = new Array(3);
b[2] = 5;
console.log(b, 0 in b, 2 in b, b.length);
console.log([...b], b.slice(), Array.from(b));
const c = [1, , 3];
console.log(c, 1 in c, c.length, Object.keys(c));
const d: (string | undefined)[] = ["a", , "c"];
console.log(d, 1 in d, d.length);
const e: (string | null)[] = new Array(2);
e[0] = null;
console.log(e, 0 in e, 1 in e);
