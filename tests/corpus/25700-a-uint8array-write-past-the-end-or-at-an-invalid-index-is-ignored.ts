// Node: an index that names no element (past the end, negative, fractional, NaN, infinite) is ignored by a write, in sloppy and strict code alike; it never throws, never grows the array
// and never reaches the neighbouring element. -0 names element 0.
const b = new Uint8Array(4);
let i = 7;
b[i] = 5;
b[i + 1] = 6;
console.log(b.join(","), b.length);
let neg = -1;
b[neg] = 9;
b[neg - 1] = 9;
let frac = 0.5;
b[frac] = 9;
b[1.5] = 9;
const nan = Number("x");
b[nan] = 9;
b[Infinity] = 9;
b[-Infinity] = 9;
b[4] = 9;
b[2 ** 32] = 9;
b[2 ** 53] = 9;
console.log(b.join(","), b.length);
b[-0] = 3;
let z = -0;
b[z + 1] = 4;
console.log(b.join(","), b.length);
function fill(a: Uint8Array, n: number): void { for (let k = 0; k < n; k++) a[k] = k + 1; }
fill(b, 10);
console.log(b.join(","), b.length);
const empty = new Uint8Array(0);
empty[0] = 1;
console.log(empty.length, empty.join(","));
