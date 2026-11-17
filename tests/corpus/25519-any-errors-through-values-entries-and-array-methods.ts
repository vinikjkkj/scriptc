// any-typed Errors (with expandos) held in records and arrays, enumerated and mapped.
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const e: any = new Error('m');
e.k = 'v';
const t: any = new TypeError('typed');
const rec = { e, t, n: 1 };
console.log(Object.values(rec));
console.log(Object.entries(rec).map(([k, v]) => k + ':' + typeof v));
const arr = [e, t, 2];
console.log(arr.map((x) => typeof x), arr.filter((x) => typeof x === 'object'));
console.log(arr.map((x) => (typeof x === 'object' ? x.message : x)));
