// util.inspect of Errors with expando members: the braces block, nested values, depth, and the key order.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const e = new RangeError('r');
(e as any).z = 1;
(e as any).a = 'two';
(e as any).list = [1, 2, 3];
(e as any).nested = { deep: { deeper: { deepest: 1 } } };
console.log(util.inspect(e));
console.log(util.inspect(e, { depth: 0 }));
console.log(util.inspect(e, { compact: false }));
console.log(util.inspect({ wrapped: e }));
console.log([e]);
