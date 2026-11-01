// A checked-dynamic options value from JSON: presence is a run-time fact.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
function show(e: unknown): string { return util.inspect(e); }
const withC = JSON.parse('{"cause":"json"}');
const noC = JSON.parse('{"other":1}');
console.log(show(new Error('j1', withC)), show(new Error('j2', noC)));
