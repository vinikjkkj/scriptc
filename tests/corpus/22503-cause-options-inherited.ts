// HasProperty is own-or-inherited: a cause on the prototype chain is installed as an own property.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const p = JSON.parse('{"cause":"inherited"}');
const child: any = Object.create(p);
const e = new Error('inh', child);
console.log(String((e as Error & { cause?: unknown }).cause), show(e));
const plain = JSON.parse('{"other":1}');
console.log(show(new Error('none', plain)));
