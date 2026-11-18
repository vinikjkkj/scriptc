// An out-of-range element read flows into a number | undefined parameter, a union-typed local, an optional field and an array of them as undefined (the union takes its undefined arm).
const b = new Uint8Array([3, 4]);
let i = 2;
function describe(x: number | undefined): string { return x === undefined ? "undef" : "num:" + x; }
console.log(describe(b[i]), describe(b[0]), describe(b[-1]), describe(b[1]));
const arr: (number | undefined)[] = [b[i], b[0], b[5]];
console.log(arr, arr[0] === undefined, arr[1] === undefined, arr[2] === undefined);
interface Opt { a?: number; b: number | undefined }
const o: Opt = { a: b[i], b: b[i] };
console.log(o, o.a === undefined, o.b === undefined);
const pick = (k: number): number | undefined => (k < 10 ? b[k] : undefined);
console.log(pick(0), pick(7), pick(7) === undefined, pick(11));
