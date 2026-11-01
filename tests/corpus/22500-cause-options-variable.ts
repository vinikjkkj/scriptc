// ES2022 Error options from a variable: the cause is installed when 'cause' is present, and it is read as the value.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const o1 = { cause: 'v' };
const e1 = new Error('x1', o1);
console.log(e1.message, String((e1 as Error & { cause?: unknown }).cause), show(e1));
const inner = new Error('inner');
const o2 = { cause: inner };
const e2 = new Error('x2', o2);
console.log(e2.message, show(e2));
