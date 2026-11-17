// An any-typed Error (with expando properties and a cause) as a member of a printed object, array or Map.
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const e: any = new Error('m');
e.k = 'v';
const t: any = new TypeError('typed', { cause: e });
t.n = 1;
const plain: any = new RangeError('plain');
console.log({ e });
console.log([e, 1]);
console.log(new Map([['k', e]]));
console.log({ t, plain });
console.log([[e], [t]]);
console.log({ a: { b: { c: e } } });
