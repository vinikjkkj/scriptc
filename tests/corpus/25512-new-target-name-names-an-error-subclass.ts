// The Error idiom: the constructor names the instance after the class that was actually constructed.
class AppError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
class NotFound extends AppError { constructor(what: string) { super(what + " not found", 404); } }
class Denied extends AppError {}
for (const e of [new AppError("a", 1), new NotFound("x"), new Denied("d", 403)]) {
  console.log(e.name, e.message, e.code, String(e), e instanceof AppError, e instanceof NotFound);
}
