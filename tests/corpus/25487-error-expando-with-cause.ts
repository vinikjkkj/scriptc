// An Error with a cause AND expando members: Node prints [cause] inside the same braces block.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const inner = new Error('inner');
(inner as any).tag = 'in';
const top = new Error('top', { cause: inner });
(top as any).fatal = true;
console.log(util.inspect(top));
console.log(top);
const causeOnly = new Error('c', { cause: new Error('why') });
console.log(util.inspect(causeOnly));
