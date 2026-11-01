// A function is an Object: its own cause property counts. null does not.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const fnOpts: any = function () {};
fnOpts.cause = 'fncause';
console.log(String((new Error('fn', fnOpts) as Error & { cause?: unknown }).cause));
const nul: any = null;
console.log(show(new Error('nul', nul)));
