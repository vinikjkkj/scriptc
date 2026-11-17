// An any-typed instance of an Error subclass with declared fields, in printed containers, beside a typed one.
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
class AppError extends Error {
  code: string;
  retries = 3;
  constructor(m: string, code: string) { super(m); this.name = 'AppError'; this.code = code; }
}
const a: any = new AppError('boom', 'E_APP');
const typed = new AppError('typed', 'E_T');
(a as any).extra = true;
console.log({ a });
console.log([a, typed]);
console.log(new Map([['k', a]]));
console.log({ typed, a, n: 1 });
