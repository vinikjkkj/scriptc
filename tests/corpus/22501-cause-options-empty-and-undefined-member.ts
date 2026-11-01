// {} installs no cause; {cause: undefined} installs an own cause whose value is undefined.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const e1 = new Error('empty', {});
console.log(show(e1));
const undefMember = { cause: undefined };
const e2 = new Error('undef', undefMember);
console.log(show(e2));
