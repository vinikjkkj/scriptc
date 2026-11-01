// undefined, null and non-object options are ignored: no own cause.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const nu: any = undefined;
const nl: any = null;
const num: any = 5;
const str: any = 'text';
console.log(show(new Error('undef', nu)));
console.log(show(new Error('null', nl)));
console.log(show(new Error('num', num)));
console.log(show(new Error('str', str)));
