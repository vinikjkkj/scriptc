class AppError extends Error {
  code: number;
  constructor(message: string, code: number) { super(message); this.code = code; this.name = "AppError"; }
  static from(m: string): AppError { return new AppError(m, 1); }
}
class Fatal extends AppError {}
const ctor: typeof AppError = AppError;
const e = new ctor("a", 2);
console.log(e.message, e.code, e.name, e instanceof ctor, e instanceof Error, ctor.name);
const f: typeof AppError = Fatal;
const g = new f("b", 3);
console.log(g instanceof Fatal, g instanceof AppError, g.code, f.name, f === Fatal, f === AppError);
const Make: new (m: string, c: number) => AppError = AppError;
console.log(new Make("m", 9).code);
console.log(ctor.from("z").code);
class Plain extends Error {}
const P = Plain;
const p = new P("plain");
console.log(p.message, p instanceof P, p instanceof Plain, P.name);
