// Constructors that assign `this.name` after super(), as zapo's error classes do (their declared fields are the errx1 inspect item, kept out
// of this row): an assigned name prints as is, no constructor prefix unless it ends in "Error" and differs from the constructor.
(Error as any).stackTraceLimit = 0;
class CtorName extends Error {
  public constructor(m: string) { super(m); this.name = 'CtorName'; }
}
class Mismatch extends Error {
  public constructor(m: string) { super(m); this.name = 'Other'; }
}
class MismatchError extends Error {
  public constructor(m: string) { super(m); this.name = 'SomethingError'; }
}
class SameError extends Error {
  public constructor(m: string) { super(m); this.name = 'SameError'; }
}
const a = new CtorName('c');
const b = new Mismatch('m');
const c = new MismatchError('x');
const d = new SameError('s');
console.log(a);
console.log(b);
console.log(c);
console.log(d);
console.log(String(c), '|', c.name, '|', c.stack);
