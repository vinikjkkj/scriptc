// A TypeScript function value that reads this keeps its receiver through .call and .apply, like Node; plain functions still call directly.
const o1 = { x: 1, add(k: number, j: number) { return this.x + k + j; }, tag() { return "o1:" + this.x; } };
const o2 = { x: 20, add(k: number, j: number) { return this.x + k + j; }, tag() { return "o2:" + this.x; } };
const add = o1.add;
console.log(add.call(o2, 1, 2), add.apply(o2, [3, 4]), add.call(o1, 1, 1));
const tags = [o1.tag, o2.tag];
console.log(tags.map((f, i) => f.call(i === 0 ? o2 : o1)).join());
function run(f: (k: number, j: number) => number, who: { x: number }) { return f.call(who, 100, 200) + f.apply(who, [1, 2]); }
console.log(run(o1.add, { x: 5 }), run(o2.add, o1));
function plain(a: number, b: number) { return a * b; }
const arrow = (a: number) => a + 1;
console.log(plain.call(null, 3, 4), plain.apply(undefined, [5, 6]), arrow.call(null, 1));
const o3 = { n: 7, get() { return this.n; } };
function viaParam(f: () => number) { return f.call({ n: 8 }); }
console.log(viaParam(o3.get), viaParam(() => 1));
