// spread into array literals and calls, concat, slice, reverse, indexOf/includes (SameValueZero).
const a: any[] = [1, "two", null, undefined, 3];
const b: any[] = [...a, "tail"];
console.log(b.length, b.join("/"));
const c: any[] = ["head", ...a];
console.log(c.length, c.join("/"));
function count(...xs: any[]): number {
  return xs.length;
}
console.log(count(...a), count(...a, 9));
console.log(a.concat(["x", 7]).join(","), a.length);
console.log(a.slice(1, 3).join(","), a.slice(-2).join(","));
const r: any[] = a.slice();
r.reverse();
console.log(r.join(","));
const nan: any[] = [NaN, 0, "0", 1];
console.log(nan.indexOf(NaN), nan.includes(NaN), nan.indexOf(0), nan.indexOf("0"), nan.includes(1));
console.log(a.indexOf(undefined), a.includes(null), a.indexOf("3"), a.includes(3));
