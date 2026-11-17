// An any-typed Error with expandos and a cause held in object, array and Map variables.
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const e: any = new Error('m');
e.k = 'v';
const t: any = new TypeError('typed', { cause: e });
const r = { e, t };
console.log(r);
const a = [e, 1, t];
console.log(a);
const m = new Map([['k', e]]);
console.log(m);
r.e.k = 'changed';
console.log(r.e, a[0]);
