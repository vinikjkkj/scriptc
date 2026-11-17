// An any-typed Error subclass instance and a plain class instance as members of variable literals.
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
class AppError extends Error {
  code: string;
  retries = 3;
  constructor(m: string, code: string) { super(m); this.name = 'AppError'; this.code = code; }
}
class Box { v = 7; w = 8; }
const a: any = new AppError('boom', 'E_APP');
const b: any = new Box();
const r = { a, b };
console.log(r);
console.log([a, b]);
const m = new Map([['k', a], ['b', b]]);
console.log(m);
