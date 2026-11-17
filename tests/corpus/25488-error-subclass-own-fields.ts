// class extends Error with own fields and expandos: the name, the fields and the extra members in the braces block.
import * as util from 'node:util';
// Stackless rendering (Error.stackTraceLimit = 0): both sides print the same inspect form, with no stack lines.
(Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 0;
class AppError extends Error {
  code: string;
  retries = 3;
  constructor(m: string, code: string) { super(m); this.name = 'AppError'; this.code = code; }
}
const a = new AppError('boom', 'E_APP');
console.log(a);
(a as any).extra = true;
console.log(util.inspect(a));
class Quiet extends Error { constructor(m: string) { super(m); this.name = 'Quiet'; } }
const q: any = new Quiet('q');
q.info = 'i';
console.log(q);
const r: any = new AppError('dyn', 'E_DYN');
console.log(r);
console.log(String(a), a.code, a.retries);
