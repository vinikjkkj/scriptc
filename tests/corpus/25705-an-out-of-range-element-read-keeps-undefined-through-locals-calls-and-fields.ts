// The undefined an out-of-range read answers survives a local, a return, a parameter, a field, an array element and a closure, and still tells itself from NaN.
const b = new Uint8Array([7, 8, 9]);
let i = 3;
const x = b[i];
console.log(x, x === undefined, Number.isNaN(x));
function get(a: Uint8Array, k: number): number { return a[k]; }
console.log(get(b, 5), get(b, 5) === undefined, get(b, 1), get(b, 1) === undefined);
function passthrough(v: number): number { return v; }
console.log(passthrough(b[i]), passthrough(b[i]) === undefined, passthrough(b[0]));
const holder = { v: b[i], w: b[1] };
console.log(holder.v, holder.v === undefined, holder.w);
const items: number[] = [b[0], b[i]];
console.log(items.length, items[0], items[1] === undefined);
const later = () => b[i + 2];
console.log(later(), later() === undefined);
let acc = 0;
function bump(v: number): void { acc += v; }
bump(b[i]);
console.log(acc, Number.isNaN(acc));
let l: number = b[i];
console.log(l === undefined, l);
l = b[0];
console.log(l === undefined, l);
console.log(JSON.stringify({ a: b[i], b: b[0] }), JSON.stringify([b[i]]));
