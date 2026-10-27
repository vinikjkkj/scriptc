// console.log of non-Buffer typed arrays: Node's `Name(n) [ ... ]` form,
// with the array grid above six entries and the "... more items" tail.
import { inspect } from "node:util";

console.log(new Uint8ClampedArray([10, 300, -1, 127.5]));
console.log(new Uint8Array(0));
console.log(new Int16Array([1, -2, 3]));
console.log(new Uint16Array([7, 8, 9, 10, 11, 12, 13]));
console.log(new Int8Array([-128, 127, 0]));
console.log(new Uint32Array([4294967295, 0]));
console.log(new Int32Array([-5, 6]));
console.log(new Float32Array([0.5, 1.25]));
console.log(new Float64Array([-0, 2.5]));
console.log(new Float16Array([0.1, 65520, NaN]));
const big = new Uint8Array(120);
for (let i = 0; i < 120; i++) big[i] = i;
console.log(big);
console.log(inspect(new Int16Array([5, 6])));
console.log(inspect(new Float16Array([1.5])));
