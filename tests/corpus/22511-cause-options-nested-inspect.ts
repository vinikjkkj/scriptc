// util.inspect of nested causes installed from variable options (stackless rendering).
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const inner = new Error('in');
const mid = new Error('mid', { cause: inner });
const top = new Error('top', { cause: mid });
console.log(show(top));
const undefOpts = { cause: undefined };
console.log(show(new Error('u', undefOpts)));
