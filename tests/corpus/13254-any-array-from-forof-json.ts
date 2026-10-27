// Array.from, Array.isArray, for-of, destructuring, JSON.stringify, console.log of dyn arrays.
const src: any[] = [1, "a", true, null];
const copy: any[] = Array.from(src);
console.log(copy.join(","), Array.isArray(src), Array.isArray("x" as any));
const fromN: any[] = Array.from({ length: 3 }, (_: any, i: number) => (i === 1 ? "mid" : i));
console.log(fromN.join(","));
for (const v of src) {
  console.log(typeof v, String(v));
}
const [first, second, ...rest] = src;
console.log(first, second, rest.length);
const [p = "d", q2 = "e"] = [undefined, 5] as any[];
console.log(p, q2);
console.log(JSON.stringify(src));
console.log(JSON.stringify([src, [null, "z"]]));
console.log(src);
console.log([undefined, "s", 3]);
