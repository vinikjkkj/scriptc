// Errors with expando members inside objects, arrays, a Map, and a template string (String(e) must not grow the block).
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
const e = new Error('m');
(e as any).k = 'v';
console.log({ e });
console.log([e, 1]);
console.log(new Map([['k', e]]));
console.log(`${e}`);
