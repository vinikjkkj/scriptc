// Evaluated classes extending Error, constructed through a dyn class value: one with its own constructor
// and one whose constructor is inherited from the runtime's Error.
function anyv(x) { return x; }
const mkErr = (code = "E") => class AppError extends Error {
  constructor(msg) { super(msg); this.code = code; }
  static kind = "app";
};
const mkBare = (n = 0) => class Bare extends Error { static n = n; };
const h = {};
h.E = mkErr("X1");
h.B = mkBare(2);
const E = anyv(h.E), B = anyv(h.B);
const e = new E("boom");
console.log(e.message, e.code, e instanceof Error, e instanceof E, E.kind, e.name);
const b = new B("plain");
console.log(b.message, b instanceof Error, b instanceof B, B.n, b instanceof E);
