// util.inspect / util.format of object, array and Map literals over any-typed values, with depth, compact and breakLength options.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const n: any = 5;
const e: any = new Error('boom');
e.code2 = 'X';
const o: any = { deep: { deeper: { deepest: [1, 2, 3] } } };
console.log(util.inspect({ n, e, o }));
console.log(util.inspect({ n, e, o }, { depth: 0 }));
console.log(util.inspect({ n, o }, { compact: false }));
console.log(util.inspect([n, o], { depth: 1 }));
console.log(util.inspect(new Map([['k', o]]), { breakLength: 20 }));
console.log(util.format('%o', [n]));
console.log(util.format('%j', { n, o }));
console.log(util.format('a %s b', { n }));
