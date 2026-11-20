// An any[] literal with no static home (a loop source, an annotated slot, an argument, a spread) is a checked-dynamic array and answers like Node.
const s: any = JSON.parse('"abc"');
const n: any = JSON.parse('7');
const o: any = JSON.parse('{"k":[1,2]}');
for (const v of [s, n, 1, "z", null, true]) console.log(typeof v, String(v));
const xs: any[] = [s, n, o, 2, "w"];
console.log(xs.length, xs[0], xs[3], xs[2].k[1]);
xs.push(9, s);
console.log(xs.length, xs.map((x) => typeof x).join(","));
function total(a: any[]): number { let t = 0; for (const x of a) if (typeof x === "number") t += x; return t; }
console.log(total([n, 1, 2, s]));
console.log(JSON.stringify([s, n, o]));
const ys: Array<any> = [n, ...[1, 2], s];
console.log(ys.length, ys.join("|"));
const nested: any[] = [[s, 1], [n, "q"]];
for (const [a, b] of nested) console.log(a, b);
console.log([s, n].concat([1]).length, [n, 5].indexOf(5), [s, n].includes("abc"));
console.log([n, 3, 1].sort().join());
