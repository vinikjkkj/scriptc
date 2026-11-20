// Typed-array methods over every numeric width: toSorted (float default order), at, indexOf, lastIndexOf, includes, reverse, toReversed, with, join, toString.
{
const f = new Float64Array([3.5, -0, NaN, 0, -1, Infinity, -Infinity, 2, -0, NaN]);
const s = f.toSorted();
console.log(s, Object.is(s[3], -0), Object.is(s[4], -0), Object.is(s[5], 0));
const g = new Float32Array([1.5, NaN, -2.25, 0, -0]);
g.sort();
console.log(g, Object.is(g[2], -0));
const i = new Int32Array([5, -3, 9, 0]);
console.log(i.toSorted(), i.toSorted((a, b) => b - a), i);
const u = new Uint16Array([300, 2, 65535, 7]);
console.log(u.toSorted(), u);
console.log(f.toSorted(undefined), new Float64Array(0).toSorted());
}
{
const f = new Float64Array([3.5, -0, NaN, 0, -1, 2, 3.5]);
console.log(f.at(0), f.at(-1), f.at(6), f.at(7), f.at(-8), f.at(1.9), f.at(-1.9), f.at(NaN), f.at(Infinity), new Float64Array(0).at(0));
console.log(f.indexOf(3.5), f.indexOf(3.5, 1), f.indexOf(3.5, -1), f.indexOf(3.5, -100), f.indexOf(NaN), f.indexOf(0), f.indexOf(-0), f.indexOf(9), f.indexOf(3.5, 7), f.indexOf(3.5, Infinity), f.indexOf(2, -Infinity));
console.log(f.lastIndexOf(3.5), f.lastIndexOf(3.5, 5), f.lastIndexOf(3.5, -2), f.lastIndexOf(3.5, -100), f.lastIndexOf(NaN), f.lastIndexOf(0), f.lastIndexOf(3.5, 100), f.lastIndexOf(3.5, NaN), f.lastIndexOf(3.5, 0), f.lastIndexOf(3.5, -Infinity));
console.log(f.includes(NaN), f.includes(0), f.includes(-0), f.includes(2, 6), f.includes(2, -2), f.includes(2, 99), f.includes(9));
const i = new Int32Array([1, 2, 3, 4, 5]);
console.log(i.reverse(), i.reverse() === i, i.at(-2), i.includes(3), i.indexOf(4), new Int8Array(0).reverse(), new Uint8Array([1, 2, 3, 4]).reverse());
const u = new Uint8Array([9, 8, 7, 6]);
console.log(u.at(1), u.indexOf(7), u.lastIndexOf(9), u.includes(6), u.reverse());
const s = new Float32Array([1.5, 2.5, 0.1]);
console.log(s.indexOf(0.1), s.includes(Math.fround(0.1)), s.indexOf(1.5), s.at(-1));
console.log(new Uint8Array(0).indexOf(1), new Uint8Array(0).lastIndexOf(1), new Uint8Array(0).includes(0));
}
{
const i = new Int32Array([3, -1, 2]);
const f = new Float64Array([1.5, NaN, -0, 1e21, 2]);
const u = new Uint16Array([1, 2, 300]);
console.log(i.toReversed(), i.with(1, 7), i.with(-1, 2.9), f.toReversed(), f.with(0, -0), u.with(2, 70000), i);
console.log(i.join(), i.join("-"), f.join(" | "), u.join(""), f.join(), i.toString(), f.toString(), String(u), `${i}`, "" + f);
try { i.with(5, 1); } catch (e: any) { console.log(e.name, e.message); }
try { i.with(-4, 1); } catch (e: any) { console.log(e.name, e.message); }
console.log(new Float32Array([0.1, 16777217]).join(), new Int8Array([127, 128, -129]).join(), new Uint8ClampedArray([300, -5, 1.5]).toReversed());
console.log(new Float64Array(0).toString() === "", new Int16Array(0).join("x") === "");
}
{
const u = new Uint8Array([1, 2]);
const i = new Int32Array([3, -1]);
console.log(u.toString());
console.log(i.toString());
}
